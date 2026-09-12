import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { AnimaClient } from '../anima/client';
import { buildSuggestions } from '../anima/normalise';
import { evaluateConsent, updateGrants, updateSharingLevel, type ConsentPolicyState, type EvidenceItem } from '../consent/policy';
import type { AgentAnswer, AgentRunResult, ClinicalContext, InformationClass, Measurement, NormalisedEvent, ToolObservation } from '../types/domain';
import { catalogueEvidence } from './evidence';
import type { ChatTurn } from '../types/domain';
import { createAskAgent, createCareCircleAdkApp } from './adkApp';
import type { AskEventSink } from './events';
import { ScopedMemoryService, memoryKinds, type CareCircleMemoryItem } from './memoryStore';
import { PROMPT_VERSION } from './prompts';

export function resolveAskModel(explicit?: string | null): string {
  return explicit?.trim() || process.env.OPENAI_MODEL?.trim() || process.env.AGENT_MODEL?.trim() || 'gpt-5.6-sol';
}

export type AdditionalAgentTool = { name: string; description: string; schema: z.AnyZodObject; execute: (args: Record<string, unknown>) => unknown | Promise<unknown> };

export type RunAgentInput = {
  client: AnimaClient;
  context: ClinicalContext;
  policy: ConsentPolicyState;
  viewerId: string;
  question: string;
  history?: ChatTurn[];
  openaiApiKey?: string;
  openaiModel?: string;
  memory: ScopedMemoryService;
  onConsentUpdate?: (policy: ConsentPolicyState) => void | Promise<void>;
  onEvent?: AskEventSink;
  refreshPolicy?: () => Promise<ConsentPolicyState>;
  additionalTools?: AdditionalAgentTool[];
  instructions?: string;
  beforeDelivery?: () => Promise<void>;
};

const classes = ['appointments', 'logistics', 'tasks', 'treatment_summary', 'symptoms', 'laboratory_results', 'clinical_documents', 'medications', 'private_notes'] as const;
const eventTime = (item: EvidenceItem) => item.kind === 'measurement' ? (item.payload as Measurement).sampledAt : (item.payload as NormalisedEvent).at;

