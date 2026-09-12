import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const archive = resolve(root, 'data');
const zip = promisify(gzip);
const origin = process.env.SIM_ORIGIN || 'https://sim.animahealth.com';
const key = process.env.SIM_API_KEY;
if (!key) throw new Error('SIM_API_KEY is required.');
await mkdir(archive, { recursive: true });

export async function read(path) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(new URL(path, origin), { headers: { Authorization: `Bearer ${key}`, Connection: 'close' }, signal: AbortSignal.timeout(25000) });
      if (!response.ok) throw new Error(`HTTP ${response.status} at ${path}`);
      return await response.json();
    } catch (error) {
      last = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw last;
}

const team = await read('/api/team');
const world = team.world;
const clock = await read('/api/clock');
await pool.query('INSERT INTO sim.worlds(world_id,team,clock_start) VALUES($1,$2,$3) ON CONFLICT(world_id) DO UPDATE SET team=EXCLUDED.team', [world, team, clock]);
const imported = await pool.query('SELECT collection,page_offset FROM sim.import_pages WHERE world_id=$1', [world]);
const done = new Set(imported.rows.map(r => `${r.collection}:${r.page_offset}`));
const failures = [];
let processed = 0;
let consecutiveFailures = 0;
let stopped = false;

async function storePage({ collection, offset, endpoint, body, items, total, capturedAt = new Date().toISOString(), kind, site }) {
  const pageKey = `${collection}:${offset}`;
  if (done.has(pageKey)) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (kind === 'directory' || kind === 'demographics') {
      const column = kind === 'directory' ? 'directory' : 'demographics';
      await client.query(`INSERT INTO sim.patients(world_id,patient_id,${column},${column}_captured_at)
        SELECT $1,x->>'id',x,$3 FROM jsonb_array_elements($2::jsonb) x
        ON CONFLICT(world_id,patient_id) DO UPDATE SET ${column}=EXCLUDED.${column},${column}_captured_at=EXCLUDED.${column}_captured_at`, [world, JSON.stringify(items), capturedAt]);
    } else {
      await client.query(`INSERT INTO sim.resource_projections(world_id,site,resource_id,patient_id,kind,status,owner,version,body,captured_at)
        SELECT $1,$2,x->>'id',x->>'patientId',x->>'kind',x->>'status',x->>'owner',(x->>'version')::integer,x,$4
        FROM jsonb_array_elements($3::jsonb) x
        ON CONFLICT(world_id,site,resource_id) DO UPDATE SET patient_id=EXCLUDED.patient_id,kind=EXCLUDED.kind,status=EXCLUDED.status,owner=EXCLUDED.owner,version=EXCLUDED.version,body=EXCLUDED.body,captured_at=EXCLUDED.captured_at
        WHERE EXCLUDED.version >= sim.resource_projections.version`, [world, site, JSON.stringify(items), capturedAt]);
      for (const event of body.events || []) await client.query('INSERT INTO sim.events VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [world, event.id, event]);
      const { resources, ...context } = body;
      await client.query('INSERT INTO sim.endpoint_responses(world_id,endpoint,status,body) VALUES($1,$2,200,$3) ON CONFLICT(world_id,endpoint) DO UPDATE SET body=EXCLUDED.body,captured_at=now()', [world, `/api/sites/${site}/view:context`, context]);
    }
    await writeFile(resolve(archive, `${collection}-${offset}.json.gz`), await zip(JSON.stringify({ endpoint, world, capturedAt, body })));
    await client.query('INSERT INTO sim.import_pages(world_id,collection,page_offset,item_count,source_total,endpoint,captured_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [world, collection, offset, items.length, total, endpoint, capturedAt]);
    await client.query('COMMIT');
    done.add(pageKey);
    processed++;
    if (processed % 100 === 0) console.log(`Imported ${processed} pages this run; last ${collection} offset ${offset}`);
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function workers(jobs, action, concurrency = 2) {
  let cursor = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < jobs.length && !stopped) {
      const job = jobs[cursor++];
      try { await action(job); consecutiveFailures = 0; }
      catch (error) {
        failures.push({ job, error: error.message });
        consecutiveFailures++;
        console.error('Failed', JSON.stringify(job), error.message);
        if (consecutiveFailures >= 4) { stopped = true; console.error('Upstream is failing repeatedly. Stopping requests; committed pages are retained for resume.'); }
      }
      if (!done.has(`${job.collection}:${job.offset}`) || typeof job !== 'object') continue;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }));
  if (stopped) {
    await writeFile(resolve(archive, 'import-failures.json'), JSON.stringify(failures, null, 2));
    await pool.end();
    throw new Error('Import paused after repeated upstream failures. Rerun to resume missing pages.');
  }
}

