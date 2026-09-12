/**
 * Family Companion — ADK spike.
 *
 * Proves, with NO API key:
 *   1. a custom tool (`get_upcoming_appointments`) in ADK idiom, executed for real
 *   2. a Claude-configured agent driven by a mock adapter via `adk({ adapters })`
 *   3. consent stored in the shared `patient` state scope, written from the patient's
 *      session and read from a family member's session (SQLite store, two sessions)
 *   4. a `beforeTool` hook as the consent-enforcement layer
 *   5. the exact JSON the REST handler returns and the AG-UI event stream shape
 *   6. a "proactive" run: server code invokes the agent with no human message
 *
 * Run (from a package that depends on @animahealth/adk + zod@3):
 *   npx tsx family-companion-spike.ts
 */
import { z } from 'zod'
import { adk, createEventId, openai, type Runnable, type StateSchema } from '@animahealth/adk'
import { claude } from '@animahealth/adk/claude'
import { sqliteStore } from '@animahealth/adk/stores/sqlite'
import { MockAdapter, runTest, user, model, getLastAssistantText } from '@animahealth/adk/testing'

// ---------------------------------------------------------------- 1. schema-first app
const CATEGORIES = ['appointments', 'medications', 'lab_results', 'diagnoses'] as const

const schema = {
  // per-session: who is talking to the agent in THIS thread (injected by the web backend per turn)
  session: {
    viewer: z.object({
      id: z.string(),
      name: z.string(),
      role: z.enum(['patient', 'family', 'clinician']),
    }),
  },
  // shared across every session bound to the same patient id: the consent ledger
  patient: {
    consent: z.record(z.string(), z.array(z.enum(CATEGORIES))), // granteeId -> categories
  },
} satisfies StateSchema

const app = adk({
  name: 'family-companion',
  schema,
  store: sqliteStore(new URL('./sessions.db', import.meta.url).pathname),
  // Mock the Claude provider so this runs offline. Delete `adapters` to go live on Vertex.
  adapters: { claude: mockClaude() },
})

// ---------------------------------------------------------------- 2. tools
const getUpcomingAppointments = app.tool({
  name: 'get_upcoming_appointments',
  description: "List the patient's upcoming appointments.",
  schema: z.object({ patient_id: z.string().describe('Patient identifier') }),
  execute: (ctx) => ({
    patient_id: ctx.args.patient_id,
    appointments: [
      { id: 'apt-1', when: '2026-09-18T10:30:00+03:00', clinician: 'Dr. Yılmaz', specialty: 'Cardiology', location: 'Acıbadem Maslak, Floor 3' },
      { id: 'apt-2', when: '2026-09-25T09:00:00+03:00', clinician: 'Lab', specialty: 'Blood draw (HbA1c, lipids)', location: 'Acıbadem Maslak, Lab B' },
    ],
  }),
})

const getLabResults = app.tool({
  name: 'get_lab_results',
  description: "Fetch the patient's most recent lab results.",
  schema: z.object({ patient_id: z.string() }),
  execute: (ctx) => ({
    patient_id: ctx.args.patient_id,
    results: [
      { test: 'HbA1c', value: 7.8, unit: '%', reference: '< 6.5', flag: 'high', date: '2026-09-01' },
      { test: 'LDL cholesterol', value: 145, unit: 'mg/dL', reference: '< 100', flag: 'high', date: '2026-09-01' },
    ],
  }),
})

const updateConsent = app.tool({
  name: 'update_consent',
  description: 'Grant or revoke what a family member or clinician may see. Patient-only.',
  schema: z.object({
    grantee_id: z.string(),
    categories: z.array(z.enum(CATEGORIES)).describe('Full replacement list; empty array revokes all'),
  }),
  execute: (ctx) => {
    if (ctx.state.viewer?.role !== 'patient') return { error: 'Only the patient can change consent.' }
    const current = ctx.state.patient.consent ?? {}
    ctx.state.patient.update({ consent: { ...current, [ctx.args.grantee_id]: ctx.args.categories } })
    // In the real build: also PUT a FHIR Consent resource to the EHR here.
    return { ok: true, consent: ctx.state.patient.consent }
  },
})

// ---------------------------------------------------------------- 3. consent engine = one hook
const TOOL_CATEGORY: Record<string, (typeof CATEGORIES)[number]> = {
  get_upcoming_appointments: 'appointments',
  get_lab_results: 'lab_results',
}

