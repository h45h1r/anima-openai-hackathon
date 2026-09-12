import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuestionTools, runAgentQuestion, type RunAgentInput } from './harness';
import { createDefaultPolicy } from '../consent/policy';
import { ScopedMemoryService } from './memoryStore';
import type { ClinicalContext } from '../types/domain';

const patientId = 'SIM-000006';
const context: ClinicalContext = {
  patientId, sites: ['gp'], fetchedAt: '2026-09-12T09:00:00Z', simulationNowMs: Date.parse('2026-09-12T09:00:00Z'),
  sparse: false, errors: [], recordClasses: ['appointments', 'laboratory_results'],
  resources: [{ id: 'lab-1', patientId, kind: 'report', title: 'Liver blood results', priority: 'routine', status: 'final', owner: 'gp', visibleTo: ['gp'], createdAt: 0, version: 1, data: {} }],
  measurements: [{ evidenceId: 'lab-1:bilirubin', resourceId: 'lab-1', patientId, panelId: 'liver', analyteId: 'bilirubin', displayName: 'Bilirubin', value: 24, unit: 'µmol/L', sampledAt: '2026-09-11T09:00:00Z', referenceLow: 0, referenceHigh: 21, service: 'gp', sourceVersion: 1, informationClass: 'laboratory_results' }],
  events: [{ evidenceId: 'appointment-1:event', resourceId: 'appointment-1', patientId, kind: 'appointment', title: 'Falls and mobility review', status: 'booked', at: '2026-09-13T12:20:00Z', summary: 'Falls and mobility review with Dr Shah at Riverside Practice.', informationClass: 'appointments', service: 'gp', sourceVersion: 1, fields: {} }],
};
function input(viewerId = 'patient'): RunAgentInput {
  return { context: structuredClone(context), client: {} as RunAgentInput['client'], policy: createDefaultPolicy(patientId, 'Eleanor Chen'), viewerId,
    question: 'when is my next appointment', memory: new ScopedMemoryService(), openaiApiKey: process.env.OPENAI_API_KEY,
    history: [{ role: 'user', content: 'What do my latest blood tests show?' }, { role: 'assistant', content: 'Your liver result was bilirubin 24 µmol/L.' }] };
}
async function invoke(run: ReturnType<typeof createQuestionTools>, name: string, args: Record<string, unknown>) {
  const tool = run.tools.find(t => t.name === name)!;
  return await tool.execute!({ args } as never) as { records?: unknown[]; error?: string };
}

test('tool registration does not select or run tools', () => {
  const run = createQuestionTools(input());
  assert.equal(run.trace.length, 0);
  assert.equal(run.seen.size, 0);
});

test('every executed tool records arguments and filters consent before returning data', async () => {
  const run = createQuestionTools(input('tom'));
  const labs = await invoke(run, 'get_test_results', { includeHistory: false });
  assert.ok(labs.error);
  assert.deepEqual(labs.records, []);
  assert.equal(run.seen.size, 0);
  const appointments = await invoke(run, 'get_appointments', { period: 'upcoming' });
  assert.equal(appointments.records?.length, 1);
  assert.deepEqual(run.trace.map(t => t.tool), ['get_test_results', 'get_appointments']);
  assert.deepEqual(run.trace[1].arguments, { period: 'upcoming' });
  assert.ok(run.trace.every(t => t.callId && t.source === 'model'));
});

test('family cannot change sharing or use another patient context', async () => {
  const run = createQuestionTools(input('tom'));
  assert.ok((await invoke(run, 'update_consent', { viewerId: 'tom', sharingLevel: 'everything' })).error);
  const mismatch = input(); mismatch.context.patientId = 'SIM-000001';
  assert.throws(() => createQuestionTools(mismatch), /access to this patient/);
});

for (const question of ['when is my next appointment', 'when is my next appinmtne']) {
  test(`agent selects appointments after a lab conversation: ${question}`, { skip: process.env.KINDRED_LIVE_AGENT_TEST !== '1' }, async () => {
    const run = await runAgentQuestion({ ...input(), question });
    assert.ok(run.tools.some(t => t.tool === 'get_appointments'), JSON.stringify(run.tools));
    assert.ok(run.tools.every(t => t.source === 'model'));
    assert.doesNotMatch(run.answer.answer, /bilirubin|liver result/i);
    assert.match(run.answer.answer, /13 September|13th September|13 Sept|tomorrow/i);
    assert.match(run.answer.answer, /12:20|12\.20|12.20pm/i);
  });
}
