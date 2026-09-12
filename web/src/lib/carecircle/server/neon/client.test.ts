import test from 'node:test';
import assert from 'node:assert/strict';
import { NeonClinicalClient, closeClinicalPool } from './client';

test('clinical reads use Neon with HTTP blocked and no Anima credentials', { skip: !process.env.DATABASE_URL }, async () => {
  assert.equal(process.env.KINDRED_RUNTIME_TEST_DATABASE, 'development');
  const fetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Unexpected HTTP request'); };
  try {
    const client = new NeonClinicalClient();
    const team = await client.getTeam();
    assert.ok(team.world);
    const patients = await client.searchPatients('gp', 'SIM-000006');
    assert.ok(!Array.isArray(patients));
    assert.equal(patients.items?.[0].id, 'SIM-000006');
    assert.equal(patients.total, 1);
    const first = await client.getView('gp', 'SIM-000006', 10, 0);
    const second = await client.getView('gp', 'SIM-000006', 10, 10);
    assert.equal(first.resources.length, 10);
    assert.ok(first.resourceTotal > 10);
    assert.ok(second.resources.every(r => !first.resources.some(previous => previous.id === r.id)));
    assert.ok([...first.resources, ...second.resources].every(r => !r.patientId || r.patientId === 'SIM-000006'));
    const other = await client.getView('gp', 'SIM-000001', 10, 0);
    assert.ok(other.resources.every(r => !r.patientId || r.patientId === 'SIM-000001'));
    await client.getAppointments('gp', '2026-09-12');
    assert.ok((await client.getClock()).now);
  } finally { globalThis.fetch = fetch; await closeClinicalPool(); }
});
