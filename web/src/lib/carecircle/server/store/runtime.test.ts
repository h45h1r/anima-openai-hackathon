import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { careStore, withCareRuntime, closeCarePool } from './runtime';

test('Ask sessions persist across pools, serialize their own writes and isolate other sessions', { skip: !process.env.DATABASE_URL }, async () => {
  assert.equal(process.env.KINDRED_RUNTIME_TEST_DATABASE, 'development');
  const previous = process.env.KINDRED_RUNTIME_NAMESPACE;
  const namespace = `care-test-${randomUUID()}`;
  process.env.KINDRED_RUNTIME_NAMESPACE = namespace;
  const inspector = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await withCareRuntime(async () => {
      const s = careStore().createSession({ animaBaseUrl: 'https://example.invalid', animaApiKey: 'fixture' });
      assert.equal(s.sessionId, 'session-a');
      careStore().appendChatTurns(s.sessionId, 'patient-a', 'patient', [{ role: 'user', content: 'Saved question' }]);
    }, 'session-a');
    await closeCarePool();
    await withCareRuntime(async () => assert.equal(careStore().getChatTurns('session-a', 'patient-a', 'patient')[0].content, 'Saved question'), 'session-a');
    let release!: () => void;
    let started!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    const first = withCareRuntime(async () => { started(); await hold; careStore().updateSession('session-a', { teamLabel: 'first' }); }, 'session-a');
    await entered;
    const second = withCareRuntime(async () => { assert.equal(careStore().getSession('session-a')?.teamLabel, 'first'); careStore().updateSession('session-a', { teamLabel: 'second' }); }, 'session-a');
    await withCareRuntime(async () => assert.equal(careStore().getSession('session-a'), undefined), 'session-b');
    release(); await Promise.all([first, second]);
    await assert.rejects(withCareRuntime(async () => { careStore().updateSession('session-a', { teamLabel: 'rollback' }); throw new Error('fixture failure'); }, 'session-a'));
    await withCareRuntime(async () => assert.equal(careStore().getSession('session-a')?.teamLabel, 'second'), 'session-a');
  } finally {
    await closeCarePool();
    await inspector.query('DELETE FROM public.kindred_care_state WHERE namespace LIKE $1', [`${namespace}:%`]);
    await inspector.end();
    if (previous === undefined) delete process.env.KINDRED_RUNTIME_NAMESPACE; else process.env.KINDRED_RUNTIME_NAMESPACE = previous;
  }
});
