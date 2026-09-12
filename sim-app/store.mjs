import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { handleAppointments } from './actions/appointments.mjs';
import { handleCorrespondence } from './actions/correspondence.mjs';
import { handlePharmacy } from './actions/pharmacy.mjs';
import { handleClinical, processClinicalJob } from './actions/clinical.mjs';

const connectionString = process.env.DATABASE_URL;
export const database = connectionString ? decodeURIComponent(new URL(connectionString).pathname.slice(1)) : process.env.APP_DATABASE || 'anima_sim_app_20260912';
if (database === 'anima_sim_replica_20260912') throw new Error('Use a separate app database, not the archival replica.');
export const pool = new pg.Pool({ ...(connectionString ? { connectionString } : { database, host: process.env.PGHOST || '/tmp' }), max: 10, connectionTimeoutMillis: 15000, idleTimeoutMillis: 30000 });
export const worldId = (await pool.query('SELECT world_id FROM sim.worlds ORDER BY started_at DESC LIMIT 1')).rows[0].world_id;
export const sites = ['gp', 'hospital', 'community', 'pharmacy', 'diagnostics', 'referrals', 'wearables', 'patient'];
await pool.query(await readFile(new URL('./local-schema.sql', import.meta.url), 'utf8'));
await pool.query("INSERT INTO sim.local_clock(world_id,sim_time,wall_time,paused,speed) SELECT world_id,(COALESCE(clock_end,clock_start)->>'now')::double precision,$1,true,60 FROM sim.worlds WHERE world_id=$2 ON CONFLICT DO NOTHING", [Date.now(), worldId]);

export function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
export function requireVersion(resource, expected) {
  if (!Number.isInteger(expected) || resource.version !== expected) fail(409, `Record changed. Expected version ${resource.version}; refresh and try again.`);
}

function patientProjection(resource) {
  if (resource.kind !== 'conversation') return resource;
  const entries = (resource.data.entries || []).filter(entry => entry.direction === 'incoming' || (entry.direction === 'outgoing' && entry.delivery?.at(-1)?.status === 'delivered'));
  if (!entries.length) return null;
  return { ...resource, data: { ...resource.data, assignee: '', entries } };
}

async function save(db, resource) {
  await db.query('DELETE FROM sim.resource_projections WHERE world_id=$1 AND resource_id=$2', [worldId, resource.id]);
  for (const site of sites.filter(site => resource.visibleTo.includes(site) || resource.owner === site)) {
    const body = site === 'patient' ? patientProjection(resource) : resource;
    if (!body) continue;
    await db.query('INSERT INTO sim.resource_projections(world_id,site,resource_id,patient_id,kind,status,owner,version,body,captured_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now())', [worldId, site, resource.id, resource.patientId || null, resource.kind, resource.status, resource.owner, resource.version, body]);
  }
  return resource;
}

async function rawGet(db, id) {
  const result = await db.query('SELECT body FROM sim.resources WHERE world_id=$1 AND resource_id=$2', [worldId, id]);
  if (!result.rows.length) fail(404, `Record ${id} not found.`);
  return result.rows[0].body;
}

