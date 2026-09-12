import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const output = resolve(root, 'data/frontend');
await mkdir(output, { recursive: true });
const origin = 'https://sim.animahealth.com';
const queue = ['/control/', '/gp/', '/gp/documents/', '/gp/messages/', '/gp/telephony/', '/hospital/', '/pharmacy/', '/community/', '/wearables/', '/wearables/messages/'];
const seen = new Set(queue);
const found = new Map();
const files = [];
for (let index = 0; index < queue.length; index++) {
  const path = queue[index];
  try {
    let text;
    try { text = await readFile(resolve(output, encodeURIComponent(path)), 'utf8'); }
    catch {
      const response = await fetch(origin + path, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) { files.push({ path, status: response.status }); continue; }
      text = await response.text();
    }
    if (!path.endsWith('.css')) {
      for (const match of text.matchAll(/\/api\/[a-zA-Z0-9_/${}?=.&:-]+/g)) {
        const sources = found.get(match[0]) || new Set();
        sources.add(path); found.set(match[0], sources);
      }
      const assets = [...text.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g)].map(m => m[1]);
      assets.push(...[...text.matchAll(/["'`]((?:\.\/|assets\/)[\w.-]+\.(?:js|css))["'`]/g)].map(m => m[1]));
      for (const asset of assets) {
        const assetBase = asset.startsWith('assets/') && path.includes('/assets/') ? origin + path.split('/assets/')[0] + '/' : origin + path;
        const resolved = new URL(asset, assetBase);
        if (resolved.origin === origin && !seen.has(resolved.pathname)) { seen.add(resolved.pathname); queue.push(resolved.pathname); }
      }
    }
    await writeFile(resolve(output, encodeURIComponent(path)), text);
    files.push({ path, status: 200, bytes: Buffer.byteLength(text) });
  } catch (error) { files.push({ path, error: error.message }); }
}
const result = { capturedAt: new Date().toISOString(), method: 'Inspect same-origin app HTML and referenced JS/CSS; extract literal API paths and templates. No guessed privileged paths or auth bypass.', files, endpoints: [...found].sort(([a], [b]) => a.localeCompare(b)).map(([path, sources]) => ({ path, sources: [...sources] })) };
await writeFile(resolve(root, '../docs/research/frontend-endpoints.json'), JSON.stringify(result, null, 2));
console.log('Read', files.filter(f => f.status === 200).length, 'frontend files; found', found.size, 'API literals/templates.');
