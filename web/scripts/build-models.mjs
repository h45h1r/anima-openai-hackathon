// Build public/models/*.glb from downloaded source GLBs.
// Usage: node scripts/build-models.mjs <sourceDir> [outDir=public/models] [only,names]
//
// Pipeline per output: merge inputs into one scene -> strip animations/skins ->
// (optional) join meshes by material -> weld -> meshopt simplify to a triangle
// target -> prune -> dedup -> embed attribution in asset.copyright -> write GLB.
import { statSync } from 'node:fs';
import { join as pathJoin } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, join, mergeDocuments, prune, simplify, unpartition, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const [, , srcDir, outDir = 'public/models', onlyArg] = process.argv;
if (!srcDir) {
  console.error('usage: node scripts/build-models.mjs <sourceDir> [outDir] [only,names]');
  process.exit(1);
}
const only = onlyArg ? new Set(onlyArg.split(',')) : null;

const HRA = (title, id) =>
  `${title} - Human Reference Atlas (HRA) 3D Reference Object Library, via NIH 3D https://3d.nih.gov/entries/3DPX-${id} - CC BY 4.0`;

// targetTris: approximate triangle budget after simplification (null = keep).
// joinMeshes: merge all meshes that share a material (fewer draw calls; loses per-part node names).
const MODELS = [
  // body.glb is built separately from the SOMA-X Anny base body with scripts/obj2glb.mjs.
  // The HRA "Skin, Female" surface is an optional alternative (same frame as the organs); build with `only=body-hra`.
  { name: 'body-hra', inputs: ['skin_f.glb'], targetTris: 60000, joinMeshes: false, optional: true, copyright: HRA('Skin, Female', '020986') },
  { name: 'heart', inputs: ['heart_f.glb'], targetTris: 60000, joinMeshes: false, copyright: HRA('Heart, Female', '020966') },
  { name: 'lungs', inputs: ['lung_f.glb'], targetTris: 60000, joinMeshes: true, copyright: HRA('Lung, Female', '020974') },
  { name: 'kidneys', inputs: ['kidney_l_f.glb', 'kidney_r_f.glb'], targetTris: 60000, joinMeshes: false, copyright: HRA('Kidney, Female, Left (3DPX-020967) and Kidney, Female, Right', '020968') },
  { name: 'liver', inputs: ['liver_f.glb'], targetTris: 60000, joinMeshes: false, copyright: HRA('Liver, Female', '020973') },
  { name: 'brain', inputs: ['brain_f.glb'], targetTris: 60000, joinMeshes: true, copyright: HRA('Brain, Female', '020959') },
  { name: 'gut', inputs: ['large_intestine_f.glb', 'small_intestine_f.glb'], targetTris: 50000, joinMeshes: false, copyright: HRA('Large Intestine, Female (3DPX-020971) and Small Intestine, Female', '020987') },
  { name: 'joint', inputs: ['knee_l_f.glb'], targetTris: null, joinMeshes: false, copyright: HRA('Knee, Female, Left', '020969') },
  { name: 'pancreas', inputs: ['pancreas_f.glb'], targetTris: null, joinMeshes: false, copyright: HRA('Pancreas, Female', '020983') },
  { name: 'bladder', inputs: ['bladder_f.glb'], targetTris: 30000, joinMeshes: false, copyright: HRA('Urinary Bladder, Female', '020995') },
];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;

// Area-weighted smooth vertex normals for indexed triangle primitives (keeps the mesh welded,
// unlike @gltf-transform/functions' normals(), which only produces flat normals by unwelding).
function smoothNormals(doc) {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue;
      const pos = prim.getAttribute('POSITION');
      const idx = prim.getIndices();
      if (!pos || !idx) continue;
      const p = pos.getArray();
      const ix = idx.getArray();
      const n = new Float32Array(p.length);
      for (let i = 0; i < ix.length; i += 3) {
        const a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3;
        const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
        const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const k of [a, b, c]) { n[k] += nx; n[k + 1] += ny; n[k + 2] += nz; }
      }
      for (let i = 0; i < n.length; i += 3) {
        const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
        n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
      }
      const acc = doc.createAccessor().setType('VEC3').setArray(n).setBuffer(pos.getBuffer());
      prim.setAttribute('NORMAL', acc);
    }
  }
}

function countTris(doc) {
  let t = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const n = idx ? idx.getCount() : prim.getAttribute('POSITION')?.getCount() ?? 0;
      if (prim.getMode() === 4) t += n / 3;
    }
  return Math.round(t);
}

for (const m of MODELS) {
  if (only ? !only.has(m.name) : m.optional) continue;
  let doc = null;
  for (const input of m.inputs) {
    const d = await io.read(pathJoin(srcDir, input));
    if (doc) mergeDocuments(doc, d); // v4: mutates target, returns a property map
    else doc = d;
  }
  const root = doc.getRoot();

  // Collapse all scenes into the first one.
  const scenes = root.listScenes();
  const main = scenes[0];
  for (const s of scenes.slice(1)) {
    for (const child of s.listChildren()) main.addChild(child);
    s.dispose();
  }
  root.setDefaultScene(main);
  main.setName(m.name);

  // Strip anything animation/skin related.
  root.listAnimations().forEach((a) => a.dispose());
  root.listSkins().forEach((s) => s.dispose());
  root.listNodes().forEach((n) => { if (n.getSkin()) n.setSkin(null); });

  const before = countTris(doc);
  if (m.joinMeshes) await doc.transform(join({ keepNamed: false }));
  const needsSimplify = !!m.targetTris && before > m.targetTris;
  if (needsSimplify) {
    // Source meshes carry per-face normals, so every edge is an attribute seam and
    // weld/simplify cannot collapse anything. Drop normals/tangents, weld by position,
    // simplify, then rebuild smooth normals.
    for (const mesh of root.listMeshes())
      for (const prim of mesh.listPrimitives())
        for (const sem of ['NORMAL', 'TANGENT'])
          if (prim.getAttribute(sem)) prim.setAttribute(sem, null);
  }
  await doc.transform(weld());
  if (needsSimplify) {
    const ratio = m.targetTris / before;
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.01, lockBorder: false }));
    smoothNormals(doc);
  }
  await doc.transform(prune(), dedup(), unpartition());

  root.getAsset().copyright = m.copyright;
  root.getAsset().generator = 'family-companion build-models.mjs (gltf-transform)';

  const out = pathJoin(outDir, `${m.name}.glb`);
  await io.write(out, doc);
  const after = countTris(doc);
  console.log(`${m.name.padEnd(9)} ${String(before).padStart(7)} -> ${String(after).padStart(6)} tris  meshes=${root.listMeshes().length}  ${(statSync(out).size / 1e6).toFixed(2)} MB`);
}