async function makeContext(db, site, action, now) {
  const actor = { kind: 'team', name: 'Local copy' };
  const event = async resource => {
    const body = { id: randomUUID(), time: now, type: action.type, actor: actor.name, resourceId: resource.id, patientId: resource.patientId, detail: `${action.type}: ${resource.title}`, visibleTo: resource.visibleTo };
    await db.query('INSERT INTO sim.events(world_id,event_id,body) VALUES($1,$2,$3)', [worldId, body.id, body]);
  };
  const ctx = {
    db, site, action, worldId, now, actor, fail, requireVersion,
    get: id => rawGet(db, id),
    getPatient: async id => {
      const result = await db.query('SELECT directory FROM sim.patients WHERE world_id=$1 AND patient_id=$2', [worldId, id]);
      if (!result.rows[0]?.directory) fail(404, `Patient ${id} not found.`);
      return result.rows[0].directory;
    },
    list: async ({ kind, patientId, site: requestedSite } = {}) => {
      const params = [worldId];
      const where = ['world_id=$1'];
      if (kind) { params.push(Array.isArray(kind) ? kind : [kind]); where.push(`kind=ANY($${params.length}::text[])`); }
      if (patientId) { params.push(patientId); where.push(`patient_id=$${params.length}`); }
      if (requestedSite) { params.push(requestedSite); where.push(`site=$${params.length}`); }
      const table = requestedSite ? 'sim.resource_projections' : 'sim.resources';
      return (await db.query(`SELECT body FROM ${table} WHERE ${where.join(' AND ')}`, params)).rows.map(r => r.body);
    },
    create: async input => {
      if (input.patientId) await ctx.getPatient(input.patientId);
      const resource = { id: `local-${randomUUID()}`, kind: input.kind, title: input.title || input.kind, status: input.status || 'open', owner: input.owner || site, visibleTo: input.visibleTo || [site], priority: input.priority || 'routine', createdAt: now, data: input.data || {}, version: 1, ...input };
      resource.provenance = { created: { time: now, actor, source: site, action: action.type, version: 1 }, changes: [] };
      await save(db, resource); await event(resource); return resource;
    },
    update: async (resource, patch) => {
      const current = await rawGet(db, resource.id);
      requireVersion(current, resource.version);
      const updated = { ...current, ...patch, id: current.id, version: current.version + 1, provenance: { ...current.provenance, created: current.provenance?.created || null, changes: [...(current.provenance?.changes || []), { time: now, actor, source: site, action: action.type, version: current.version + 1 }] } };
      await save(db, updated); await event(updated); return updated;
    },
    schedule: async job => { await db.query('INSERT INTO sim.local_jobs(world_id,type,due_at,resource_id,payload) VALUES($1,$2,$3,$4,$5)', [worldId, job.type, job.at, job.resourceId, job.payload || {}]); },
  };
  return ctx;
}

async function transaction(fn) {
  const db = await pool.connect();
  try { await db.query('BEGIN'); await db.query('SELECT world_id FROM sim.worlds WHERE world_id=$1 FOR UPDATE', [worldId]); const result = await fn(db); await db.query('COMMIT'); return result; }
  catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}

async function clockIn(db) {
  const clock = (await db.query('SELECT * FROM sim.local_clock WHERE world_id=$1', [worldId])).rows[0];
  return { now: clock.sim_time + (clock.paused ? 0 : (Date.now() - Number(clock.wall_time)) * clock.speed), paused: clock.paused, speed: clock.speed };
}

async function runJobs(db, now) {
  // A finite limit prevents an hourly device from blocking a large clock advance forever.
  const jobs = (await db.query("SELECT * FROM sim.local_jobs WHERE world_id=$1 AND status='pending' AND due_at<=$2 ORDER BY due_at,id LIMIT 1000", [worldId, now])).rows;
  for (const row of jobs) {
    await db.query('SAVEPOINT local_job');
    try {
      const resource = await rawGet(db, row.resource_id);
      const ctx = await makeContext(db, sites.includes(resource.owner) ? resource.owner : 'gp', { type: row.type }, row.due_at);
      await processClinicalJob(ctx, { type: row.type, at: row.due_at, resourceId: row.resource_id, payload: row.payload });
      await db.query("UPDATE sim.local_jobs SET status='complete' WHERE id=$1", [row.id]);
      await db.query('RELEASE SAVEPOINT local_job');
    } catch (error) {
      await db.query('ROLLBACK TO SAVEPOINT local_job');
      await db.query("UPDATE sim.local_jobs SET status='failed',error=$2 WHERE id=$1", [row.id, error.message]);
    }
  }
}

export async function getClock() {
  return transaction(async db => {
    const clock = await clockIn(db); await runJobs(db, clock.now);
    const events = (await db.query('SELECT body FROM sim.events WHERE world_id=$1 ORDER BY (body->>\'time\')::numeric DESC LIMIT 100', [worldId])).rows.map(r => r.body);
    const result = { ...clock, events };
    await db.query('UPDATE sim.worlds SET clock_end=$2 WHERE world_id=$1', [worldId, result]);
    return result;
  });
}

