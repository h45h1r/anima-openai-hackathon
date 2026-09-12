import test from 'node:test';
import assert from 'node:assert/strict';
import { handleClinical, processClinicalJob } from './clinical.mjs';
const NOW = Date.UTC(2026, 8, 12, 8);
const patientId = 'SIM-000001';
function setup(seed = []) {
  const rows = new Map(seed.map(r => [r.id, structuredClone(r)]));
  const jobs = [];
  let sequence = 0;
  const ctx = {
    now: NOW, site: 'gp', actor: { name: 'Local operator' },
    fail(status, message) { throw Object.assign(new Error(message), { status }); },
    async get(id) { if (!rows.has(id)) this.fail(404, 'Resource not found'); return structuredClone(rows.get(id)); },
    async getPatient(id) { if (id !== patientId) this.fail(404, 'Patient not found'); return { id, conditions: ['Asthma'] }; },
    async list({ kind, patientId, site } = {}) { return structuredClone([...rows.values()].filter(r => (!kind || r.kind === kind) && (!patientId || r.patientId === patientId) && (!site || r.visibleTo.includes(site)))); },
    requireVersion(r, version) { if (version !== r.version) this.fail(409, 'Stale resource version'); },
    async create(resource) { const r = { id: `local-${++sequence}`, createdAt: this.now, version: 1, ...structuredClone(resource) }; rows.set(r.id, r); return structuredClone(r); },
    async update(r, patch) { const next = { ...structuredClone(r), ...structuredClone(patch), version: r.version + 1 }; rows.set(r.id, next); return structuredClone(next); },
    async schedule(job) { jobs.push(structuredClone(job)); },
  };
  async function run(action) { ctx.action = action; const before = structuredClone(rows); const jobCount = jobs.length; try { return await handleClinical(ctx); } catch (error) { rows.clear(); for (const [id, r] of before) rows.set(id, r); jobs.length = jobCount; throw error; } }
  async function process(job) { ctx.now = job.at; return processClinicalJob(ctx, job); }
  return { ctx, rows, jobs, run, process };
}
const cap = (service, remaining = 1) => ({ id: `capacity-${service}`, kind: 'capacity', owner: service, visibleTo: [service, 'hospital', 'gp'], version: 1, status: 'available', data: { remaining, total: 1 } });
const fails = (promise, status, pattern) => assert.rejects(promise, e => e.status === status && (!pattern || pattern.test(e.message)));
const edit = r => ({ resourceId: r.id, expectedVersion: r.version });

test('GP consultation persists edits and rejects stale version and other patient', async () => {
  const { run, ctx } = setup();
  const a = { type: 'save_consultation', patientId, title: 'Review', text: 'Local test note', consultationStatus: 'draft', mode: 'telephone' };
  const r = await run(a);
  const saved = await run({ ...a, ...edit(r), consultationStatus: 'saved' });
  assert.equal(saved.status, 'saved');
  assert.equal(saved.data.mode, 'telephone');
  await fails(run({ ...a, ...edit(r) }), 409, /version/);
  await fails(run({ ...a, ...edit(saved), patientId: 'SIM-000002' }), 404);
  ctx.site = 'wearables';
  await fails(run(a), 403);
});

test('historical problem and allergy overlays validate origin and do not erase history', async () => {
  const ehr = { id: 'ehr', patientId, kind: 'ehr-record', visibleTo: ['gp'], owner: 'gp', version: 1, data: { problems: [{ term: 'Asthma' }], allergies: [{ term: 'Penicillin', key: 'penicillin' }] } };
  const { run, rows } = setup([ehr]);
  const a = { type: 'save_problem', patientId, title: 'Asthma', sourceProblemKey: 'ehr:0', problemStatus: 'resolved' };
  const problem = await run(a);
  assert.equal(problem.data.sourceProblemKey, 'ehr:0');
  assert.deepEqual(rows.get('ehr'), ehr);
  await fails(run(a), 409, /already/);
  await fails(run({ ...a, sourceProblemKey: 'other-patient:0' }), 400, /source/);
  const allergy = await run({ type: 'save_allergy', patientId, title: 'Penicillin', sourceAllergyKey: 'penicillin', allergyStatus: 'inactive', reaction: 'Rash' });
  assert.equal(allergy.status, 'inactive');
  await fails(run({ type: 'save_problem', patientId, title: 'Test', problemStatus: 'active', onsetDate: '2026-02-30' }), 400);
});

