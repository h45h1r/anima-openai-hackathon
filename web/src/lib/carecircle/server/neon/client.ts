import { Pool } from 'pg';
import { AnimaClient, AnimaClientError } from '../anima/client';

let pool: Pool | undefined;
function database() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  return pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 15000, idleTimeoutMillis: 20000, allowExitOnIdle: true });
}
const scopes = ['gp', 'hospital', 'community', 'pharmacy', 'diagnostics', 'referrals', 'wearables'];

export class NeonClinicalClient extends AnimaClient {
  constructor() {
    // Writes use our backend's existing transactions against the same Neon database.
    super({ baseUrl: process.env.COMPANION_BASE_URL || 'http://localhost:4192', apiKey: 'local-demo' });
  }

  override async request<T>(method: string, path: string, init?: { query?: Record<string, string | number | undefined>; body?: unknown }): Promise<T> {
    if (method !== 'GET') return super.request<T>(method, path, init);
    const db = database();
    const world = (await db.query('SELECT world_id,team,COALESCE(clock_end,clock_start) AS clock FROM sim.worlds ORDER BY started_at DESC LIMIT 1')).rows[0];
    if (!world) throw new AnimaClientError('No patient records are available.', 'unavailable');
    const clockRow = (await db.query('SELECT sim_time,paused,speed FROM sim.local_clock WHERE world_id=$1', [world.world_id])).rows[0];
    const clock = clockRow ? { now: Number(clockRow.sim_time), paused: clockRow.paused, speed: Number(clockRow.speed), events: [] } : { ...world.clock, events: [] };
    let result: unknown;
    if (path === '/api/team') result = { team: 'Kindred', world: world.world_id, scopes };
    else if (path === '/api/clock') result = clock;
    else {
      const match = path.match(/^\/api\/sites\/([^/]+)\/(patients|view|appointments)$/);
      if (!match) {
        const endpoint = new URL(path, 'http://neon');
        for (const [key, value] of Object.entries(init?.query || {})) if (value !== undefined) endpoint.searchParams.set(key, String(value));
        const captured = await db.query('SELECT status,body FROM sim.endpoint_responses WHERE world_id=$1 AND endpoint=$2', [world.world_id, endpoint.pathname + endpoint.search]);
        if (!captured.rows.length || captured.rows[0].status >= 400) throw new AnimaClientError('Record endpoint was not captured.', 'not_found');
        return captured.rows[0].body as T;
      }
      if (!scopes.includes(match[1])) throw new AnimaClientError('Unknown clinical service.', 'not_found');
      const [, site, operation] = match;
      const query = init?.query || {};
      const offset = Math.max(0, Math.floor(Number(query.offset) || 0));
      if (operation === 'patients') {
        const q = String(query.q || '').slice(0, 300);
        const exact = /^SIM-\d+$/i.test(q);
        const filter = exact ? 'patient_id=$2' : "($2='' OR directory->>'name' ILIKE '%' || $2 || '%' OR patient_id ILIKE '%' || $2 || '%')";
        const values = [world.world_id, exact ? q.toUpperCase() : q];
        const [rows, count] = await Promise.all([
          db.query(`SELECT directory FROM sim.patients WHERE world_id=$1 AND ${filter} ORDER BY patient_id LIMIT 30 OFFSET $3`, [...values, offset]),
          db.query(`SELECT count(*)::integer total FROM sim.patients WHERE world_id=$1 AND ${filter}`, values),
        ]);
        result = { items: rows.rows.map(row => row.directory), total: count.rows[0].total, offset, limit: 30 };
      } else if (operation === 'view') {
        const patient = String(query.patient || '');
        if (!/^SIM-\d+$/.test(patient)) throw new AnimaClientError('Select a patient first.', 'bad_request');
        const limit = Math.max(1, Math.min(500, Math.floor(Number(query.limit) || 500)));
        const filter = 'world_id=$1 AND site=$2 AND (patient_id=$3 OR patient_id IS NULL)';
        const values = [world.world_id, site, patient];
        const [rows, count] = await Promise.all([
          db.query(`SELECT body FROM sim.resource_projections WHERE ${filter} ORDER BY resource_id LIMIT $4 OFFSET $5`, [...values, limit, offset]),
          db.query(`SELECT count(*)::integer total FROM sim.resource_projections WHERE ${filter}`, values),
        ]);
        result = { id: world.world_id, ...clock, resources: rows.rows.map(row => row.body), resourceTotal: count.rows[0].total, resourceOffset: offset, resourceLimit: limit };
      } else {
        const date = String(query.date || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AnimaClientError('Choose an appointment date.', 'bad_request');
        const start = Date.parse(date + 'T00:00:00Z');
        const rows = await db.query("SELECT body FROM sim.resource_projections WHERE world_id=$1 AND site=$2 AND kind IN ('appointment','appointment-session') AND COALESCE((body#>>'{data,startsAt}')::numeric,(body->>'dueAt')::numeric)>=$3 AND COALESCE((body#>>'{data,startsAt}')::numeric,(body->>'dueAt')::numeric)<$4 ORDER BY body#>>'{data,startsAt}'", [world.world_id, site, start, start + 86400000]);
        const records = rows.rows.map(row => row.body);
        const patients = await db.query('SELECT patient_id AS id,name FROM sim.patient_directory WHERE world_id=$1 AND patient_id=ANY($2::text[])', [world.world_id, [...new Set(records.map(record => record.patientId).filter(Boolean))]]);
        result = { appointments: records.filter(record => record.kind === 'appointment'), sessions: records.filter(record => record.kind === 'appointment-session'), patients: patients.rows };
      }
    }
    this.lastSuccessAt = new Date().toISOString();
    return result as T;
  }
}
export async function closeClinicalPool() { const previous = pool; pool = undefined; await previous?.end(); }