export async function changeClock(input) {
  return transaction(async db => {
    const old = await clockIn(db);
    const paused = input.paused ?? old.paused;
    const speed = input.speed ?? old.speed;
    const advance = input.advanceMinutes ?? 0;
    if (typeof paused !== 'boolean' || !Number.isFinite(speed) || speed < 0 || speed > 3600 || !Number.isFinite(advance) || advance < 0 || advance > 10080) fail(400, 'Invalid simulation clock settings.');
    if (advance && !paused) fail(409, 'Pause the simulation before advancing time.');
    const now = old.now + advance * 60000;
    await db.query('UPDATE sim.local_clock SET sim_time=$2,wall_time=$3,paused=$4,speed=$5 WHERE world_id=$1', [worldId, now, Date.now(), paused, speed]);
    await runJobs(db, now);
    const result = { now, paused, speed, events: (await db.query('SELECT body FROM sim.events WHERE world_id=$1 ORDER BY (body->>\'time\')::numeric DESC LIMIT 100', [worldId])).rows.map(r => r.body) };
    await db.query('UPDATE sim.worlds SET clock_end=$2 WHERE world_id=$1', [worldId, result]);
    return result;
  });
}

export async function act(site, action, idempotencyKey) {
  if (!sites.includes(site)) fail(403, 'Unknown local service.');
  if (!action || typeof action.type !== 'string') fail(400, 'Action type is required.');
  if (site === 'patient' && (action.type !== 'messaging_action' || action.messagingCommand?.kind !== 'reply')) fail(403, 'Patient actions only support replies.');
  return transaction(async db => {
    const requestKey = idempotencyKey || action.clientRequestId;
    const request = { site, action };
    if (requestKey) {
      const cached = await db.query('SELECT response,request=$3::jsonb AS same FROM sim.local_requests WHERE world_id=$1 AND request_key=$2', [worldId, requestKey, JSON.stringify(request)]);
      if (cached.rows.length) { if (!cached.rows[0].same) fail(409, 'This idempotency key was used for a different action.'); return site === 'patient' ? patientProjection(cached.rows[0].response) : cached.rows[0].response; }
    }
    const clock = await clockIn(db);
    const ctx = await makeContext(db, site, action, clock.now);
    if (action.patientId) await ctx.getPatient(action.patientId);
    let result;
    for (const handler of [handleCorrespondence, handleAppointments, handlePharmacy, handleClinical]) {
      result = await handler(ctx); if (result !== undefined) break;
    }
    if (result === undefined) fail(400, `Action ${action.type} is not implemented for this local service.`);
    if (requestKey) await db.query('INSERT INTO sim.local_requests VALUES($1,$2,$3,$4)', [worldId, requestKey, request, result]);
    return site === 'patient' ? patientProjection(result) : result;
  });
}

export async function listResources(site, kinds) {
  const result = await pool.query('SELECT body FROM sim.resource_projections WHERE world_id=$1 AND site=$2 AND ($3::text[] IS NULL OR kind=ANY($3)) ORDER BY resource_id', [worldId, site, kinds || null]);
  return result.rows.map(r => r.body);
}

export async function workspace(site, kinds, patientId) {
  const resources = (await listResources(site, kinds)).filter(r => !patientId || r.patientId === patientId || !r.patientId);
  const ids = [...new Set(resources.map(r => r.patientId).filter(Boolean))];
  const patients = (await pool.query('SELECT patient_id AS id,name FROM sim.patient_directory WHERE world_id=$1 AND patient_id=ANY($2::text[])', [worldId, ids])).rows;
  return { resources, patients, now: (await clockIn(pool)).now };
}

export async function updateCall(id, patch) {
  return transaction(async db => { const ctx = await makeContext(db, 'gp', { type: 'reception_call' }, (await clockIn(db)).now); return ctx.update(await ctx.get(id), patch); });
}
