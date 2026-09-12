import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuestionTools, suggestionsForViewer, type RunAgentInput } from './harness';
import { createDefaultPolicy, holdResource } from '../consent/policy';
import { ScopedMemoryService } from './memoryStore';

const patientId = 'SIM-000006';
const foreignId = 'SIM-999999';
const secret = 'FOREIGN_OR_HELD_CANARY_71D4';

function request(viewerId = 'sarah'): RunAgentInput {
  return {
    client: {} as RunAgentInput['client'], viewerId, question: 'Show my record', memory: new ScopedMemoryService(),
    policy: createDefaultPolicy(patientId, 'Synthetic Patient'),
    context: {
      patientId, sites: ['gp'], fetchedAt: '2026-09-12T09:00:00Z', simulationNowMs: Date.parse('2026-09-12T09:00:00Z'),
      sparse: false, errors: [], recordClasses: ['appointments', 'laboratory_results'],
      resources: [{ id: 'lab-public', patientId, kind: 'report', title: 'Laboratory report', priority: 'routine', status: 'final', owner: 'gp', visibleTo: ['gp'], createdAt: 0, version: 1, data: {} }],
      measurements: [{ evidenceId: 'shared-id', resourceId: 'lab-public', patientId, panelId: 'panel', analyteId: 'marker', displayName: 'Public marker', value: 2, unit: 'units', sampledAt: '2026-09-11T09:00:00Z', service: 'gp', sourceVersion: 1, informationClass: 'laboratory_results' }],
      events: [{ evidenceId: 'appointment:event', resourceId: 'appointment', patientId, kind: 'appointment', title: 'Review', status: 'booked', at: '2026-09-13T12:20:00Z', summary: 'Review appointment', informationClass: 'appointments', service: 'gp', sourceVersion: 1, fields: {} }],
    },
  };
}

async function invoke(run: ReturnType<typeof createQuestionTools>, name: string, args: Record<string, unknown>) {
  const tool = run.tools.find(candidate => candidate.name === name)!;
  // Match the ADK boundary: validate arguments before invoking the registered handler.
  const parsed = tool.schema.parse(args);
  return await tool.execute!({ args: parsed } as never) as { records?: Array<Record<string, unknown>>; error?: string; people?: Array<{ shared: string[] }> };
}

function grant(input: RunAgentInput) {
  return input.policy.grants.find(g => g.viewerId === input.viewerId && g.informationClass === 'laboratory_results')!;
}

function addCollision(input: RunAgentInput, foreign: boolean) {
  input.context.resources.push({ ...input.context.resources[0], id: 'lab-secret', patientId: foreign ? foreignId : patientId });
  input.context.measurements.push({ ...input.context.measurements[0], resourceId: 'lab-secret', patientId: foreign ? foreignId : patientId, displayName: secret, value: 918.274 });
}

for (const viewerId of ['patient', 'sarah']) {
  test(`duplicate evidence IDs cannot reintroduce a denied foreign patient record (${viewerId})`, async () => {
    const input = request(viewerId);
    addCollision(input, true);
    const run = createQuestionTools(input);
    const result = await invoke(run, 'get_test_results', { includeHistory: true });
    assert.doesNotMatch(JSON.stringify(result), /FOREIGN_OR_HELD_CANARY|918\.274|SIM-999999/);
    assert.ok(result.records?.every(record => record.patientId === patientId));
    await run.checkDelivery();
  });
}

test('duplicate evidence IDs cannot reintroduce a held result', async () => {
  const input = request();
  addCollision(input, false);
  input.policy = holdResource(input.policy, 'lab-secret', 'clinician');
  const result = await invoke(createQuestionTools(input), 'get_test_results', { includeHistory: true });
  assert.doesNotMatch(JSON.stringify(result), /FOREIGN_OR_HELD_CANARY|918\.274/);
});

test('a matching viewer grant for a different patient cannot authorise this patient', async () => {
  const input = request();
  grant(input).patientId = foreignId;
  assert.deepEqual((await invoke(createQuestionTools(input), 'get_test_results', {})).records, []);
});

test('a future grant cannot authorise records before its start time', async () => {
  const input = request();
  grant(input).startsAt = new Date(Date.now() + 86_400_000).toISOString();
  assert.deepEqual((await invoke(createQuestionTools(input), 'get_test_results', {})).records, []);
});

for (const scope of ['record', 'fields'] as const) {
  test(`a ${scope} grant without a target must not authorise an entire class`, async () => {
    const input = request();
    grant(input).scope = scope;
    assert.deepEqual((await invoke(createQuestionTools(input), 'get_test_results', {})).records, []);
  });
}

test('invalid grant expiry must fail closed even alongside an allowed category', async () => {
  const input = request();
  grant(input).expiresAt = 'not-a-date';
  const result = await invoke(createQuestionTools(input), 'get_permitted_evidence', { categories: ['appointments', 'laboratory_results'] });
  assert.ok(result.records?.every(record => record.informationClass !== 'laboratory_results'));
});

