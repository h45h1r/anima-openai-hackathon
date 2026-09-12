// Convert a binary or ASCII STL file to a GLB using @gltf-transform/core.
// Usage: node scripts/stl2glb.mjs <input.stl> <output.glb> [--name Mesh] [--color r,g,b]
// Positions are kept as-is (units unchanged); flat per-face normals are emitted.
import { readFileSync } from 'node:fs';
import { Document, NodeIO } from '@gltf-transform/core';

const [, , input, output, ...rest] = process.argv;
if (!input || !output) {
  console.error('usage: node scripts/stl2glb.mjs <input.stl> <output.glb> [--name Mesh] [--color r,g,b]');
  process.exit(1);
}
const opt = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : d; };
const meshName = opt('--name', 'Mesh');
const color = opt('--color', '0.8,0.8,0.8').split(',').map(Number);

const buf = readFileSync(input);

function parseBinary(b) {
  const n = b.readUInt32LE(80);
  const pos = new Float32Array(n * 9);
  const nrm = new Float32Array(n * 9);
  let o = 84;
  for (let i = 0; i < n; i++) {
    const nx = b.readFloatLE(o), ny = b.readFloatLE(o + 4), nz = b.readFloatLE(o + 8);
    o += 12;
    for (let v = 0; v < 3; v++) {
      const k = i * 9 + v * 3;
      pos[k] = b.readFloatLE(o); pos[k + 1] = b.readFloatLE(o + 4); pos[k + 2] = b.readFloatLE(o + 8);
      nrm[k] = nx; nrm[k + 1] = ny; nrm[k + 2] = nz;
      o += 12;
    }
    o += 2; // attribute byte count
  }
  return { pos, nrm, n };
}

function parseAscii(text) {
  const verts = [];
  const re = /vertex\s+([-+\deE.]+)\s+([-+\deE.]+)\s+([-+\deE.]+)/g;
  let m;
  while ((m = re.exec(text))) verts.push(+m[1], +m[2], +m[3]);
  const n = verts.length / 9;
  const pos = Float32Array.from(verts);
  const nrm = new Float32Array(verts.length);
  return { pos, nrm, n };
}

function isAscii(b) {
  if (b.length < 84) return true;
  const n = b.readUInt32LE(80);
  return 84 + n * 50 !== b.length && b.subarray(0, 5).toString() === 'solid';
}

const { pos, nrm, n } = isAscii(buf) ? parseAscii(buf.toString('latin1')) : parseBinary(buf);

// Recompute flat normals from geometry (STL normals are often garbage).
for (let i = 0; i < n; i++) {
  const k = i * 9;
  const ax = pos[k], ay = pos[k + 1], az = pos[k + 2];
  const bx = pos[k + 3], by = pos[k + 4], bz = pos[k + 5];
  const cx = pos[k + 6], cy = pos[k + 7], cz = pos[k + 8];
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l; ny /= l; nz /= l;
  for (let v = 0; v < 3; v++) { nrm[k + v * 3] = nx; nrm[k + v * 3 + 1] = ny; nrm[k + v * 3 + 2] = nz; }
}

const doc = new Document();
const buffer = doc.createBuffer();
const position = doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer);
const normal = doc.createAccessor().setType('VEC3').setArray(nrm).setBuffer(buffer);
const material = doc.createMaterial(meshName + 'Mat').setBaseColorFactor([color[0], color[1], color[2], 1]).setMetallicFactor(0).setRoughnessFactor(0.8);
const prim = doc.createPrimitive().setAttribute('POSITION', position).setAttribute('NORMAL', normal).setMaterial(material);
const mesh = doc.createMesh(meshName).addPrimitive(prim);
const node = doc.createNode(meshName).setMesh(mesh);
doc.createScene('Scene').addChild(node);

await new NodeIO().write(output, doc);
console.log(`wrote ${output}: ${n} triangles`);
