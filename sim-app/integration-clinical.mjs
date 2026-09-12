// Writes synthetic records and advances the running local application's clock.
// Run explicitly: node sim-app/integration-clinical.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import pg from 'pg';
const base = 'http://localhost:4192';
const database = process.env.APP_DATABASE || 'anima_sim_app_20260912';
if (database === 'anima_sim_replica_20260912') throw new Error('Integration writes must not target the archive');
const pool = new pg.Pool({ database, host: process.env.PGHOST || '/tmp' });
const runId = randomUUID();
async function request(path, input, expected = 200) {
  const response = await new Promise((resolve, reject) => {
    const req = httpRequest(`${base}${path}`, { method: input ? 'POST' : 'GET', headers: { Authorization: 'Bearer local-demo', ...(input ? { 'Content-Type': 'application/json' } : {}) }, signal: AbortSignal.timeout(30000) }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => body += chunk); res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(body) }); } catch (e) { reject(e); } }); res.on('error', reject);
    });
    req.on('error', reject); req.end(input ? JSON.stringify(input) : undefined);
  });
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(response.body)}`);
  return response.body;
}
async function persisted(id) {
  const { rows } = await pool.query('SELECT body FROM sim.resources WHERE resource_id=$1', [id]);
  assert.equal(rows.length, 1);
  return rows[0].body;
}
try {
  const patients = await pool.query("SELECT patient_id FROM sim.patients p WHERE NOT EXISTS (SELECT 1 FROM sim.resource_projections r WHERE r.patient_id=p.patient_id AND r.kind='device' AND r.status='active' AND (r.body#>>'{data,metric}'='steps' OR r.body->>'title'='Home activity watch')) ORDER BY patient_id DESC LIMIT 1");
  const patientId = patients.rows[0].patient_id;
  const initial = await request('/api/clock', { paused: true });
  const capacityBefore = await persisted('capacity-community');
  assert.ok(capacityBefore.data.remaining > 0, 'Community capacity required');
  const visit = await request('/api/sites/gp/actions', { type: 'schedule_visit', patientId, title: `Local integration visit ${runId}`, text: 'Synthetic local workflow check only.', clientRequestId: randomUUID() });
  const device = await request('/api/sites/wearables/actions', { type: 'connect_device', patientId, clientRequestId: randomUUID() });
  assert.equal(visit.status, 'scheduled');
  assert.equal((await persisted('capacity-community')).data.remaining, capacityBefore.data.remaining - 1);
  const pending = (await pool.query('SELECT type,due_at,status FROM sim.local_jobs WHERE resource_id=ANY($1)', [[visit.id, device.id]])).rows;
  assert.equal(pending.find(j => j.type === 'clinical.device-reading').due_at, initial.now + 10 * 60000);
  assert.equal(pending.find(j => j.type === 'clinical.visit-complete').due_at, initial.now + 90 * 60000);
  const readingsBefore = await request(`/api/sites/wearables/readings?patient=${patientId}`);
  assert.equal(readingsBefore.items.filter(r => r.data.deviceId === device.id).length, 0);
  await request('/api/clock', { paused: true, advanceMinutes: 10 });
  const readingsAt10 = await request(`/api/sites/wearables/readings?patient=${patientId}`);
  const first = readingsAt10.items.filter(r => r.data.deviceId === device.id);
  assert.equal(first.length, 1);
  assert.equal(first[0].data.observedAt, initial.now + 10 * 60000);
  assert.equal(first[0].data.synthetic, true);
  assert.equal(first[0].data.unit, 'steps/day', 'Home Health movement cards filter on this unit');
  assert.equal((await persisted(visit.id)).status, 'scheduled');
  await request('/api/clock', { paused: true, advanceMinutes: 120 });
  // A read processes newly scheduled jobs that are also due after a large jump.
  await request('/api/clock');
  const completed = await persisted(visit.id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.data.completedAt, initial.now + 90 * 60000);
  assert.equal(completed.data.capacityReserved, false);
  assert.equal((await persisted('capacity-community')).data.remaining, capacityBefore.data.remaining);
  const readingsAt130 = await request(`/api/sites/wearables/readings?patient=${patientId}`);
  const observations = readingsAt130.items.filter(r => r.data.deviceId === device.id).sort((a, b) => a.data.observedAt - b.data.observedAt);
  assert.deepEqual(observations.map(r => r.data.observedAt), [10, 70, 130].map(min => initial.now + min * 60000));
  const jobs = (await pool.query('SELECT type,due_at,status,error FROM sim.local_jobs WHERE resource_id=ANY($1) ORDER BY due_at', [[visit.id, device.id]])).rows;
  assert.equal(jobs.filter(j => j.status === 'failed').length, 0);
  assert.equal(jobs.filter(j => j.status === 'complete').length, 4);
  assert.equal(jobs.filter(j => j.status === 'pending').length, 1);
  const community = await request(`/api/sites/community/view?patient=${patientId}`);
  assert.ok(community.resources?.some(r => r.id === visit.id && r.status === 'completed'), 'Community view must show completed visit');
  console.log(JSON.stringify({ ok: true, patientId, visitId: visit.id, deviceId: device.id, capacity: { before: capacityBefore.data.remaining, after: (await persisted('capacity-community')).data.remaining }, readingsAtMinutes: [10, 70, 130], jobs, communityUrl: `${base}/community/?patient=${patientId}`, wearablesUrl: `${base}/wearables/?patient=${patientId}` }, null, 2));
} finally { await pool.end(); }