const consentGate = app.hook({
  name: 'consent_gate',
  beforeTool: (ctx, call) => {
    const category = TOOL_CATEGORY[call.name]
    if (!category) return // not a data tool
    const viewer = ctx.state.viewer
    if (!viewer || viewer.role === 'patient') return // patient sees their own data
    const allowed = (ctx.state.patient.consent ?? {})[viewer.id] ?? []
    if (allowed.includes(category)) return
    // Returning a tool_result short-circuits the tool: it never executes.
    return {
      id: createEventId(), type: 'tool_result', createdAt: Date.now(),
      invocationId: call.invocationId, agentName: call.agentName,
      callId: call.callId, name: call.name,
      error: `CONSENT_DENIED: ${viewer.name} has not been granted access to "${category}". Tell them to ask the patient.`,
    }
  },
})

// ---------------------------------------------------------------- 4. agent
const companion = app.agent({
  name: 'companion',
  model: claude('claude-sonnet-4-5', { vertex: { project: 'your-gcp-project', location: 'us-east5' } }),
  context: [
    app.context.system((ctx) =>
      `You are a warm health companion for an elderly patient and their family.
Speaking now: ${ctx.state.viewer?.name ?? 'unknown'} (${ctx.state.viewer?.role ?? 'unknown'}).
Explain results in plain language. Never reveal data a tool refused to return.`),
    app.context.history(),
  ],
  tools: [getUpcomingAppointments, getLabResults, updateConsent],
  hooks: [consentGate],
})

// ---------------------------------------------------------------- scripted model turns
function mockClaude() {
  return new MockAdapter({
    responses: [
      // A. patient grants consent
      { toolCalls: [{ name: 'update_consent', args: { grantee_id: 'ayse', categories: ['appointments', 'lab_results'] } }] },
      { text: 'Done — Ayşe can now see your appointments and lab results. Mehmet still cannot.' },
      // B. daughter (granted) asks about labs
      { toolCalls: [{ name: 'get_lab_results', args: { patient_id: 'p001' } }] },
      { text: "Your mum's HbA1c is 7.8% — that's her 3-month blood-sugar average, and it's above the 6.5% target..." },
      // C. son (not granted) asks about labs
      { toolCalls: [{ name: 'get_lab_results', args: { patient_id: 'p001' } }] },
      { text: "I'm not able to share your mum's lab results with you yet — she hasn't granted that. You could ask her to." },
      // D. proactive reminder, no human message
      { toolCalls: [{ name: 'get_upcoming_appointments', args: { patient_id: 'p001' } }] },
      { text: 'Reminder for the family: Cardiology with Dr. Yılmaz on Thu 18 Sep, 10:30, Maslak Floor 3. Who is taking her?' },
      // E. streaming demo
      { text: 'Hello from the stream.', streamChunks: true, chunkSize: 6 },
    ],
  })
}

// ---------------------------------------------------------------- run
const rest = app.handler.rest({ agent: companion, response: { state: true } })
const agui = app.handler.agui({ agent: companion })

const show = (label: string, v: unknown) => console.log(`\n=== ${label} ===\n` + JSON.stringify(v, null, 2))

/**
 * GOTCHA: HandlerInput has no `scopes`. If the handler creates the session, `patient` is UNBOUND and
 * `ctx.state.patient.update()` writes to an ephemeral object that is silently discarded. Always
 * pre-create threads with `app.sessions.create({ sessionId, scopes })` (it commits immediately).
 */
async function ensureThread(sessionId: string, scopes: { user: string; patient: string }) {
  if (await app.sessions.get(sessionId)) return
  await app.sessions.create({ sessionId, scopes })
}

