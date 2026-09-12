import { chatId } from '../chat-ids';
import { z } from 'zod';
import { getState, updateMessage, refreshConsent, addAudit, addFamilyMember, removeFamilyMember, setLevelDefinition, checkConsent } from '../store';
import { personById, visibleMessages, CATEGORIES, type Category, type ToolTrace } from '../types';
import { toolsForActor, type ToolDef } from './tools';
import { runAgentQuestion, type AdditionalAgentTool } from '../carecircle/server/agent/harness';
import { canonicalPolicy } from '../carecircle/server/consent/canonical';
import { NeonClinicalClient } from '../carecircle/server/neon/client';
import { AnimaClient } from '../carecircle/server/anima/client';
import { careStore, careMemory, withCareRuntime } from '../carecircle/server/store/runtime';
import { loadContext } from '../carecircle/server/runtime';

function schemaFor(def: ToolDef): z.AnyZodObject {
  const shape: Record<string, z.ZodTypeAny> = {};
  const required = new Set(def.input_schema.required || []);
  for (const [key, raw] of Object.entries(def.input_schema.properties || {})) {
    const property = raw as { type?: string; enum?: string[]; description?: string };
    let value: z.ZodTypeAny;
    if (property.enum?.length) value = z.enum(property.enum as [string, ...string[]]);
    else if (property.type === 'boolean') value = z.boolean();
    else if (property.type === 'string') value = z.string();
    else throw new Error(`Unsupported schema for ${def.name}.${key}`);
    if (property.description) value = value.describe(property.description);
    shape[key] = required.has(key) ? value : value.nullable().optional();
  }
  return z.object(shape).strict();
}

export async function adkTurn(messageId: string, threadId: string, actorId: string, text: string) {
  const initial = getState();
  const patientId = initial.patient.simId;
  const viewerId = actorId === initial.patientId ? 'patient' : actorId;
  const legacyThread = initial.threads[threadId]?.kind === 'group' ? 'family-group' : `${actorId}-kindred`;
  const memoryThread = chatId(patientId, legacyThread) === threadId ? legacyThread : threadId;
  const sessionId = `kindred-${patientId}-${actorId}-${memoryThread}`;
  await withCareRuntime(async () => {
    const client = process.env.DATABASE_URL ? new NeonClinicalClient() : new AnimaClient({ baseUrl: process.env.SIM_BASE_URL || 'http://localhost:4192', apiKey: process.env.SIM_API_KEY || 'local-demo' });
    let session = careStore().getSession(sessionId);
    if (!session) {
      const team = await client.getTeam();
      session = careStore().createSession({ animaBaseUrl: 'neon', animaApiKey: '', dataSource: 'neon', scopes: team.scopes,
        selectedPatientId: patientId, selectedPatientName: initial.patient.name });
    }
    const context = await loadContext(client, patientId, session);
    const policy = await canonicalPolicy(patientId, initial.patient.name);
    const consentReads = new Set<Category>();
    const additionalTools: AdditionalAgentTool[] = toolsForActor(actorId)
      .filter(def => !['get_appointments', 'get_lab_results'].includes(def.name))
      .map(def => ({ name: def.name, description: def.description, schema: schemaFor(def), execute: async args => {
        await refreshConsent(true);
        if (getState().ehr.syncError) throw new Error('Sharing preferences are unavailable.');
        if (!def.allowedRoles.includes(personById(getState(), actorId).role)) throw new Error('This action is not available to this viewer.');
        const result = await def.handler({ actorId, threadId }, args);
        if (result.consentCheck?.allowed) consentReads.add(result.consentCheck.category);
        return result.ok ? { data: result.data, notice: result.summary } : { error: result.error, notice: result.summary };
      } }));
    if (actorId === initial.patientId) additionalTools.push(
      { name: 'add_family_member', description: 'Add a family member to the patient’s circle. Nothing is shared with a new member until the patient chooses permissions.', schema: z.object({ name: z.string(), relationship: z.string(), email: z.string().nullable().optional() }), execute: args => addFamilyMember({ name: String(args.name), relationship: String(args.relationship), email: args.email ? String(args.email) : undefined }) },
      { name: 'remove_family_member', description: 'Remove an identified member from the patient’s circle when requested. Their access is revoked.', schema: z.object({ personId: z.string() }), execute: args => removeFamilyMember(String(args.personId)) },
      { name: 'set_sharing_level_definition', description: 'Change which record categories a sharing level includes. This affects everyone assigned to that level; use only when the patient asks to change the level itself.', schema: z.object({ level: z.enum(['everything', 'practical', 'updates']), categories: z.array(z.enum(['appointments', 'medications', 'lab_results', 'conditions', 'care_notes', 'mental_health'])) }), execute: args => setLevelDefinition({ level: args.level as 'everything' | 'practical' | 'updates', categories: args.categories as Category[], actorId }) },
    );
    const history = visibleMessages(initial, threadId, actorId).filter(m => m.kind === 'chat' && !m.streaming && m.id !== messageId).slice(-13, -1).map(m => ({ role: m.senderId === initial.agentId ? 'assistant' as const : 'user' as const, content: m.text }));
    const liveTraces: ToolTrace[] = [];
    const result = await runAgentQuestion({ client, context, policy, viewerId, question: text, history,
      openaiApiKey: process.env.OPENAI_API_KEY, openaiModel: initial.agentModel, memory: careMemory(), additionalTools,
      refreshPolicy: () => canonicalPolicy(patientId, initial.patient.name),
      instructions: `You are in the Kindred patient and family chat. You can read clinical records and take the actions exposed by your tools. The patient's sharing levels are ${JSON.stringify(initial.levels)}. Category labels: ${JSON.stringify(CATEGORIES.map(c => ({ id: c.id, label: c.label })))}. For consent changes use the patient's own levels and the action tools; get_consent lists current people by name.`,
      beforeDelivery: async () => {
        await refreshConsent(true);
        if (getState().ehr.syncError || [...consentReads].some(category => !checkConsent(actorId, category).allowed)) throw new Error('Sharing changed while replying. Please ask again.');
      },
      onToolObservation: tool => {
        liveTraces.push({ name: tool.tool, input: tool.arguments, summary: tool.detail, ok: tool.status === 'ok', ms: tool.latencyMs, callId: tool.callId, source: 'model' });
        updateMessage(messageId, { trace: [...liveTraces] });
      },
      onEvent: event => { if (event.type === 'status') updateMessage(messageId, { text: '' }); },
    });
    const traces: ToolTrace[] = result.tools.map(tool => ({ name: tool.tool, input: tool.arguments, summary: tool.detail, ok: tool.status === 'ok', ms: tool.latencyMs, callId: tool.callId, source: 'model' }));
    for (const trace of traces) addAudit({ kind: 'tool.call', actorId, summary: `${trace.name}: ${trace.summary}`, detail: trace, ok: trace.ok });
    careStore().addRun(result);
    updateMessage(messageId, { text: result.answer.answer, streaming: false, trace: traces, clinicalAnswer: result.answer });
  }, sessionId);
}
