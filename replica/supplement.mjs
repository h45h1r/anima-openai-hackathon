import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.mjs';
import { redactLegacyAuth, legacyRows } from './legacy.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const zip = promisify(gzip);
const origin = 'https://sim.animahealth.com';
const key = process.env.SIM_API_KEY;
if (!key) throw new Error('SIM_API_KEY is required');
const teamResponse = await fetch(origin + '/api/team', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) });
if (!teamResponse.ok) throw new Error('Could not identify team');
const team = await teamResponse.json();
await mkdir(resolve(root, 'data/supplement'), { recursive: true });

async function capture(endpoint) {
  let response, body;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await fetch(origin + endpoint, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(25000) });
      const text = await response.text();
      try { body = JSON.parse(text); } catch { body = { text }; }
      if (response.status >= 500 && attempt < 2) continue;
      break;
    } catch (error) { if (attempt === 2) { console.error(endpoint, error.message); return; } }
  }
  await pool.query('INSERT INTO sim.endpoint_responses(world_id,endpoint,status,body) VALUES($1,$2,$3,$4) ON CONFLICT(world_id,endpoint) DO UPDATE SET status=EXCLUDED.status,body=EXCLUDED.body,captured_at=now()', [team.world, endpoint, response.status, body]);
  const name = encodeURIComponent(endpoint) + '.json.gz';
  await writeFile(resolve(root, 'data/supplement', name), await zip(JSON.stringify({ endpoint, status: response.status, body, capturedAt: new Date().toISOString() })));
  console.log(response.status, endpoint, Array.isArray(body) ? `array:${body.length}` : Object.keys(body).join(','));
  return body;
}

const endpoints = [
  '/healthz', '/api/team', '/api/clock', '/api/catalogue', '/api/openapi.json', '/docs/handbook.json',
  '/api/sites/hospital/attendances', '/api/sites/hospital/documents', '/api/sites/gp/documents',
  '/api/sites/pharmacy/pharmacy-workspace', '/api/sites/gp/messaging-workspace',
  '/api/sites/wearables/devices?limit=500&offset=0', '/api/sites/wearables/readings?limit=500&offset=0',
  ...['pds', 'ods', 'dos', 'ers', 'eps', 'eps-tracker', 'gp-connect', 'mesh', 'scr', 'pathology', 'radiology', 'appointments'].map(id => `/api/nhs/${id}`),
  '/api/nhs/pds/metadata', '/api/nhs/ods/metadata', '/api/nhs/ods/Organization?_count=100&_offset=0',
  '/api/control/snapshot', '/api/sites/legacy/view',
  ...team.scopes.filter(site => site !== 'gp').map(site => `/api/sites/${site}/patients?offset=0`),
];
let next = 0;
await Promise.all(Array.from({ length: 3 }, async () => { while (next < endpoints.length) await capture(endpoints[next++]); }));

const conversations = await pool.query("SELECT body FROM sim.endpoint_responses WHERE world_id=$1 AND endpoint='/api/sites/gp/messaging-workspace'", [team.world]);
const ids = [...new Set((conversations.rows[0]?.body.resources || []).map(r => r.patientId).filter(Boolean))];
for (const id of ids) await capture(`/api/sites/patient/messaging-workspace?patientId=${encodeURIComponent(id)}`);

// The documented legacy reader uses a browser session. Do not submit its transfer forms.
try {
  const login = await fetch(origin + '/api/session', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(20000) });
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  if (!login.ok || !cookie) throw new Error(`Browser session HTTP ${login.status}`);
  const response = await fetch(origin + '/browser/legacy', { headers: { Cookie: cookie }, signal: AbortSignal.timeout(25000) });
  const html = redactLegacyAuth(await response.text());
  await pool.query('INSERT INTO sim.endpoint_responses(world_id,endpoint,status,body) VALUES($1,$2,$3,$4) ON CONFLICT(world_id,endpoint) DO UPDATE SET status=EXCLUDED.status,body=EXCLUDED.body,captured_at=now()', [team.world, '/browser/legacy', response.status, { html, contentType: 'text/html', authenticationFieldsRedacted: true }]);
  await writeFile(resolve(root, 'data/supplement/legacy.html'), html);
  if (response.ok) {
    for (const record of legacyRows(html)) await pool.query('INSERT INTO sim.legacy_documents(world_id,resource_id,title,content) VALUES($1,$2,$3,$4) ON CONFLICT(world_id,resource_id) DO UPDATE SET title=EXCLUDED.title,content=EXCLUDED.content', [team.world, record.id, record.title, record.content]);
  }
  console.log(response.status, '/browser/legacy', html.length, 'characters; transfer forms were not submitted');
} catch (error) { console.error('Legacy reader:', error.message); }
await pool.end();
