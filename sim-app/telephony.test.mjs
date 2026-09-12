import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { attachTelephony } from './telephony.mjs';

async function fixture(t) {
  const resources = ['one', 'two'].map((id, index) => ({
    id, patientId: `patient-${id}`, kind: 'telephone-call', status: 'waiting', version: 1,
    data: { patientName: `Patient ${id}`, phone: '07700 900000', reason: 'Appointment', script: 'I need an appointment.', voiceSeed: index, state: { kind: 'waiting', queuedAt: Date.now() + index } },
  }));
  const server = createServer();
  const telephony = attachTelephony(server, {
    listCalls: async () => structuredClone(resources),
    authenticate: async (key) => key === 'local',
    updateCall: async (id, patch) => {
      const resource = resources.find((item) => item.id === id);
      Object.assign(resource, patch, { version: resource.version + 1 });
      return structuredClone(resource);
    },
  });
  await telephony.ready;
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await telephony.close(); await new Promise((resolve) => server.close(resolve)); });
  async function join(name) {
    const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/api/telephony/live`);
    const messages = [];
    const listeners = new Set();
    socket.on('message', (data) => {
      messages.push(JSON.parse(data));
      for (const listener of listeners) listener();
    });
    const wait = (predicate) => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { listeners.delete(check); reject(new Error('Timed out waiting for reception message.')); }, 2000);
      function check() {
        const index = messages.findIndex(predicate);
        if (index < 0) return;
        clearTimeout(timeout);
        listeners.delete(check);
        resolve(messages.splice(index, 1)[0]);
      }
      listeners.add(check);
      check();
    });
    await once(socket, 'open');
    socket.send(JSON.stringify({ kind: 'authenticate', apiKey: 'local', name }));
    const snapshot = await wait((message) => message.kind === 'snapshot');
    let sequence = 0;
    return {
      socket, snapshot, wait,
      async act(command, id = `${name}-${++sequence}`) {
        socket.send(JSON.stringify({ kind: 'command', requestId: id, command }));
        return wait((message) => message.requestId === id);
      },
    };
  }
  return { join, resources };
}

test('reception claims, holds, completes with notes and persists callback outcome', async (t) => {
  const { join, resources } = await fixture(t);
  const desk = await join('Receptionist');
  assert.equal(desk.snapshot.calls.length, 2);
  let snapshot = await desk.act({ kind: 'answer', callId: 'one', version: 1 }, 'claim');
  assert.equal(snapshot.kind, 'snapshot');
  assert.equal(snapshot.calls[0].state.memberId, desk.snapshot.memberId);
  assert.equal(snapshot.members[0].status, 'on-call');
  snapshot = await desk.act({ kind: 'answer', callId: 'one', version: 1 }, 'claim');
  assert.equal(snapshot.calls[0].version, 2, 'duplicate request does not repeat mutation');
  const stale = await desk.act({ kind: 'hold', callId: 'one', version: 1, held: true });
  assert.equal(stale.kind, 'error');
  snapshot = await desk.act({ kind: 'hold', callId: 'one', version: 2, held: true });
  assert.equal(snapshot.calls[0].state.held, true);
  snapshot = await desk.act({ kind: 'next', callId: 'one', version: 3, note: 'Booked morning visit.' });
  assert.equal(snapshot.calls[0].state.note, 'Booked morning visit.');
  assert.equal(snapshot.calls[1].state.kind, 'active');
  snapshot = await desk.act({ kind: 'callback', callId: 'two', version: 2, note: 'Callback requested.' });
  assert.equal(snapshot.calls[1].state.outcome, 'callback');
  assert.equal(resources[1].status, 'completed');
  assert.equal(resources[1].data.state.note, 'Callback requested.');
});

test('separate receptionists cannot claim or finish each other’s calls; transfer and disconnect work', async (t) => {
  const { join, resources } = await fixture(t);
  const first = await join('First');
  const second = await join('Second');
  await first.act({ kind: 'answer', callId: 'one', version: 1 });
  assert.equal((await second.act({ kind: 'answer', callId: 'one', version: 1 })).kind, 'error');
  assert.equal((await second.act({ kind: 'end', callId: 'one', version: 2 })).kind, 'error');
  const transferred = await first.act({ kind: 'transfer', callId: 'one', version: 2, targetMemberId: second.snapshot.memberId });
  assert.equal(transferred.calls[0].state.memberId, second.snapshot.memberId);
  second.socket.close();
  const requeued = await first.wait((message) => message.kind === 'snapshot' && message.calls[0].version === 4);
  assert.equal(requeued.calls[0].state.kind, 'waiting');
  assert.equal(resources[0].status, 'waiting');
  assert.equal(requeued.members.length, 1);
});

test('availability, rename, next and request ID validation follow the captured protocol', async (t) => {
  const { join } = await fixture(t);
  const desk = await join('Receptionist');
  assert.equal((await desk.act({ kind: 'availability', available: false })).members[0].status, 'away');
  assert.equal((await desk.act({ kind: 'next', callId: null, version: null })).kind, 'error');
  await desk.act({ kind: 'availability', available: true });
  assert.equal((await desk.act({ kind: 'rename', name: 'New name' })).members[0].name, 'New name');
  const answered = await desk.act({ kind: 'next', callId: null, version: null }, 'same-id');
  assert.equal(answered.calls[0].state.answeredBy, 'New name');
  assert.equal((await desk.act({ kind: 'end', callId: 'one', version: 2 }, 'same-id')).kind, 'error');
});