test('hospital notes preserve signed text and permit append-only addenda', async () => {
  const { run, ctx } = setup(); ctx.site = 'hospital';
  const a = { type: 'hospital_note', patientId, title: 'Progress', hospitalNoteCommand: { kind: 'save', template: 'progress', sections: [{ id: 'plan', heading: 'Plan', text: 'Original plan' }] } };
  const draft = await run(a);
  const signed = await run({ type: 'hospital_note', ...edit(draft), hospitalNoteCommand: { kind: 'sign' } });
  assert.equal(signed.data.signedBy, 'Local operator');
  await fails(run({ ...a, ...edit(signed) }), 409, /addenda/);
  await fails(run({ type: 'hospital_note', ...edit(signed), hospitalNoteCommand: { kind: 'sign' } }), 409);
  const amended = await run({ type: 'hospital_note', ...edit(signed), hospitalNoteCommand: { kind: 'addendum', text: 'Additional observation' } });
  assert.equal(amended.data.text, signed.data.text);
  assert.equal(amended.data.signedAt, signed.data.signedAt);
  assert.equal(amended.data.addenda.length, 1);
  assert.equal(amended.status, 'signed');
});

test('attendance enforces stage order and restores reserved bed on discharge', async () => {
  const { run, ctx, rows } = setup([cap('beds')]); ctx.site = 'hospital';
  const a = { type: 'register_attendance', patientId, title: 'Simulation arrival', acuity: '2', location: 'Waiting room' };
  let r = await run(a);
  await fails(run(a), 409, /active/);
  await fails(run({ type: 'update_attendance', ...edit(r), hospitalCommand: 'admit' }), 409);
  await fails(run({ type: 'update_attendance', ...edit(r), hospitalCommand: 'assess' }), 400, /clinician/);
  r = await run({ type: 'update_attendance', ...edit(r), hospitalCommand: 'assess', clinician: 'Dr Example' });
  r = await run({ type: 'update_attendance', ...edit(r), hospitalCommand: 'refer' });
  r = await run({ type: 'update_attendance', ...edit(r), hospitalCommand: 'admit' });
  assert.equal(r.data.stage, 'inpatient');
  assert.equal(rows.get('capacity-beds').data.remaining, 0);
  await fails(run({ type: 'update_attendance', ...edit(r), hospitalCommand: 'discharge' }), 400, /disposition/);
  r = await run({ type: 'update_attendance', ...edit(r), hospitalCommand: 'discharge', disposition: 'Home' });
  assert.equal(r.data.stage, 'discharged');
  assert.equal(rows.get('capacity-beds').data.remaining, 1);
  await fails(run({ type: 'update_attendance', ...edit(r), hospitalCommand: 'assign', clinician: 'Other' }), 409);
});

test('visits exhaust capacity, complete once, and reject repeat completion', async () => {
  const { run, ctx, jobs, rows, process } = setup([cap('community')]);
  const a = { type: 'schedule_visit', patientId, title: 'Home visit' };
  const r = await run(a);
  assert.equal(rows.get('capacity-community').data.remaining, 0);
  await fails(run(a), 409, /capacity/);
  ctx.site = 'community';
  const done = await process(jobs[0]);
  assert.equal(done.status, 'completed');
  assert.equal(done.data.synthetic, true);
  await process(jobs[0]);
  assert.equal(rows.get('capacity-community').data.remaining, 1);
  await fails(run({ type: 'complete', ...edit(done) }), 409);
  assert.equal((await run(a)).status, 'scheduled');
  assert.equal(r.dueAt, NOW + 90 * 60000);
});

