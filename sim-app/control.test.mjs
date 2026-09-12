import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createControlHandler } from './control.mjs';

async function setup() {
  const event = { id: 'event-1', resourceId: 'local-1', patientId: 'SIM-000006', time: 1789200000000, actor: 'Local copy', type: 'save_consultation' };
  const change = { actor: { kind: 'team', name: 'Local copy' }, action: 'save_consultation', source: 'gp', time: event.time, version: 1 };
  let clock = { now: event.time, paused: true, speed: 60, events: [event] };
  const queries = [];
  const pool = { async query(sql, params) {
    queries.push({ sql, params });
    if (sql.includes('SELECT started_at')) return { rows: [{ started_at: '2026-09-12T08:00:00Z', team: { apiKey: 'secret-do-not-return', scopes: ['gp'] } }] };
    if (sql.includes('AS patients')) return { rows: [{ patients: '50000', resources: '400000' }] };
    if (sql.includes('sim.events')) return { rows: [{ body: event }] };
    if (sql.includes("kind='capacity'")) return { rows: [{ body: { id: 'capacity-gp', data: { total: 6, remaining: 4 } } }] };
    if (sql.includes('sim.resources')) return { rows: [{ body: { id: 'local-1', patientId: 'SIM-000006', title: 'Review', kind: 'consultation', provenance: { created: change, changes: [] } } }] };
    if (sql.includes('sim.patients')) return { rows: [{ patient_id: 'SIM-000006', directory: { name: 'Eleanor Chen' } }] };
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const handler = await createControlHandler({ pool, worldId: 'local-world', getClock: async () => clock, changeClock: async input => { clock = { ...clock, ...input }; return clock; } });
  async function call(path, { method = 'GET', token = 'local-operator', input } = {}) {
    const req = Readable.from(input === undefined ? [] : [typeof input === 'string' ? input : JSON.stringify(input)]);
    req.method = method; req.headers = token ? { authorization: `Bearer ${token}` } : {};
    const result = { headers: {} };
    const res = { setHeader(k, v) { result.headers[k] = v; }, writeHead(status, headers) { result.status = status; Object.assign(result.headers, headers); }, end(text) { result.body = JSON.parse(text); } };
    result.handled = await handler(req, res, new URL(path, 'http://localhost'));
    return result;
  }
  return { call, queries };
}

test('operator authentication protects control routes and ignores unrelated routes', async () => {
  const { call, queries } = await setup();
  assert.equal((await call('/api/control/teams', { token: 'local-demo' })).status, 401);
  assert.equal((await call('/api/control/teams', { token: null })).status, 401);
  assert.equal((await call('/api/team')).handled, false);
  assert.equal(queries.length, 0);
});

test('teams return local DB counts without imported credentials or fabricated request logs', async () => {
  const { call } = await setup();
  const { body } = await call('/api/control/teams');
  assert.equal(body.teams[0].patientCount, 50000);
  assert.equal(body.teams[0].affectedPatientCount, 1);
  assert.equal(body.logging.enabled, false);
  assert.equal(body.teams[0].requestCount, 0);
  assert.ok(!JSON.stringify(body).includes('secret-do-not-return'));
  assert.deepEqual((await call('/api/control/worlds')).body, ['local-world']);
});

test('activity reports actual local changes and named affected patients', async () => {
  const { call } = await setup();
  const { body } = await call('/api/control/teams/local-world/activity');
  assert.equal(body.changes[0].resourceId, 'local-1');
  assert.equal(body.patients[0].name, 'Eleanor Chen');
  assert.equal(body.patients[0].changeCount, 1);
  assert.deepEqual(body.requests, []);
});

test('team connection issues only a local session and rejects unknown worlds', async () => {
  const { call } = await setup();
  const result = await call('/api/control/teams/local-world/session', { method: 'POST', input: {} });
  assert.equal(result.body.apiKey, 'local-demo');
  assert.equal(result.body.created, false);
  assert.match(result.headers['Set-Cookie'], /HttpOnly/);
  assert.equal((await call('/api/control/teams/unknown/session', { method: 'POST' })).status, 404);
});

test('control view exposes live capacity and clock; selected-world clock changes are delegated', async () => {
  const { call } = await setup();
  const { body } = await call('/api/sites/control/view?world=local-world&limit=1');
  assert.equal(body.capacities[0].data.remaining, 4);
  assert.equal(body.capabilities.incidentEngine, false);
  assert.equal((await call('/api/clock?world=local-world', { method: 'POST', input: { speed: 120 } })).body.speed, 120);
  assert.equal((await call('/api/clock?world=other', { method: 'POST', input: { speed: 120 } })).status, 404);
  assert.equal((await call('/api/sites/control/view?limit=0')).status, 400);
});

test('hidden engines and destructive organiser actions report unsupported without writes', async () => {
  const { call, queries } = await setup();
  for (const path of ['/api/control/agents', '/api/control/incidents', '/api/control/population', '/api/control/teams/delete']) {
    const result = await call(path, { method: 'POST', input: { enabled: true } });
    assert.equal(result.status, 501);
    assert.match(result.body.error, /No changes were made/);
  }
  assert.equal(queries.length, 0);
});
