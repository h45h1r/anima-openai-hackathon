import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulator } from './simulator.mjs';
import { handle } from './server.mjs';
import http from 'node:http';

test('patient view retrieves every resource page using patient scope', async () => {
  const calls = [];
  const client = new Simulator('test-key', { fetcher: async (url, options) => {
    calls.push({ url, options });
    const offset = Number(url.searchParams.get('offset'));
    return { ok: true, json: async () => ({ resourceTotal: 3, resources: offset === 0 ? [{ id: 'a' }, { id: 'b' }] : [{ id: 'c' }] }) };
  } });
  const result = await client.view('SIM-000006');
  assert.deepEqual(result.resources.map(r => r.id), ['a', 'b', 'c']);
  assert.equal(calls[1].url.searchParams.get('offset'), '2');
  assert.ok(calls.every(c => c.url.searchParams.get('patient') === 'SIM-000006'));
  assert.ok(calls.every(c => c.options.headers.Authorization === 'Bearer test-key'));
});

test('search response must contain the exact requested patient', async () => {
  const client = new Simulator('test-key', { fetcher: async () => ({ ok: true, json: async () => ({ items: [{ id: 'SIM-000001' }] }) }) });
  await assert.rejects(client.patient('SIM-000006'), /not found/);
});

test('empty page cannot silently truncate a patient record', async () => {
  const client = new Simulator('test-key', { fetcher: async () => ({ ok: true, json: async () => ({ resourceTotal: 1, resources: [] }) }) });
  await assert.rejects(client.view('SIM-000006'), /pagination stopped/);
});

test('local API blocks writes and preserves snapshot patient boundaries', async () => {
  const server = http.createServer(handle);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const mutation = await fetch(origin + '/api/patient?mode=snapshot', { method: 'POST', body: '{}' });
    assert.equal(mutation.status, 405);
    const otherPatient = await fetch(origin + '/api/patient?mode=snapshot&patient=SIM-000001');
    assert.equal(otherPatient.status, 404);
    const response = await fetch(origin + '/api/patient?mode=snapshot&patient=SIM-000006');
    const data = await response.json();
    assert.equal(data.patient.name, 'Eleanor Chen');
    assert.equal(data.mode, 'snapshot');
    assert.ok(data.view.resources.every(r => !r.patientId || r.patientId === data.patient.id));
    assert.equal((await fetch(origin + '/data/snapshot.json')).status, 404);
    assert.equal((await fetch(origin + '/server.mjs')).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