async function main() {
  await ensureThread('thread:p001:self', { user: 'p001', patient: 'p001' })
  await ensureThread('thread:p001:ayse', { user: 'ayse', patient: 'p001' })
  await ensureThread('thread:p001:mehmet', { user: 'mehmet', patient: 'p001' })
  await ensureThread('thread:p001:family-group', { user: 'system', patient: 'p001' })

  // A. Patient's own thread. `state.viewer` is injected by the backend from the auth session.
  const a = await rest({
    sessionId: 'thread:p001:self',
    input: {
      state: { viewer: { id: 'p001', name: 'Fatma', role: 'patient' } },
      message: 'Let my daughter Ayşe see my appointments and lab results.',
    },
  })
  show('A. REST response — patient grants consent', a)

  // B. Daughter's thread — different session, same `patient` scope -> sees the consent written above.
  const b = await rest({
    sessionId: 'thread:p001:ayse',
    input: {
      state: { viewer: { id: 'ayse', name: 'Ayşe', role: 'family' } },
      message: "What do mum's latest lab results mean?",
    },
  })
  const bSession = await app.sessions.get('thread:p001:ayse')
  const bTool = bSession?.events.find((e) => e.type === 'tool_result')
  show('B. REST response — daughter WITH consent', {
    status: b.status, text: b.output.text,
    toolResultEvent: bTool,                                  // must be REAL lab data, not CONSENT_DENIED
    consentVisibleFromDaughterSession: bSession?.state.patient.consent, // read via shared patient scope
  })

  // C. Son's thread — no consent -> hook blocks the tool.
  const c = await rest({
    sessionId: 'thread:p001:mehmet',
    input: {
      state: { viewer: { id: 'mehmet', name: 'Mehmet', role: 'family' } },
      message: "Can you show me mum's lab results?",
    },
  })
  const cSession = await app.sessions.get('thread:p001:mehmet')
  const blocked = cSession?.events.find((e) => e.type === 'tool_result')
  show('C. REST response — son WITHOUT consent', { status: c.status, text: c.output.text, toolResultEvent: blocked })

  // D. Proactive: a cron/webhook in OUR server calls the agent. No human typed anything.
  const d = await rest({
    sessionId: 'thread:p001:family-group',
    input: {
      state: { viewer: { id: 'system', name: 'Scheduler', role: 'clinician' } },
      message: '[SYSTEM TRIGGER] appointment_reminder patient_id=p001 horizon=7d. Draft a reminder for the family group.',
    },
  })
  show('D. Proactive run (scheduler-triggered)', { status: d.status, text: d.output.text })

  // E. AG-UI streaming shape — what a Next.js route would forward as SSE.
  const types: string[] = []
  let streamed = ''
  for await (const ev of agui({ sessionId: 'thread:p001:self', input: { message: 'Say hello.' } })) {
    types.push(ev.type)
    if (ev.type === 'RUN_STARTED') console.log('E. RUN_STARTED payload:', JSON.stringify(ev))
    if (ev.type === 'TEXT_MESSAGE_CONTENT') streamed += (ev as { delta: string }).delta
  }
  show('E. AG-UI event types', types)
  console.log('E. reassembled text:', JSON.stringify(streamed))

  // F. Persistence check: the ledger survived in SQLite.
  const persisted = await app.sessions.get('thread:p001:self')
  show('F. Persisted session ledger', {
    id: persisted?.id, version: persisted?.version, scopes: persisted?.scopes,
    eventTypes: persisted?.events.map((e) => e.type),
    sharedPatientConsent: persisted?.state.patient.consent,
  })

  // G. The deterministic test kit path (only mocks openai/gemini descriptors).
  const testApp = adk({ name: 'test', schema })
  const apptTool = testApp.tool({ ...getUpcomingAppointments, name: 'get_upcoming_appointments', description: 'x', schema: z.object({ patient_id: z.string() }), execute: getUpcomingAppointments.execute! })
  const testAgent = testApp.agent({ name: 'companion', model: openai('gpt-5-mini'), context: [testApp.context.history()], tools: [apptTool] })
  // GOTCHA: runTest's parameter is the untyped `Runnable`; a schema-typed Agent<S> needs a cast.
  const t = await runTest(testAgent as unknown as Runnable, [
    user('What appointments does p001 have?'),
    model({ toolCalls: [{ name: 'get_upcoming_appointments', args: { patient_id: 'p001' } }] }),
    model('Two: cardiology on the 18th and a blood draw on the 25th.'),
  ])
  const toolResult = t.events.find((e) => e.type === 'tool_result')
  show('G. runTest path', { status: t.status, text: getLastAssistantText(t.events), toolReturned: toolResult && 'result' in toolResult ? toolResult.result : null })

  await app.close?.()
}

main().catch((e) => { console.error('SPIKE FAILED', e); process.exit(1) })
