import test from 'node:test';
import assert from 'node:assert/strict';
import { chatId, normaliseChatIds } from './chat-ids';

test('chat UUIDs remain stable across requests and differ between patients', () => {
  const id = chatId('SIM-000006', 'eleanor-kindred');
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(chatId('SIM-000006', 'eleanor-kindred'), id);
  assert.equal(chatId('SIM-000006', id), id);
  assert.notEqual(chatId('SIM-000007', 'eleanor-kindred'), id);
  assert.notEqual(chatId('SIM-000006', 'grace-kindred'), id);
});

test('legacy threads, messages and pending replies move together without losing history', () => {
  const state = { patient: { simId: 'SIM-000006' }, threads: { 'eleanor-kindred': { id: 'eleanor-kindred', kind: 'direct' as const, memberIds: ['eleanor','kindred'], title: 'Kindred' } },
    messages: [{ id: 'existing-message', kind: 'chat' as const, senderId: 'eleanor', ts: '2026-09-12T12:00:00Z', threadId: 'eleanor-kindred', text: 'Keep this history', audience: ['eleanor'] }], busyThreads: ['eleanor-kindred'] };
  const next = normaliseChatIds(state);
  const id = chatId('SIM-000006', 'eleanor-kindred');
  assert.deepEqual(Object.keys(next.threads), [id]);
  assert.equal(next.messages[0].threadId, id);
  assert.equal(next.messages[0].text, 'Keep this history');
  assert.deepEqual(next.messages[0].audience, ['eleanor']);
  assert.deepEqual(next.busyThreads, [id]);
  assert.deepEqual(normaliseChatIds(next), next);
  assert.equal(state.messages[0].threadId, 'eleanor-kindred');
});
