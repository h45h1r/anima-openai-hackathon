import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { withRuntimeSnapshot, runtimeSnapshot, restoreRuntimeSnapshot, closeRuntimePool } from './runtime-store.ts';

test('runtime restore preserves canonical clinical and consent data while restoring mutable fields', () => {
  const base = { messages: [], audit: [{ id: 'consent-db-current', ts: '2026-09-12', summary: 'Current consent' }],
    consentRequests: [], levels: { day_to_day: ['appointments'] }, nextActions: [], appointments: [{ id: 'appt-a', announcedToFamily: false }],
    consent: { family: { appointments: false } }, ehr: { consentVersion: 9 }, busyThreads: ['stale-busy'], labs: [{ id: 'live-lab' }],
  };
  const saved = { messages: [{ id: 'm1', text: 'Saved message' }], audit: [{ id: 'runtime-audit', ts: '2026-09-11' }],
    consentRequests: [{ id: 'request-a', status: 'pending' }], levels: { day_to_day: ['appointments', 'medications'] },
    nextActions: [{ id: 'action-a', done: false }], announcedAppointmentIds: ['appt-a'],
  };
  const restored = restoreRuntimeSnapshot(base, saved);
  assert.deepEqual(restored.messages, saved.messages);
  assert.deepEqual(restored.consentRequests, saved.consentRequests);
  assert.deepEqual(restored.levels, saved.levels);
  assert.deepEqual(restored.nextActions, saved.nextActions);
  assert.equal(restored.appointments[0].announcedToFamily, true);
  assert.deepEqual(restored.consent, base.consent);
  assert.deepEqual(restored.ehr, base.ehr);
  assert.deepEqual(restored.labs, base.labs);
  assert.deepEqual(restored.busyThreads, []);
  assert.deepEqual(restored.audit.map(a => a.id), ['consent-db-current', 'runtime-audit']);
  assert.deepEqual(runtimeSnapshot(restored), saved);
});

test('PostgreSQL runtime survives independent pools, serializes writes, isolates patients and rolls back failures', {
  skip: !process.env.DATABASE_URL,
}, async () => {
  assert.equal(process.env.KINDRED_RUNTIME_TEST_DATABASE, 'development', 'Explicitly opt into the development database fixture test.');
  const namespace = `runtime-test-${randomUUID()}`;
  const previous = process.env.KINDRED_RUNTIME_NAMESPACE;
  process.env.KINDRED_RUNTIME_NAMESPACE = namespace;
  const other = await import(`./runtime-store.ts?instance=${randomUUID()}`);
  const inspector = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await withRuntimeSnapshot('patient-a', true, async () => ({ value: null, snapshot: { messages: [{ id: 'initial' }], announcedAppointmentIds: ['appointment-a'] } }));
    await closeRuntimePool();
    const fresh = await other.withRuntimeSnapshot('patient-a', false, async snapshot => ({ value: snapshot }));
    assert.equal(fresh.messages[0].id, 'initial');
    assert.deepEqual(fresh.announcedAppointmentIds, ['appointment-a']);

    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    let release;
    const held = new Promise(resolve => { release = resolve; });
    const first = withRuntimeSnapshot('patient-a', true, async snapshot => {
      entered(); await held;
      return { value: null, snapshot: { ...snapshot, messages: [...snapshot.messages, { id: 'first' }] } };
    });
    await started;
    const committedDuringWrite = await other.withRuntimeSnapshot('patient-a', false, async snapshot => ({ value: snapshot }));
    assert.deepEqual(committedDuringWrite.messages.map(message => message.id), ['initial']);
    const second = other.withRuntimeSnapshot('patient-a', true, async snapshot => ({ value: null, snapshot: { ...snapshot, messages: [...snapshot.messages, { id: 'second' }] } }));
    await withRuntimeSnapshot('patient-b', true, async () => ({ value: null, snapshot: { messages: [{ id: 'other-patient' }] } }));
    release();
    await Promise.all([first, second]);
    const saved = await withRuntimeSnapshot('patient-a', false, async snapshot => ({ value: snapshot }));
    assert.deepEqual(saved.messages.map(message => message.id), ['initial', 'first', 'second']);
    assert.deepEqual((await withRuntimeSnapshot('patient-b', false, async snapshot => ({ value: snapshot }))).messages, [{ id: 'other-patient' }]);

    await assert.rejects(withRuntimeSnapshot('patient-a', true, async snapshot => { snapshot.messages.push({ id: 'must-rollback' }); throw new Error('Simulated request failure'); }), /Simulated request failure/);
    await withRuntimeSnapshot('patient-a', true, async snapshot => { snapshot.messages.push({ id: 'rejected-response' }); return { value: false }; });
    assert.deepEqual(await other.withRuntimeSnapshot('patient-a', false, async snapshot => ({ value: snapshot })), saved);
    const row = (await inspector.query('SELECT revision FROM public.kindred_runtime_state WHERE namespace=$1 AND patient_id=$2', [namespace, 'patient-a'])).rows[0];
    assert.equal(Number(row.revision), 3);
  } finally {
    await inspector.query('DELETE FROM public.kindred_runtime_state WHERE namespace=$1', [namespace]);
    await inspector.end();
    await closeRuntimePool(); await other.closeRuntimePool();
    if (previous === undefined) delete process.env.KINDRED_RUNTIME_NAMESPACE; else process.env.KINDRED_RUNTIME_NAMESPACE = previous;
  }
});
