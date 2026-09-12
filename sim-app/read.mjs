import http from 'node:http';
import { pool, database } from './store.mjs';

const worldResult = await pool.query('SELECT world_id FROM sim.worlds ORDER BY started_at DESC LIMIT 1');
const world = process.env.REPLICA_WORLD || worldResult.rows[0]?.world_id;
if (!world) throw new Error('Import a world before starting the replica API.');
const sites = new Set(['gp', 'hospital', 'community', 'pharmacy', 'diagnostics', 'referrals', 'wearables', 'patient']);
const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Anima-Source': 'local-replica' });
  res.end(type === 'text/html' ? body : JSON.stringify(body));
};
const bounded = (value, fallback, maximum) => {
  if (value === null) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > maximum) throw new Error('Invalid pagination value');
  return number;
};
async function currentWorld() {
  return (await pool.query('SELECT team,COALESCE(clock_end,clock_start) AS clock FROM sim.worlds WHERE world_id=$1', [world])).rows[0];
}

export const readServer = http.createServer(async (req, res) => {
  if (req.method !== 'GET') return send(res, 405, { error: 'The local replica is read-only. No upstream writes are forwarded.' });
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    if (path === '/' || path === '/healthz' || path === '/replica/coverage') {
      const patients = (await pool.query('SELECT count(*)::integer total,count(directory)::integer directory,count(demographics)::integer demographics FROM sim.patients WHERE world_id=$1', [world])).rows[0];
      const resources = (await pool.query('SELECT site,count(*)::integer records FROM sim.resource_projections WHERE world_id=$1 GROUP BY site ORDER BY site', [world])).rows;
      return send(res, 200, { source: 'local PostgreSQL replica', database, world, readOnly: true, patients, resources, limitations: ['No organiser-only snapshot, hidden scheduled jobs, or full historical event log.', 'No patient/family authentication or consent enforcement in this development API.'] });
    }
    if (path === '/api/team') return send(res, 200, (await currentWorld()).team);
    if (path === '/api/clock') return send(res, 200, (await currentWorld()).clock);
    const siteRoute = path.match(/^\/api\/sites\/([^/]+)\/(patients|view|appointments)$/);
    if (siteRoute) {
      const [, site, operation] = siteRoute;
      if (!sites.has(site)) return send(res, 404, { error: 'This service was not captured.' });
      if (operation === 'patients') {
        const offset = bounded(url.searchParams.get('offset'), 0, 1e8);
        const q = (url.searchParams.get('q') || '').slice(0, 300);
        const result = await pool.query(`SELECT directory FROM sim.patients WHERE world_id=$1 AND directory IS NOT NULL AND ($2='' OR directory::text ILIKE '%' || $2 || '%') ORDER BY patient_id LIMIT 30 OFFSET $3`, [world, q, offset]);
        const count = await pool.query(`SELECT count(*)::integer total FROM sim.patients WHERE world_id=$1 AND directory IS NOT NULL AND ($2='' OR directory::text ILIKE '%' || $2 || '%')`, [world, q]);
        return send(res, 200, { total: count.rows[0].total, items: result.rows.map(r => r.directory) });
      }
      if (operation === 'appointments') {
        const date = url.searchParams.get('date') || new Date((await currentWorld()).clock.now).toISOString().slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return send(res, 400, { error: 'Use a YYYY-MM-DD date.' });
        const start = Date.parse(date + 'T00:00:00Z');
        if (!Number.isFinite(start)) return send(res, 400, { error: 'Invalid date.' });
        const result = await pool.query(`SELECT body FROM sim.resource_projections WHERE world_id=$1 AND site=$2 AND kind IN ('appointment','appointment-session') AND COALESCE((body#>>'{data,startsAt}')::numeric,(body->>'dueAt')::numeric)>=$3 AND COALESCE((body#>>'{data,startsAt}')::numeric,(body->>'dueAt')::numeric)<$4 ORDER BY body#>>'{data,startsAt}'`, [world, site, start, start + 86400000]);
        const records = result.rows.map(r => r.body);
        const ids = [...new Set(records.map(r => r.patientId).filter(Boolean))];
        const patients = await pool.query('SELECT patient_id AS id,name FROM sim.patient_directory WHERE world_id=$1 AND patient_id=ANY($2::text[])', [world, ids]);
        return send(res, 200, { appointments: records.filter(r => r.kind === 'appointment'), sessions: records.filter(r => r.kind === 'appointment-session'), patients: patients.rows });
      }
      const patient = url.searchParams.get('patient');
      const offset = bounded(url.searchParams.get('offset'), 0, 1e8);
      const limit = bounded(url.searchParams.get('limit'), 500, 500);
      if (limit < 1) return send(res, 400, { error: 'limit must be at least 1' });
      const where = 'world_id=$1 AND site=$2 AND ($3::text IS NULL OR patient_id=$3 OR patient_id IS NULL)';
      const [records, count, context] = await Promise.all([
        pool.query(`SELECT body FROM sim.resource_projections WHERE ${where} ORDER BY resource_id LIMIT $4 OFFSET $5`, [world, site, patient, limit, offset]),
        pool.query(`SELECT count(*)::integer total FROM sim.resource_projections WHERE ${where}`, [world, site, patient]),
        pool.query('SELECT body FROM sim.endpoint_responses WHERE world_id=$1 AND endpoint=$2', [world, `/api/sites/${site}/view:context`]),
      ]);
      return send(res, 200, { ...context.rows[0]?.body, ...(await currentWorld()).clock, resources: records.rows.map(r => r.body), resourceTotal: count.rows[0].total, resourceOffset: offset, resourceLimit: limit });
    }
    const patientRead = path.match(/^\/api\/nhs\/pds\/Patient\/(SIM-\d+)$/);
    if (patientRead) {
      const result = await pool.query('SELECT demographics FROM sim.patients WHERE world_id=$1 AND patient_id=$2', [world, patientRead[1]]);
      return result.rows[0]?.demographics ? send(res, 200, result.rows[0].demographics, 'application/fhir+json') : send(res, 404, { error: 'Patient not found' });
    }
    if (path === '/api/nhs/pds/Patient') {
      const count = bounded(url.searchParams.get('_count'), 20, 100);
      const offset = bounded(url.searchParams.get('_offset'), 0, 1e8);
      const conditions = ['world_id=$1', 'demographics IS NOT NULL'];
      const values = [world];
      for (const [param, expression] of [['family', "demographics#>>'{name,0,family}'"], ['given', "demographics#>>'{name,0,given,0}'"], ['birthdate', "demographics->>'birthDate'"], ['identifier', 'patient_id']]) {
        let value = url.searchParams.get(param);
        if (value === null) continue;
        if (param === 'identifier') value = value.split('|').at(-1);
        values.push(value);
        conditions.push(param === 'family' || param === 'given' ? `${expression} ILIKE $${values.length} || '%'` : `${expression}=$${values.length}`);
      }
      const where = conditions.join(' AND ');
      const total = (await pool.query(`SELECT count(*)::integer total FROM sim.patients WHERE ${where}`, values)).rows[0].total;
      const result = await pool.query(`SELECT demographics FROM sim.patients WHERE ${where} ORDER BY patient_id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, count, offset]);
      const link = [];
      if (offset + count < total) { const next = new URL(url); next.searchParams.set('_offset', offset + count); link.push({ relation: 'next', url: next.pathname + next.search }); }
      return send(res, 200, { resourceType: 'Bundle', type: 'searchset', total, entry: result.rows.map(r => ({ resource: r.demographics })), link }, 'application/fhir+json');
    }
    const endpoint = path + url.search;
    const captured = await pool.query('SELECT status,body FROM sim.endpoint_responses WHERE world_id=$1 AND endpoint=$2', [world, endpoint]);
    if (captured.rows.length) {
      const { status, body } = captured.rows[0];
      return body.contentType === 'text/html' ? send(res, status, body.html, 'text/html') : send(res, status, body);
    }
    return send(res, 404, { error: 'This exact endpoint/query was not captured. Use the resource tables or supported local read routes.' });
  } catch (error) {
    console.error(error.message);
    send(res, error.message === 'Invalid pagination value' ? 400 : 500, { error: error.message });
  }
});