export function createQuestionTools(input: RunAgentInput) {
  const app = createCareCircleAdkApp();
  const trace: ToolObservation[] = [];
  const seen = new Map<string, EvidenceItem>();
  const memoriesUsed: CareCircleMemoryItem[] = [];
  const memoriesWritten: CareCircleMemoryItem[] = [];
  const evidence = catalogueEvidence(input.context);
  let policy = input.policy;
  const viewer = policy.viewers.find(v => v.viewerId === input.viewerId && v.status === 'active');
  if (!viewer || viewer.patientId !== input.context.patientId || policy.patientId !== input.context.patientId) throw new Error('Viewer does not have access to this patient.');
  const decisions: ReturnType<typeof evaluateConsent>[] = [];
  const referenceTime = input.context.simulationNowMs ?? Date.now();

  function tool<S extends z.ZodTypeAny>(name: string, description: string, schema: S, execute: (args: z.infer<S>) => unknown | Promise<unknown>) {
    return app.tool({ name, description, schema, execute: async ctx => {
      const started = Date.now();
      const entry: ToolObservation = { tool: name, callId: nanoid(12), arguments: ctx.args as Record<string, unknown>, status: 'ok', latencyMs: 0, detail: '', source: 'model' };
      trace.push(entry);
      input.onEvent?.({ type: 'status', message: 'Looking through the record…' });
      try {
        if (input.refreshPolicy) policy = await input.refreshPolicy();
        if (!policy.viewers.some(v => v.viewerId === input.viewerId && v.patientId === input.context.patientId && v.status === 'active')) throw new Error('Access to this patient has ended.');
        const result = await execute(ctx.args);
        const data = result as { records?: unknown[]; error?: string; notice?: string } | undefined;
        entry.evidenceCount = data?.records?.length;
        for (const record of data?.records || []) {
          const id = (record as { evidenceId?: string }).evidenceId;
          const item = evidence.find(candidate => candidate.evidenceId === id);
          if (item) seen.set(item.evidenceId, item);
        }
        entry.status = data?.error ? 'error' : 'ok';
        entry.detail = data?.error || data?.notice || (data?.records ? `${data.records.length} records returned` : 'completed');
        return result;
      } catch (error) {
        entry.status = 'error';
        entry.detail = error instanceof Error ? error.message : 'Tool failed';
        return { error: entry.detail };
      } finally {
        entry.latencyMs = Date.now() - started;
        input.onEvent?.({ type: 'tool', tool: name, status: entry.status, detail: entry.detail });
      }
    } });
  }

  function read(items: EvidenceItem[], requested: readonly InformationClass[], limit = 100) {
    const selectedViewer = policy.viewers.find(v => v.viewerId === input.viewerId && v.status === 'active');
    const permittedClass = selectedViewer?.relationship === 'self' || requested.some(c => policy.grants.some(g => g.viewerId === input.viewerId && g.informationClass === c && g.allowed && !g.revokedAt && (!g.expiresAt || Date.parse(g.expiresAt) > Date.now())));
    if (!permittedClass) return { error: 'This information is not shared with you.', records: [] };
    const decision = evaluateConsent({ policy, viewerId: input.viewerId, evidence: items });
    decisions.push(decision);
    const allowed = new Set(decision.allowedEvidenceIds);
    const unique = new Map(items.filter(item => allowed.has(item.evidenceId)).map(item => [item.evidenceId, item]));
    const permitted = [...unique.values()].sort((a, b) => eventTime(b).localeCompare(eventTime(a))).slice(0, limit);
    return { records: permitted.map(item => ({ ...item.payload, evidenceId: item.evidenceId })), notice: ['deny', 'hold'].includes(decision.outcome) ? 'The requested information is not available to this viewer.' : undefined };
  }

  const tools: ReturnType<typeof app.tool>[] = [
    tool('get_test_results', 'Read laboratory results from this patient’s record. Optionally filter by a test or panel name, such as HbA1c or liver. Results include units, reference ranges and dates. Wearable readings are excluded.', z.object({ test: z.string().nullable().optional(), includeHistory: z.boolean().default(false) }), args => {
      const matching = evidence.filter(item => {
        if (item.kind !== 'measurement' || item.informationClass !== 'laboratory_results') return false;
        const m = item.payload as Measurement;
        const resource = input.context.resources.find(r => r.id === item.resourceId);
        if (resource?.kind !== 'report' && !/lab|blood|patholog|panel|result/i.test(`${resource?.kind || ''} ${resource?.title || ''}`)) return false;
        return !args.test || `${m.displayName} ${m.analyteId} ${resource?.title || ''}`.toLowerCase().includes(args.test.toLowerCase());
      });
      const results = read(matching, ['laboratory_results'], 200);
      if (args.includeHistory || results.error) return results;
      const latest = new Map<string, (typeof results.records)[number]>();
      for (const record of results.records) {
        const m = record as Measurement;
        const key = `${m.analyteId}:${m.unit}`;
        if (!latest.has(key)) latest.set(key, record);
      }
      return { ...results, records: [...latest.values()] };
    }),
    tool('get_appointments', 'Read this patient’s booked appointments. Choose upcoming for the next appointment, past for history, or all. This does not book anything.', z.object({ period: z.enum(['upcoming', 'past', 'all']).default('upcoming') }), args => {
      const items = evidence.filter(item => item.kind === 'event' && item.informationClass === 'appointments' && (item.payload as NormalisedEvent).kind === 'appointment');
      const result = read(items, ['appointments']);
      const records = result.records.filter(record => {
        const appointment = record as NormalisedEvent;
        const time = Date.parse(appointment.at);
        if (args.period === 'all') return true;
        if (args.period === 'past') return time < referenceTime;
        return time >= referenceTime && !['cancelled', 'canceled', 'did-not-attend'].includes(appointment.status);
      }).sort((a, b) => (a as NormalisedEvent).at.localeCompare((b as NormalisedEvent).at));
      return { ...result, records, referenceTime: new Date(referenceTime).toISOString(), notice: result.notice || 'Existing records only. No booking was submitted.' };
    }),
    tool('get_permitted_evidence', 'Read other parts of the patient record: medicines, care notes, conditions, tasks, wellbeing or a general overview. Select information classes and optionally search the record text. Consent is enforced for each record.', z.object({ categories: z.array(z.enum(classes)).min(1), query: z.string().nullable().optional() }), args => {
      const items = evidence.filter(item => args.categories.includes(item.informationClass) && (!args.query || JSON.stringify(item.payload).toLowerCase().includes(args.query.toLowerCase())));
      return read(items, args.categories, 60);
    }),
    tool('get_sharing_preferences', 'Read who is in the patient’s circle and what is shared. Other viewers can only inspect their own access.', z.object({}), () => {
      const viewers = input.viewerId === 'patient' ? policy.viewers : policy.viewers.filter(v => v.viewerId === input.viewerId);
      return { people: viewers.map(v => ({ id: v.viewerId, name: v.displayName, status: v.status, shared: policy.grants.filter(g => g.viewerId === v.viewerId && g.allowed && !g.revokedAt).map(g => g.informationClass) })) };
    }),
    tool('recall_preferences', 'Recall this viewer’s saved communication preferences for this patient.', z.object({}), async () => {
      const found = await input.memory.recall({ patientId: input.context.patientId, viewerId: input.viewerId, question: input.question });
      memoriesUsed.push(...found);
      return { preferences: found.map(m => m.content) };
    }),
    tool('remember', 'Save a communication preference that the viewer asks you to remember. Clinical records cannot be stored here.', z.object({ text: z.string().max(280), kind: z.enum(memoryKinds) }), async args => {
      const saved = await input.memory.remember({ patientId: input.context.patientId, viewerId: input.viewerId, ...args });
      if (!saved) return { error: 'This information cannot be saved as a preference.' };
      memoriesWritten.push(saved);
      return { saved: true };
    }),
    tool('update_consent', 'Patient-only: change sharing for a circle member when the patient explicitly requests it. Use get_sharing_preferences to obtain the member ID first.', z.object({ viewerId: z.string(), sharingLevel: z.enum(['everything', 'practical', 'updates']).nullable().optional(), informationClass: z.enum(classes).nullable().optional(), allowed: z.boolean().nullable().optional() }), async args => {
      if (input.viewerId !== 'patient') return { error: 'Only the patient can change sharing.' };
      if (!policy.viewers.some(v => v.viewerId === args.viewerId && v.viewerId !== 'patient' && v.status === 'active')) return { error: 'Choose an active circle member.' };
      if (!args.sharingLevel && (!args.informationClass || args.allowed == null)) return { error: 'Specify the sharing change.' };
      if (!input.onConsentUpdate) return { error: 'The consent service is unavailable.' };
      const next = args.sharingLevel ? updateSharingLevel(policy, args.viewerId, args.sharingLevel, policy.policyVersion, 'patient') : updateGrants(policy, args.viewerId, { [args.informationClass!]: args.allowed! }, policy.policyVersion, 'patient');
      await input.onConsentUpdate(next);
      policy = next;
      return { saved: true, viewerId: args.viewerId };
    }),
  ];
  for (const extra of input.additionalTools || []) {
    const duplicate = tools.findIndex(existing => existing.name === extra.name);
    if (duplicate >= 0) tools.splice(duplicate, 1);
    tools.push(tool(extra.name, extra.description, extra.schema, extra.execute));
  }
  async function checkDelivery() {
    if (input.refreshPolicy) policy = await input.refreshPolicy();
    const decision = evaluateConsent({ policy, viewerId: input.viewerId, evidence: [...seen.values()] });
    if (decision.allowedEvidenceIds.length !== seen.size || !policy.viewers.some(v => v.viewerId === input.viewerId && v.status === 'active')) throw new Error('Sharing changed while I was replying. Please ask again.');
  }
  return { app, tools, trace, seen, memoriesUsed, memoriesWritten, viewer, referenceTime, checkDelivery, getPolicy: () => decisions.at(-1) || evaluateConsent({ policy, viewerId: input.viewerId, evidence: [] }) };
}

