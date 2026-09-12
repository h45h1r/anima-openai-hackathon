// Convert a Wavefront OBJ (tris/quads/ngons, with or without normals) to a welded GLB
// with smooth vertex normals, using @gltf-transform/core.
// Usage: node scripts/obj2glb.mjs <input.obj> <output.glb> [--name Body] [--color r,g,b] [--copyright "..."]
import { readFileSync } from 'node:fs';
import { Document, NodeIO } from '@gltf-transform/core';
import { dedup, prune, weld } from '@gltf-transform/functions';

const [, , input, output, ...rest] = process.argv;
if (!input || !output) {
  console.error('usage: node scripts/obj2glb.mjs <input.obj> <output.glb> [--name Body] [--color r,g,b] [--copyright "..."]');
  process.exit(1);
}
const opt = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : d; };
const name = opt('--name', 'Mesh');
const color = opt('--color', '0.8,0.8,0.8').split(',').map(Number);
const copyright = opt('--copyright', '');

const verts = [];
const faces = []; // arrays of 0-based vertex indices
for (const line of readFileSync(input, 'utf8').split(/\r?\n/)) {
  if (line.startsWith('v ')) {
    const [, x, y, z] = line.trim().split(/\s+/);
    verts.push(+x, +y, +z);
  } else if (line.startsWith('f ')) {
    const idx = line.trim().split(/\s+/).slice(1).map((t) => {
      const i = parseInt(t.split('/')[0], 10);
      return i < 0 ? verts.length / 3 + i : i - 1;
    });
    for (let k = 1; k + 1 < idx.length; k++) faces.push(idx[0], idx[k], idx[k + 1]); // fan triangulation
  }
}
const vCount = verts.length / 3;
const pos = Float32Array.from(verts);
const index = vCount > 65535 ? Uint32Array.from(faces) : Uint16Array.from(faces);

// Area-weighted smooth normals.
const nrm = new Float32Array(pos.length);
for (let i = 0; i < index.length; i += 3) {
  const a = index[i] * 3, b = index[i + 1] * 3, c = index[i + 2] * 3;
  const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
  const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  for (const k of [a, b, c]) { nrm[k] += nx; nrm[k + 1] += ny; nrm[k + 2] += nz; }
}
for (let i = 0; i < nrm.length; i += 3) {
  const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
  nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l;
}

const doc = new Document();
const buffer = doc.createBuffer();
const position = doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer);
const normal = doc.createAccessor().setType('VEC3').setArray(nrm).setBuffer(buffer);
const indices = doc.createAccessor().setType('SCALAR').setArray(index).setBuffer(buffer);
const material = doc.createMaterial(`${name}Mat`).setBaseColorFactor([color[0], color[1], color[2], 1]).setMetallicFactor(0).setRoughnessFactor(0.7);
const prim = doc.createPrimitive().setAttribute('POSITION', position).setAttribute('NORMAL', normal).setIndices(indices).setMaterial(material);
const node = doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim));
doc.createScene(name).addChild(node);
if (copyright) doc.getRoot().getAsset().copyright = copyright;
doc.getRoot().getAsset().generator = 'family-companion obj2glb.mjs (gltf-transform)';
await doc.transform(weld(), prune(), dedup());
await new NodeIO().write(output, doc);
console.log(`wrote ${output}: ${vCount} vertices, ${index.length / 3} triangles`);