// Import the complete, already validated same-world PDS capture where available.
const pdsCache = process.env.PDS_CAPTURE_DIR || '/tmp/anima-address-audit';
const demographicsFirst = await read('/api/nhs/pds/Patient?_count=100&_offset=0');
const population = demographicsFirst.total;
const demographicOffsets = Array.from({ length: Math.ceil(population / 100) }, (_, i) => i * 100);
await workers(demographicOffsets, async offset => {
  if (done.has(`demographics:${offset}`)) return;
  const endpoint = `/api/nhs/pds/Patient?_count=100&_offset=${offset}`;
  let body, capturedAt;
  // This explicit option reuses the researched team world's capture. Other runs fetch live.
  if (process.env.REUSE_PDS_CAPTURE === '1' && world === 'team-8942268fa18a') {
    try { const file = resolve(pdsCache, `page-${offset}.json`); body = JSON.parse(await readFile(file, 'utf8')); capturedAt = (await stat(file)).mtime.toISOString(); } catch { /* Missing captures are fetched below. */ }
  }
  body ||= offset === 0 ? demographicsFirst : await read(endpoint);
  const items = body.entry.map(e => e.resource);
  if (body.total !== population || items.length !== Math.min(100, population - offset)) throw new Error('PDS page size/total mismatch');
  await storePage({ collection: 'demographics', kind: 'demographics', offset, endpoint, body, items, total: population, capturedAt });
});
console.log('Demographics import complete.');

const directoryFirst = await read('/api/sites/gp/patients?offset=0');
if (directoryFirst.total !== population) throw new Error('Directory and PDS population totals disagree');
const jobs = Array.from({ length: Math.ceil(population / 30) }, (_, i) => ({ kind: 'directory', collection: 'directory', offset: i * 30, total: population, size: 30 }));
for (const site of [...team.scopes, 'patient'].filter((x, i, list) => list.indexOf(x) === i && x !== 'control' && x !== 'legacy')) {
  const first = await read(`/api/sites/${site}/view?limit=500&offset=0`);
  await storePage({ collection: site, kind: 'resources', site, offset: 0, endpoint: `/api/sites/${site}/view?limit=500&offset=0`, body: first, items: first.resources, total: first.resourceTotal });
  console.log(site, 'resources:', first.resourceTotal);
  for (let offset = 500; offset < first.resourceTotal; offset += 500) jobs.push({ kind: 'resources', collection: site, site, offset, total: first.resourceTotal, size: 500 });
}
await workers(jobs, async job => {
  if (done.has(`${job.collection}:${job.offset}`)) return;
  const endpoint = job.kind === 'directory' ? `/api/sites/gp/patients?offset=${job.offset}` : `/api/sites/${job.site}/view?limit=500&offset=${job.offset}`;
  const body = job.kind === 'directory' && job.offset === 0 ? directoryFirst : await read(endpoint);
  const items = job.kind === 'directory' ? body.items : body.resources;
  const total = job.kind === 'directory' ? body.total : body.resourceTotal;
  if (total !== job.total || items.length !== Math.min(job.size, total - job.offset)) throw new Error('Resource page size/total changed during import');
  await storePage({ ...job, endpoint, body, items, total });
});
const clockEnd = await read('/api/clock');
await pool.query('UPDATE sim.worlds SET clock_end=$2,finished_at=now() WHERE world_id=$1', [world, clockEnd]);
await writeFile(resolve(archive, 'import-failures.json'), JSON.stringify(failures, null, 2));
console.log('Import finished. Failed pages:', failures.length);
console.log((await pool.query('SELECT collection,count(*) pages,sum(item_count)::integer items,max(source_total) expected FROM sim.import_pages WHERE world_id=$1 GROUP BY collection ORDER BY collection', [world])).rows);
await pool.end();
if (failures.length) process.exitCode = 1;
