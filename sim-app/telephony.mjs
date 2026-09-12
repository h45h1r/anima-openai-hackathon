import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';

// The captured Reception Calls client speaks this snapshot/command protocol.
// Caller speech is browser SpeechSynthesis; no telephone or audio service is used.
export function attachTelephony(server, services) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const members = new Map();
  let revision = 0;
  let pending = Promise.resolve();
  let closed = false;
  const serial = (work) => {
    const result = pending.then(work);
    pending = result.catch(() => {});
    return result;
  };
  const send = (socket, message) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };
  const readCalls = async () => (await services.listCalls()).map((resource) => ({
    ...resource.data, id: resource.id, patientId: resource.patientId, version: resource.version,
  }));

  async function broadcast(requester, requestId) {
    const calls = await readCalls();
    const roster = [...members.values()].map((member) => {
      const active = calls.find((call) => call.state.kind === 'active' && call.state.memberId === member.id);
      return { id: member.id, name: member.name, status: active ? 'on-call' : member.available ? 'available' : 'away', callId: active?.id ?? null };
    });
    revision += 1;
    for (const [socket, member] of members) {
      send(socket, {
        kind: 'snapshot', memberId: member.id, revision, calls, members: roster,
        ...(socket === requester && requestId ? { requestId } : {}),
      });
    }
  }

  async function setState(call, state) {
    return services.updateCall(call.id, {
      status: state.kind,
      data: { patientName: call.patientName, phone: call.phone, reason: call.reason, script: call.script, voiceSeed: call.voiceSeed, state },
    });
  }

  function currentCall(calls, command) {
    const call = calls.find((candidate) => candidate.id === command.callId);
    if (!call) throw new Error('Call not found.');
    if (!Number.isSafeInteger(command.version) || command.version <= 0 || call.version !== command.version) {
      throw new Error('This call has changed. Use its latest status and try again.');
    }
    return call;
  }

  function requireOwner(call, member) {
    if (call.state.kind !== 'active' || call.state.memberId !== member.id) {
      throw new Error('You are not handling this call.');
    }
  }

  async function command(member, command) {
    if (!command || typeof command.kind !== 'string') throw new Error('A call command is required.');
    if (command.kind === 'rename') {
      const name = typeof command.name === 'string' ? command.name.trim() : '';
      if (!name || name.length > 60) throw new Error('Enter a name between 1 and 60 characters.');
      member.name = name;
      return;
    }
    const calls = await readCalls();
    const active = calls.find((call) => call.state.kind === 'active' && call.state.memberId === member.id);
    if (command.kind === 'availability') {
      if (typeof command.available !== 'boolean') throw new Error('Availability must be true or false.');
      if (active) throw new Error('End your current call before changing availability.');
      member.available = command.available;
      return;
    }
    if (!['answer', 'next', 'end', 'callback', 'hold', 'transfer'].includes(command.kind)) {
      throw new Error(`Unsupported call command: ${command.kind}`);
    }
    const note = command.note ?? '';
    if (typeof note !== 'string' || note.length > 2000) throw new Error('Call notes must be at most 2,000 characters.');
    const answer = async (call) => {
      if (!member.available) throw new Error('Set yourself available before answering a call.');
      if (call.state.kind !== 'waiting') throw new Error('This call is no longer waiting.');
      await setState(call, { kind: 'active', memberId: member.id, answeredBy: member.name, answeredAt: Date.now(), held: false });
    };
    const finish = async (call, outcome) => {
      requireOwner(call, member);
      await setState(call, {
        kind: 'completed', answeredBy: call.state.answeredBy, answeredAt: call.state.answeredAt,
        endedAt: Date.now(), note, outcome,
      });
    };
    if (command.kind === 'next') {
      if (command.callId === null && command.version === null) {
        if (active) throw new Error('End your current call first.');
      } else {
        await finish(currentCall(calls, command), 'completed');
      }
      const next = calls.filter((call) => call.state.kind === 'waiting')
        .sort((a, b) => a.state.queuedAt - b.state.queuedAt)[0];
      if (next) await answer(next);
      return;
    }
    const call = currentCall(calls, command);
    if (command.kind === 'answer') {
      if (active) throw new Error('End your current call first.');
      return answer(call);
    }
    requireOwner(call, member);
    if (command.kind === 'end' || command.kind === 'callback') return finish(call, command.kind === 'callback' ? 'callback' : 'completed');
    if (command.kind === 'hold') {
      if (typeof command.held !== 'boolean') throw new Error('Hold must be true or false.');
      return setState(call, { ...call.state, held: command.held });
    }
    const target = [...members.values()].find((candidate) => candidate.id === command.targetMemberId);
    if (!target || target.id === member.id || !target.available || calls.some((candidate) => candidate.state.kind === 'active' && candidate.state.memberId === target.id)) {
      throw new Error('Choose another available receptionist.');
    }
    return setState(call, { ...call.state, memberId: target.id, answeredBy: target.name, held: false });
  }

  // A server restart drops receptionist sessions; orphaned active calls rejoin the queue.
  const ready = serial(async () => {
    for (const call of await readCalls()) {
      if (call.state.kind === 'active') await setState(call, { kind: 'waiting', queuedAt: Date.now() });
    }
  });

  const upgrade = (request, socket, head) => {
    if (request.url?.split('?')[0] !== '/api/telephony/live') return;
    // Match the original same-origin desk. Non-browser local tools omit Origin.
    if (request.headers.origin) {
      try {
        if (new URL(request.headers.origin).host !== request.headers.host) {
          socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
          return;
        }
      } catch {
        socket.destroy();
        return;
      }
    }
    wss.handleUpgrade(request, socket, head, (client) => wss.emit('connection', client, request));
  };
  server.on('upgrade', upgrade);

  wss.on('connection', (socket) => {
    const authTimeout = setTimeout(() => socket.close(1008, 'Join reception first.'), 5000);
    const requests = new Map();
    socket.on('error', () => {});
    socket.on('message', (data, binary) => {
      serial(async () => {
        if (closed || socket.readyState !== WebSocket.OPEN) return;
        let message;
        try {
          if (binary) throw new Error('Reception accepts JSON text messages only.');
          try { message = JSON.parse(data.toString()); } catch { throw new Error('Unreadable reception message.'); }
          if (!message || typeof message !== 'object') throw new Error('A reception message is required.');
          if (!members.has(socket)) {
            const name = typeof message.name === 'string' ? message.name.trim() : '';
            if (message.kind !== 'authenticate' || typeof message.apiKey !== 'string' || !message.apiKey || message.apiKey.length > 200 || !name || name.length > 60) {
              socket.close(1008, 'A local workspace key and receptionist name are required.');
              return;
            }
            if (services.authenticate && !await services.authenticate(message.apiKey)) {
              socket.close(1008, 'Unknown local workspace key.');
              return;
            }
            await ready;
            clearTimeout(authTimeout);
            members.set(socket, { id: randomUUID(), name, available: true });
            await broadcast();
            return;
          }
          if (message.kind !== 'command' || typeof message.requestId !== 'string' || !message.requestId || message.requestId.length > 100) {
            throw new Error('A command with a request ID is required.');
          }
          const signature = JSON.stringify(message.command);
          const prior = requests.get(message.requestId);
          if (prior) {
            if (prior.signature !== signature) throw new Error('This request ID was already used for a different command.');
            if (prior.error) throw new Error(prior.error);
          } else {
            try {
              await command(members.get(socket), message.command);
              requests.set(message.requestId, { signature });
            } catch (error) {
              requests.set(message.requestId, { signature, error: error.message });
              throw error;
            }
          }
          await broadcast(socket, message.requestId);
        } catch (error) {
          send(socket, { kind: 'error', ...(typeof message?.requestId === 'string' ? { requestId: message.requestId } : {}), message: error.message });
          // A stale command should also receive current versions to make retry possible.
          if (members.has(socket)) await broadcast();
        }
      }).catch((error) => send(socket, { kind: 'error', message: error.message }));
    });
    socket.on('close', () => {
      clearTimeout(authTimeout);
      serial(async () => {
        const member = members.get(socket);
        if (!member) return;
        members.delete(socket);
        for (const call of await readCalls()) {
          if (call.state.kind === 'active' && call.state.memberId === member.id) {
            await setState(call, { kind: 'waiting', queuedAt: Date.now() });
          }
        }
        if (!closed) await broadcast();
      }).catch((error) => console.error('Local reception disconnect:', error.message));
    });
  });

  return {
    ready,
    refresh: () => serial(() => broadcast()),
    close: async () => {
      closed = true;
      server.off('upgrade', upgrade);
      for (const socket of wss.clients) socket.terminate();
      await new Promise((resolve) => wss.close(resolve));
      await pending;
    },
  };
}