test('test jobs produce one explicitly local report and GP can review a visible result', async () => {
  const { run, jobs, process, rows } = setup();
  const r = await run({ type: 'order_test', patientId, title: 'FBC', bloodTestOrder: { panel: 'Full blood count', panelId: 'fbc', specimen: 'EDTA', priority: 'routine', collection: 'now', clinicalDetails: 'Demo only' } });
  assert.equal(r.status, 'ordered');
  assert.equal(r.dueAt, NOW + 120 * 60000);
  assert.equal(jobs[0].at, r.dueAt);
  const result = await process(jobs[0]);
  await process(jobs[0]);
  const reports = [...rows.values()].filter(row => row.kind === 'report');
  assert.equal(reports.length, 1);
  assert.equal(reports[0].data.synthetic, true);
  assert.deepEqual(reports[0].data.analytes, []);
  assert.equal(result.status, 'available');
  assert.equal((await run({ type: 'review', ...edit(result) })).status, 'reviewed');
});

test('device connection is unique and produces clearly synthetic activity reading', async () => {
  const { ctx, run, jobs, process } = setup(); ctx.site = 'wearables';
  const r = await run({ type: 'connect_device', patientId });
  await fails(run({ type: 'connect_device', patientId }), 409);
  assert.equal(jobs[0].at, NOW + 10 * 60000);
  ctx.site = 'gp';
  const observation = await process(jobs[0]);
  assert.equal(observation.data.deviceId, r.id);
  assert.equal(observation.data.unit, 'steps/day');
  assert.equal(observation.data.simulationSource, 'local');
  assert.match(observation.data.note, /not a measurement/);
  assert.equal(jobs.length, 2);
  assert.equal(observation.data.observedAt, NOW + 10 * 60000);
  assert.equal(jobs[1].at, NOW + 70 * 60000);
  const next = await process(jobs[1]);
  assert.equal(next.data.observedAt, NOW + 70 * 60000);
  assert.equal(jobs[2].at, NOW + 130 * 60000);
});

test('sharing requires ownership and generic task transitions reach completion', async () => {
  const { ctx, run } = setup(); ctx.site = 'hospital';
  const r = await run({ type: 'create_task', patientId, title: 'Follow up' });
  ctx.site = 'gp';
  await fails(run({ type: 'share_record', ...edit(r), target: 'gp' }), 403);
  ctx.site = 'hospital';
  const shared = await run({ type: 'share_record', ...edit(r), target: 'gp' });
  assert.deepEqual(shared.visibleTo, ['hospital', 'gp']);
  const reviewed = await run({ type: 'review', ...edit(shared) });
  const accepted = await run({ type: 'accept', ...edit(reviewed) });
  assert.equal((await run({ type: 'complete', ...edit(accepted) })).status, 'completed');
});


test('next-round blood collection schedules result after 240 simulation minutes', async () => {
  const { run, jobs } = setup();
  const result = await run({ type: 'order_test', patientId, title: 'CRP', bloodTestOrder: { panel: 'CRP', panelId: 'crp', specimen: 'Blood', priority: 'routine', collection: 'next-round', clinicalDetails: 'Local demo' } });
  assert.equal(result.dueAt, NOW + 240 * 60000);
  assert.equal(jobs[0].at, result.dueAt);
});

test('inactive device jobs produce no readings or subsequent schedules', async () => {
  const { run, ctx, rows, jobs, process } = setup(); ctx.site = 'wearables';
  const device = await run({ type: 'connect_device', patientId });
  rows.set(device.id, { ...device, status: 'inactive' });
  ctx.site = 'gp';
  await process(jobs[0]);
  assert.equal([...rows.values()].filter(r => r.kind === 'observation').length, 0);
  assert.equal(jobs.length, 1);
});