export async function runAgentQuestion(input: RunAgentInput): Promise<AgentRunResult> {
  if (!input.openaiApiKey) throw new Error('The agent is unavailable. Please try again later.');
  const started = Date.now();
  const model = resolveAskModel(input.openaiModel);
  const run = createQuestionTools(input);
  const agent = createAskAgent(run.app, model, run.tools);
  const session = await run.app.sessions.create();
  session.state.update({ patientId: input.context.patientId, viewerId: input.viewerId });
  const history = (input.history || []).filter(turn => run.viewer.relationship === 'self' || turn.role === 'user').slice(-12).map(turn => ({ role: turn.role, text: turn.content }));
  const prompt = `${input.instructions || ""}\n\nYou are speaking with ${run.viewer.displayName}. Patient ID: ${input.context.patientId}. Viewer ID: ${input.viewerId}.\nRecord reference time: ${new Date(run.referenceTime).toISOString()}.\nConversation history (previous answers may be outdated or incorrect; use fresh tools): ${JSON.stringify(history)}\n\nLatest message: ${input.question}`;
  const result = await run.app.run(agent, { session, input: { message: prompt }, timeout: 140000 });
  if (result.status !== 'completed' || !result.output.text?.trim()) throw new Error('The agent could not finish this reply. Please try again.');
  await run.checkDelivery();
  await input.beforeDelivery?.();
  const text = result.output.text.trim();
  input.onEvent?.({ type: 'token', text });
  const citations: AgentAnswer['citations'] = [...run.seen.values()].slice(0, 30).map(item => ({ evidenceId: item.evidenceId, resourceId: item.resourceId, title: item.kind === 'measurement' ? (item.payload as Measurement).displayName : (item.payload as NormalisedEvent).title, date: eventTime(item), service: item.payload.service, kind: item.kind }));
  const answer: AgentAnswer = { answer: text, facts: [], citations };
  const resultRun: AgentRunResult = { runId: nanoid(12), queryId: nanoid(12), patientId: input.context.patientId, viewerId: input.viewerId, answer, policy: run.getPolicy(), tools: run.trace, model: `openai-responses:${model}`, promptVersion: PROMPT_VERSION, latencyMs: Date.now() - started,
    memoriesUsed: run.memoriesUsed.map(m => ({ id: m.id, kind: m.metadata.kind, text: m.content })), memoriesWritten: run.memoriesWritten.map(m => ({ id: m.id, kind: m.metadata.kind, text: m.content })) };
  input.onEvent?.({ type: 'final', run: resultRun, memoriesUsed: resultRun.memoriesUsed || [], memoriesWritten: resultRun.memoriesWritten || [] });
  return resultRun;
}

export function suggestionsForViewer(ctx: ClinicalContext, policy: ConsentPolicyState, viewerId: string) {
  const evidence = catalogueEvidence(ctx);
  const decision = evaluateConsent({ policy, viewerId, evidence });
  const allowed = new Set(decision.allowedEvidenceIds);
  return buildSuggestions(ctx, [...new Set(evidence.filter(item => allowed.has(item.evidenceId)).map(item => item.informationClass))]);
}