test('expired and revoked grants remain denied when mixed with an allowed category', async () => {
  for (const revoked of [false, true]) {
    const input = request();
    if (revoked) grant(input).revokedAt = new Date().toISOString();
    else grant(input).expiresAt = new Date(Date.now() - 60_000).toISOString();
    const result = await invoke(createQuestionTools(input), 'get_permitted_evidence', { categories: ['appointments', 'laboratory_results'] });
    assert.equal(result.records?.length, 1);
    assert.equal(result.records?.[0].informationClass, 'appointments');
  }
});

test('model arguments cannot change the server-bound patient or viewer', async () => {
  const input = request('tom');
  const result = await invoke(createQuestionTools(input), 'get_test_results', { patientId: foreignId, viewerId: 'patient', includeHistory: true });
  assert.deepEqual(result.records, []);
  assert.ok(result.error);
});

test('a revoked viewer cannot use a stale tool registry to read records', async () => {
  const input = request();
  const current = structuredClone(input.policy);
  input.refreshPolicy = async () => current;
  const run = createQuestionTools(input);
  current.viewers.find(viewer => viewer.viewerId === input.viewerId)!.status = 'revoked';
  const result = await invoke(run, 'get_test_results', {});
  assert.ok(result.error);
  assert.equal(run.seen.size, 0);
  await assert.rejects(run.checkDelivery());
});

test('remember accepts only fixed communication preferences, not clinical secrets', async () => {
  const run = createQuestionTools(request());
  await assert.rejects(invoke(run, 'remember', { preference: `${secret}: 918.274` }));
  assert.equal(run.memoriesWritten.length, 0);
});

test('recall scopes memories by both patient and viewer and drops unsafe legacy content', async () => {
  const input = request('tom');
  await input.memory.remember({ patientId: foreignId, viewerId: 'tom', kind: 'preference', text: 'Use detailed replies.' });
  await input.memory.remember({ patientId, viewerId: 'sarah', kind: 'preference', text: 'Use bullet points.' });
  await input.memory.remember({ patientId, viewerId: 'tom', kind: 'preference', text: `${secret}: 918.274` });
  await input.memory.remember({ patientId, viewerId: 'tom', kind: 'preference', text: 'Use short replies.' });
  const result = await invoke(createQuestionTools(input), 'recall_preferences', {});
  assert.deepEqual(result, { preferences: ['Use short replies.'] });
});


test('suggestions cannot expose the test name of a held or foreign result', () => {
  for (const foreign of [false, true]) {
    const input = request();
    addCollision(input, foreign);
    input.context.measurements[1].evidenceId = 'secret-unique-id';
    if (!foreign) input.policy = holdResource(input.policy, 'lab-secret', 'clinician');
    const suggestions = suggestionsForViewer(input.context, input.policy, input.viewerId);
    assert.doesNotMatch(JSON.stringify(suggestions).toUpperCase(), /FOREIGN_OR_HELD_CANARY/);
  }
});

test('a different patient disclosure event cannot clear this patient held result', async () => {
  const input = request();
  input.policy = holdResource(input.policy, 'lab-public', 'clinician');
  input.policy.disclosures.push({ patientId: foreignId, resourceId: 'lab-public', state: 'cleared', changedBy: 'other-clinician', changedAt: new Date(Date.now() + 1000).toISOString() });
  const result = await invoke(createQuestionTools(input), 'get_test_results', {});
  assert.deepEqual(result.records, []);
});

test('delivery tracks the returned information class when source identifiers collide', async () => {
  const input = request();
  const lab = structuredClone(input.context.measurements[0]);
  input.context.measurements[0].informationClass = 'appointments';
  input.context.measurements.push(lab);
  const current = structuredClone(input.policy);
  input.refreshPolicy = async () => current;
  const run = createQuestionTools(input);
  assert.equal((await invoke(run, 'get_test_results', {})).records?.length, 1);
  current.grants.filter(g => g.viewerId === input.viewerId && g.informationClass === 'laboratory_results').forEach(g => { g.allowed = false; });
  await assert.rejects(run.checkDelivery(), /Sharing changed/);
});

test('trend charts exclude held and foreign records and block delivery after revocation', async () => {
  const input = request();
  addCollision(input, true);
  input.context.measurements[1].evidenceId = 'foreign-unique';
  input.context.resources.push({ ...input.context.resources[0], id: 'held-chart' });
  input.context.measurements.push({ ...input.context.measurements[0], evidenceId: 'held-chart-unique', resourceId: 'held-chart', displayName: secret, value: 918.274 });
  input.policy = holdResource(input.policy, 'held-chart', 'clinician');
  const current = structuredClone(input.policy);
  input.refreshPolicy = async () => current;
  const run = createQuestionTools(input);
  const result = await invoke(run, 'show_result_trend', { analyteId: 'marker', unit: 'units' });
  assert.doesNotMatch(JSON.stringify(result), /FOREIGN_OR_HELD_CANARY|918\.274/);
  assert.equal(run.getVisualisation()?.points?.length, 1);
  current.grants.filter(g => g.viewerId === input.viewerId && g.informationClass === 'laboratory_results').forEach(g => { g.allowed = false; });
  await assert.rejects(run.checkDelivery(), /Sharing changed/);
});
