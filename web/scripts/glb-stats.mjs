// Print verification stats for one or more GLB files as JSON.
// Usage: node scripts/glb-stats.mjs <file.glb> [...more]
import { statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/core';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const out = [];
for (const file of process.argv.slice(2)) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  let triangles = 0;
  let vertices = 0;
  const modes = new Set();
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mode = prim.getMode();
      modes.add(mode);
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      const count = idx ? idx.getCount() : pos ? pos.getCount() : 0;
      if (pos) vertices += pos.getCount();
      if (mode === 4) triangles += count / 3;
      else if (mode === 5 || mode === 6) triangles += Math.max(count - 2, 0);
    }
  }
  const scenes = root.listScenes();
  const scene = root.getDefaultScene() || scenes[0];
  const b = scene ? getBounds(scene) : { min: [0, 0, 0], max: [0, 0, 0] };
  const r = (v) => Math.round(v * 10000) / 10000;
  out.push({
    file,
    bytes: statSync(file).size,
    scenes: scenes.length,
    nodes: root.listNodes().length,
    meshes: root.listMeshes().length,
    primitives: root.listMeshes().reduce((n, m) => n + m.listPrimitives().length, 0),
    materials: root.listMaterials().length,
    textures: root.listTextures().length,
    animations: root.listAnimations().length,
    skins: root.listSkins().length,
    triangles,
    vertices,
    modes: [...modes],
    extensionsUsed: root.listExtensionsUsed().map((e) => e.extensionName),
    bboxMin: b.min.map(r),
    bboxMax: b.max.map(r),
    bboxSize: [0, 1, 2].map((i) => r(b.max[i] - b.min[i])),
    center: [0, 1, 2].map((i) => r((b.max[i] + b.min[i]) / 2)),
  });
}
console.log(JSON.stringify(out, null, 2));
