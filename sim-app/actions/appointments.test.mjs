import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAppointments } from './appointments.mjs';

const NOW = Date.UTC(2026, 8, 12, 8);
const MINUTE = 60_000;
function session(overrides = {}) {
  return { id: 'session-1', kind: 'appointment-session', owner: 'gp', status: 'open', version: 1, title: 'Morning surgery', visibleTo: ['gp'], data: { startsAt: NOW, endsAt: NOW + 4 * 60 * MINUTE, slotMinutes: 15, clinician: 'Dr Maya Shah', mode: 'in-person', location: 'Room 1', blockedSlots: [], ...overrides } };
}
function appointment(overrides = {}) {
  return { id: 'appointment-1', kind: 'appointment', owner: 'gp', status: 'booked', version: 1, patientId: 'SIM-000001', data: { startsAt: NOW + 30 * MINUTE, durationMinutes: 15, clinician: 'Dr Maya Shah', sessionId: 'session-1', capacityReserved: false }, ...overrides };
}
function setup(resources = [session()]) {
  const rows = new Map(resources.map(resource => [resource.id, structuredClone(resource)]));
  let sequence = 0;
  const ctx = {
    worldId: 'local', site: 'gp', now: NOW,
    fail(status, message) { throw Object.assign(new Error(message), { status }); },
    async get(id) { if (!rows.has(id)) this.fail(404, 'Resource not found'); return structuredClone(rows.get(id)); },
    async getPatient(id) { if (!['SIM-000001', 'SIM-000002'].includes(id)) this.fail(404, 'Patient not found'); return { id }; },
    async list({ kind, patientId, site } = {}) { return structuredClone([...rows.values()].filter(resource => (!kind || resource.kind === kind) && (!patientId || resource.patientId === patientId) && (!site || resource.owner === site))); },
    requireVersion(resource, version) { if (!Number.isInteger(version) || resource.version !== version) this.fail(409, 'Stale resource version'); },
    async create(resource) { const row = { id: `new-${++sequence}`, version: 1, ...structuredClone(resource) }; rows.set(row.id, row); return structuredClone(row); },
    async update(resource, patch) { const row = { ...structuredClone(resource), ...structuredClone(patch), version: resource.version + 1 }; rows.set(row.id, row); return structuredClone(row); },
  };
  async function run(action) {
    const before = structuredClone(rows);
    ctx.action = action;
    try { return await handleAppointments(ctx); }
    catch (error) { rows.clear(); for (const [id, row] of before) rows.set(id, row); throw error; }
  }
  return { run, rows, ctx };
}
const booking = overrides => ({ type: 'book_appointment', patientId: 'SIM-000001', title: 'Review', sessionId: 'session-1', sessionVersion: 1, startsAt: NOW + 30 * MINUTE, ...overrides });
const fails = (promise, status, pattern) => assert.rejects(promise, error => error.status === status && (!pattern || pattern.test(error.message)));

test('session booking uses session settings and prevents stale or overlapping second bookings', async () => {
  const { run, rows } = setup();
  const booked = await run(booking({ clinician: 'Wrong clinician', mode: 'video', durationMinutes: 60 }));
  assert.equal(booked.status, 'booked');
  assert.equal(booked.data.clinician, 'Dr Maya Shah');
  assert.equal(booked.data.mode, 'in-person');
  assert.equal(booked.data.durationMinutes, 15);
  assert.equal(booked.data.capacityReserved, false);
  assert.equal(rows.get('session-1').version, 2);
  await fails(run(booking({ patientId: 'SIM-000002' })), 409, /version/);
  await fails(run(booking({ patientId: 'SIM-000002', sessionVersion: 2 })), 409, /overlapping/);
  assert.equal([...rows.values()].filter(row => row.kind === 'appointment').length, 1);
});

test('booking validates patient, grid boundaries, timestamp units and simulation time', async () => {
  const { run, ctx } = setup();
  await fails(run(booking({ patientId: 'SIM-999999' })), 404);
  await fails(run(booking({ startsAt: NOW + MINUTE })), 400, /grid/);
  await fails(run(booking({ startsAt: NOW + 4 * 60 * MINUTE })), 400, /grid/);
  await fails(run(booking({ startsAt: NOW / 1000 })), 400, /grid/);
  await fails(run(booking({ startsAt: NOW + 0.5 })), 400, /milliseconds/);
  ctx.now = NOW + 60 * MINUTE;
  await fails(run(booking()), 409, /past/);
});

test('blocking a real slot stops booking; unblocking requires the current session version', async () => {
  const { run, rows } = setup();
  const block = { type: 'set_appointment_slot', resourceId: 'session-1', expectedVersion: 1, startsAt: NOW + 30 * MINUTE, slotCommand: 'block', text: 'Protected break' };
  const blocked = await run(block);
  assert.deepEqual(blocked.data.blockedSlots, [{ startsAt: NOW + 30 * MINUTE, reason: 'Protected break' }]);
  await fails(run(booking({ sessionVersion: 2 })), 409, /blocked/);
  await fails(run({ ...block, slotCommand: 'unblock' }), 409, /version/);
  await run({ ...block, expectedVersion: 2, slotCommand: 'unblock' });
  assert.equal(rows.get('session-1').data.blockedSlots.length, 0);
  assert.equal((await run(booking({ sessionVersion: 3 }))).status, 'booked');
});

