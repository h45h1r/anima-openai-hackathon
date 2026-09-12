import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, worldId, sites, act, getClock, changeClock, workspace, listResources, updateCall, fail } from './store.mjs';
import { readServer } from './read.mjs';
import { attachTelephony } from './telephony.mjs';
import { createIdentityHandler } from './identity.mjs';
import { createControlHandler } from './control.mjs';
import { createCompanionHandler } from './companion.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), 'public');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon', '.txt': 'text/plain' };
const send = (res, status, body, type = 'application/json') => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Anima-Source': 'local-app' }); res.end(type.startsWith('text/') ? body : JSON.stringify(body)); };
async function body(req) {
  if (req.body !== undefined) {
    const size = Buffer.byteLength(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    if (size > 256000) throw Object.assign(new Error('Request too large.'), { status: 413 });
    try {
      return typeof req.body === 'string' ? (req.headers['content-type']?.includes('application/x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(req.body)) : JSON.parse(req.body || '{}')) : req.body;
    } catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
  }

  let text = '';
  for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 256000) fail(413, 'Request body too large.'); }
  if (req.headers['content-type']?.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(text));
  try { return text ? JSON.parse(text) : {}; } catch { fail(400, 'Invalid JSON.'); }
}
async function team() { return { ...(await pool.query('SELECT team FROM sim.worlds WHERE world_id=$1', [worldId])).rows[0].team, team: 'local-copy' }; }
const identity = await createIdentityHandler({ pool, worldId });
const control = await createControlHandler({ pool, worldId, getClock, changeClock });
const companion = await createCompanionHandler({ pool, worldId });

export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, process.env.PUBLIC_ORIGIN || `http://${req.headers.host || 'localhost:4192'}`);
    const path = url.pathname;
    if (path === '/companion/' || path === '/companion' || path === '/companion/index.html') {
      const target = new URL(process.env.KINDRED_URL || 'http://localhost:3111/');
      target.searchParams.set('tab', 'circle');
      target.searchParams.set('patient', url.searchParams.get('patient') || 'SIM-000006');
      res.writeHead(302, { Location: target.href }); return res.end();
    }
    if (await identity(req, res, url)) return;
    if (await control(req, res, url)) return;
    if (await companion(req, res, url)) return;
    if (path === '/favicon.ico') { res.writeHead(302, { Location: '/control/brands/gp-records.svg' }); return res.end(); }
    if (path.startsWith('/api/') || path === '/healthz' || path === '/openapi.json') {
      if (path === '/healthz') return send(res, 200, { ok: true, database: 'postgresql', mode: 'local-copy' });
      if (path === '/api/team') return send(res, 200, await team());
      if (path === '/api/keys' && req.method === 'POST') return send(res, 200, { ...(await team()), apiKey: 'local-demo', teamName: 'local-copy', created: false });
      if (path === '/api/session' && req.method === 'POST') { res.setHeader('Set-Cookie', 'sim_session=local-demo; HttpOnly; SameSite=Strict; Path=/'); return send(res, 200, { ok: true }); }
      if (path === '/api/clock') return send(res, 200, req.method === 'POST' ? await changeClock(await body(req)) : await getClock());
      const action = path.match(/^\/api\/sites\/([^/]+)\/actions$/);
      if (action && req.method === 'POST') {
        const result = await act(action[1], await body(req), req.headers['idempotency-key']);
        if (result.kind === 'telephone-call') await telephony.refresh();
        return send(res, 200, result);
      }
      if (req.method === 'GET') {
        if (path === '/api/sites/hospital/attendances') return send(res, 200, await workspace('hospital', ['hospital-attendance']));
        if (path === '/api/sites/gp/documents') return send(res, 200, await workspace('gp', ['discharge-summary']));
        if (path === '/api/sites/hospital/documents') return send(res, 200, await workspace('hospital', ['discharge-summary']));
        if (path === '/api/sites/gp/messaging-workspace') return send(res, 200, await workspace('gp', ['conversation', 'message-template']));
        if (path === '/api/sites/patient/messaging-workspace') return send(res, 200, await workspace('patient', ['conversation'], url.searchParams.get('patientId')));
        if (path === '/api/sites/pharmacy/pharmacy-workspace') return send(res, 200, await workspace('pharmacy'));
        if (/^\/api\/sites\/wearables\/(devices|readings)$/.test(path)) {
          const kind = path.endsWith('devices') ? 'device' : 'observation';
          let items = await listResources('wearables', [kind]);
          if (url.searchParams.has('patient')) items = items.filter(r => r.patientId === url.searchParams.get('patient'));
          if (url.searchParams.has('metric')) items = items.filter(r => r.data.metric === url.searchParams.get('metric'));
          const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 100);
          if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 500) fail(400, 'Invalid pagination.');
          return send(res, 200, { items: items.slice(offset, offset + limit), total: items.length, offset, limit, now: (await getClock()).now });
        }
        if (/^\/api\/sites\/[^/]+\/view$/.test(path)) await getClock();
        if (path === '/api/catalogue') {
          const result = (await pool.query("SELECT body FROM sim.endpoint_responses WHERE world_id=$1 AND endpoint='/api/catalogue'", [worldId])).rows[0].body;
          return send(res, 200, { ...result, identity: { ...result.identity, issuer: `http://${req.headers.host}/cis2` } });
        }
        if (path === '/openapi.json') req.url = '/api/openapi.json';
        return readServer.emit('request', req, res);
      }
      fail(400, 'This local endpoint does not support that operation.');
    }
    if (path === '/browser/legacy') {
      if (req.method === 'POST') {
        const input = await body(req);
        if (input.csrf !== 'local-demo') fail(403, 'Invalid local form token.');
        const row = (await pool.query('SELECT * FROM sim.legacy_documents WHERE world_id=$1 AND resource_id=$2', [worldId, input.resourceId])).rows[0];
        if (!row) fail(404, 'Legacy letter not found.');
        // The handbook identifies the single legacy letter as the SIM-000002 referral scenario.
        const existing = (await listResources('gp', ['document'])).find(r => r.data.legacyResourceId === row.resource_id);
        if (!existing) await act('gp', { type: 'save_consultation', patientId: 'SIM-000002', title: row.title, text: `${row.content}\nImported from local legacy letter ${row.resource_id}.`, consultationStatus: 'saved' }, `legacy-transfer-${row.resource_id}`);
        res.writeHead(303, { Location: '/browser/legacy?sent=1' }); return res.end();
      }
      const captured = (await pool.query("SELECT body FROM sim.endpoint_responses WHERE world_id=$1 AND endpoint='/browser/legacy'", [worldId])).rows[0].body.html;
      return send(res, 200, captured.replaceAll('[REDACTED]', 'local-demo').replace('</h1>', '</h1><p><a href="/control/">Neighbourhood</a> · Local copy</p>'), 'text/html');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') fail(405, 'Method not supported.');
    let file = resolve(root, '.' + decodeURIComponent(path));
    if (file !== root && !file.startsWith(root + sep)) fail(403, 'Invalid path.');
    let info = await stat(file);
    if (info.isDirectory()) { file = resolve(file, 'index.html'); info = await stat(file); }
    const headers = { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Content-Length': info.size, 'Accept-Ranges': 'bytes' };
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if (range) {
      const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
      if (start > end || start >= info.size) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); return res.end(); }
      res.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${info.size}` });
      return createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  } catch (error) { if (!res.headersSent) send(res, error.status || (error.code === 'ENOENT' ? 404 : 500), { error: error.message }); else res.end(); }
});

const telephony = process.env.VERCEL ? { ready: Promise.resolve(), refresh: async () => {} } : attachTelephony(server, { listCalls: () => listResources('gp', ['telephone-call']), updateCall, authenticate: apiKey => apiKey === 'local-demo' });
await telephony.ready;
export default async function handler(req, res) {
  await server.listeners('request')[0](req, res);
}
const port = Number(process.env.PORT || 4192);
if (!process.env.VERCEL) server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Full local app: http://localhost:${port}/control/`));
if (!process.env.VERCEL) {
let ticking = false;
const timer = setInterval(async () => { if (ticking) return; ticking = true; try { await getClock(); } catch (error) { console.error(error.message); } finally { ticking = false; } }, 3000);
timer.unref();
}
