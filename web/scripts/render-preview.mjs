// Dependency-free preview renderer: rasterises GLBs to a PNG contact sheet (z-buffer, Lambert shading).
// Usage: node scripts/render-preview.mjs <out.png> <file.glb> [...more]   (env: SIZE=480, VIEW=iso|front)
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const [, , outPng, ...files] = process.argv;
const S = Number(process.env.SIZE || 480);
const VIEW = process.env.VIEW || 'iso';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

function mulMat(m, v) { // column-major 4x4 * vec3 (point)
  return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
}
function rotY(v, a) { const c = Math.cos(a), s = Math.sin(a); return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]]; }
function rotX(v, a) { const c = Math.cos(a), s = Math.sin(a); return [v[0], c * v[1] - s * v[2], s * v[1] + c * v[2]]; }

async function renderModel(file) {
  const doc = await io.read(file);
  const tris = []; // [x,y,z]x3 in view space + color
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  const walk = (node) => {
    const mesh = node.getMesh();
    if (mesh) {
      const wm = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        if (prim.getMode() !== 4) continue;
        const pos = prim.getAttribute('POSITION').getArray();
        const idx = prim.getIndices()?.getArray();
        const mat = prim.getMaterial();
        const col = mat ? mat.getBaseColorFactor() : [0.8, 0.8, 0.8, 1];
        const n = idx ? idx.length : pos.length / 3;
        for (let i = 0; i < n; i += 3) {
          const t = [];
          for (let k = 0; k < 3; k++) {
            const vi = idx ? idx[i + k] : i + k;
            let p = mulMat(wm, [pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]]);
            if (VIEW === 'iso') { p = rotY(p, -0.6); p = rotX(p, 0.35); }
            t.push(p);
          }
          tris.push({ t, col });
        }
      }
    }
    node.listChildren().forEach(walk);
  };
  scene.listChildren().forEach(walk);
  // fit
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const { t } of tris) for (const p of t) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i]); }
  const ext = Math.max(max[0] - min[0], max[1] - min[1]) * 1.1 || 1;
  const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2;
  const img = new Float32Array(S * S * 3).fill(0.12);
  const zb = new Float32Array(S * S).fill(-Infinity);
  const L = [0.4, 0.7, 0.6]; const ll = Math.hypot(...L); L[0] /= ll; L[1] /= ll; L[2] /= ll;
  for (const { t, col } of tris) {
    const sx = t.map((p) => ((p[0] - cx) / ext + 0.5) * S), sy = t.map((p) => (0.5 - (p[1] - cy) / ext) * S), sz = t.map((p) => p[2]);
    const ux = t[1][0] - t[0][0], uy = t[1][1] - t[0][1], uz = t[1][2] - t[0][2];
    const vx = t[2][0] - t[0][0], vy = t[2][1] - t[0][1], vz = t[2][2] - t[0][2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const lam = 0.25 + 0.75 * Math.abs(nx * L[0] + ny * L[1] + nz * L[2]);
    const minX = Math.max(0, Math.floor(Math.min(...sx))), maxX = Math.min(S - 1, Math.ceil(Math.max(...sx)));
    const minY = Math.max(0, Math.floor(Math.min(...sy))), maxY = Math.min(S - 1, Math.ceil(Math.max(...sy)));
    const det = (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sx[2] - sx[0]) * (sy[1] - sy[0]);
    if (Math.abs(det) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((sx[1] - px) * (sy[2] - py) - (sx[2] - px) * (sy[1] - py)) / det;
      const w1 = ((sx[2] - px) * (sy[0] - py) - (sx[0] - px) * (sy[2] - py)) / det;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * sz[0] + w1 * sz[1] + w2 * sz[2];
      const i = y * S + x;
      if (z > zb[i]) { zb[i] = z; img[i * 3] = col[0] * lam; img[i * 3 + 1] = col[1] * lam; img[i * 3 + 2] = col[2] * lam; }
    }
  }
  return { img, tris: tris.length };
}

function png(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 3 + 1)] = 0; for (let x = 0; x < width * 3; x++) raw[y * (width * 3 + 1) + 1 + x] = Math.max(0, Math.min(255, Math.round(rgb[y * width * 3 + x] * 255))); }
  const crcTable = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const cols = Math.min(files.length, 5), rows = Math.ceil(files.length / cols);
const sheet = new Float32Array(cols * S * rows * S * 3).fill(0.05);
for (let i = 0; i < files.length; i++) {
  const { img, tris } = await renderModel(files[i]);
  const ox = (i % cols) * S, oy = Math.floor(i / cols) * S;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) for (let c = 0; c < 3; c++) sheet[((oy + y) * cols * S + ox + x) * 3 + c] = img[(y * S + x) * 3 + c];
  console.log(`${files[i].split('/').pop()}: ${tris} triangles rendered at tile ${i}`);
}
writeFileSync(outPng, png(cols * S, rows * S, sheet));
console.log('wrote', outPng);