test('protected-time changes reject occupied slots and off-grid positions', async () => {
  const { run } = setup([session(), appointment()]);
  const block = { type: 'set_appointment_slot', resourceId: 'session-1', expectedVersion: 1, startsAt: NOW + 30 * MINUTE, slotCommand: 'block', text: 'Break' };
  await fails(run(block), 409, /overlapping/);
  await fails(run({ ...block, startsAt: NOW + MINUTE }), 400, /grid/);
  await fails(run({ ...block, slotCommand: 'unblock', startsAt: NOW + 60 * MINUTE }), 409, /not blocked/);
});

test('appointments spanning several slots reserve every overlapping slot, but cancellation releases them', async () => {
  const long = appointment();
  long.data.durationMinutes = 30;
  const { run } = setup([session(), long]);
  await fails(run(booking({ startsAt: NOW + 45 * MINUTE, patientId: 'SIM-000002' })), 409);
  await run({ type: 'cancel_appointment', resourceId: long.id, expectedVersion: 1 });
  const booked = await run(booking({ startsAt: NOW + 45 * MINUTE, sessionVersion: 2 }));
  assert.equal(booked.status, 'booked');
});

test('patient cannot be booked with a second clinician at an overlapping time', async () => {
  const another = session({ clinician: 'Nurse Alex Morgan' });
  another.id = 'session-2';
  const { run } = setup([session(), another, appointment()]);
  await fails(run(booking({ sessionId: 'session-2' })), 409, /Patient/);
  const booked = await run(booking({ sessionId: 'session-2', patientId: 'SIM-000002' }));
  assert.equal(booked.data.clinician, 'Nurse Alex Morgan');
});

test('arrival, completion and cancellation enforce status and versions', async () => {
  const { run, rows } = setup([session(), appointment()]);
  const arrived = await run({ type: 'arrive_appointment', resourceId: 'appointment-1', expectedVersion: 1 });
  assert.equal(arrived.status, 'arrived');
  assert.equal(arrived.data.arrivedAt, NOW);
  await fails(run({ type: 'complete', resourceId: 'appointment-1', expectedVersion: 1 }), 409);
  await fails(run({ type: 'arrive_appointment', resourceId: 'appointment-1', expectedVersion: 2 }), 409);
  const completed = await run({ type: 'complete', resourceId: 'appointment-1', expectedVersion: 2 });
  assert.equal(completed.status, 'completed');
  await fails(run({ type: 'cancel_appointment', resourceId: 'appointment-1', expectedVersion: 3 }), 409);
  assert.equal(rows.get('appointment-1').status, 'completed');
});

test('session creation rejects overlap and partial slots, but permits adjacent sessions', async () => {
  const { run } = setup();
  const create = { type: 'create_appointment_session', title: 'Afternoon', clinician: 'Dr Maya Shah', location: 'Room 1', mode: 'in-person', startsAt: NOW + 4 * 60 * MINUTE, endsAt: NOW + 5 * 60 * MINUTE, slotMinutes: 15 };
  const adjacent = await run(create);
  assert.equal(adjacent.status, 'open');
  await fails(run({ ...create, startsAt: NOW + 3 * 60 * MINUTE }), 409, /overlapping session/);
  await fails(run({ ...create, endsAt: create.endsAt + MINUTE }), 400, /whole slots/);
  await fails(run({ ...create, endsAt: create.startsAt + 25 * 60 * MINUTE }), 400);
  await fails(run({ ...create, slotMinutes: 0 }), 400);
});

test('legacy booking consumes real capacity, cancellation returns it only once', async () => {
  const capacity = { id: 'capacity-gp', kind: 'capacity', owner: 'gp', version: 1, data: { total: 6, remaining: 1, retainedMetadata: true } };
  const { run, rows } = setup([capacity]);
  const booked = await run({ type: 'book_appointment', patientId: 'SIM-000001', title: 'Legacy review' });
  assert.equal(booked.data.capacityReserved, true);
  assert.equal(rows.get('capacity-gp').data.remaining, 0);
  assert.equal(rows.get('capacity-gp').data.retainedMetadata, true);
  await fails(run({ type: 'book_appointment', patientId: 'SIM-000002', title: 'Another review', startsAt: NOW + 60 * MINUTE }), 409, /capacity/);
  await run({ type: 'cancel_appointment', resourceId: booked.id, expectedVersion: 1 });
  assert.equal(rows.get('capacity-gp').data.remaining, 1);
  await fails(run({ type: 'cancel_appointment', resourceId: booked.id, expectedVersion: 2 }), 409);
  assert.equal(rows.get('capacity-gp').data.remaining, 1);
});

test('closed sessions and non-GP writes are rejected; unrelated actions pass through', async () => {
  const closed = session(); closed.status = 'closed';
  const { run, ctx } = setup([closed, { id: 'task-1', kind: 'task', owner: 'gp' }]);
  await fails(run(booking()), 409, /not open/);
  assert.equal(await run({ type: 'create_task' }), undefined);
  assert.equal(await run({ type: 'complete', resourceId: 'task-1' }), undefined);
  ctx.site = 'hospital';
  await fails(run(booking()), 403);
});
