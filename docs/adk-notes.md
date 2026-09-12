# Anima ADK (`@animahealth/adk`) — notes for the Family Companion agent

Researched 2026-09-12 against a fresh clone at `vendor/adk` (tag `v0.6.0`, HEAD `138eb40`). Everything in
"Install + run" and the two files in `docs/examples/` was actually executed on this machine with **no API key**.

---

## 1. What it is

| | |
|---|---|
| Package | `@animahealth/adk` (repo `mycontinuum-com/adk`, MIT, by Anima Health — a UK clinical-ops company) |
| Language / runtime | **TypeScript**, Node **>= 22** (we ran on Node 26.8.1 fine), ESM + CJS dual build, pnpm 10 (`packageManager` pins 10.11.0; our 10.16 delegated to it automatically) |
| Version / maturity | **0.6.0 = first public release (2026-09-01)**. Pre-1.0. The public repo is a "continuously exported snapshot" of their internal monorepo (11 public commits, but the CHANGELOG goes back through 0.5.x, so it has real production mileage). They explicitly say: one clear API, no compat aliases, expect breaking changes; **pin the version**. |
| Docs | https://adk.animahealth.com (runnable docs). In-repo: `README.md`, `CHANGELOG.md` (very good), `examples/*.ts` (19 files), `skills/adk/**` (an agent-facing reference; partly stale, see gotchas). |
| Tests | `pnpm run test` → 141 files / 2111 tests pass in ~7 s with **no keys and no DB** (providers are mocked). |

Core idea in one paragraph: an agent's whole life is an **append-only event ledger** per session (`user`, `assistant`,
`tool_call`, `tool_result`, `state_change`, `model_start/end`, …). All state derives from it (time travel, forks, audit
are free). The model only sees what **context renderers** project from that ledger. Tools are **Zod-typed** and can
**yield** (pause the run for a human, resume days later). Providers (OpenAI, Gemini, Claude-via-Vertex) live behind
subpath imports. A **deterministic test kit** scripts only the model; tools and state run for real. Ships handlers
(`turn` / REST / AG-UI streaming / LiveKit voice), an **MCP client**, vector memory, and an eval harness.

Two stability tiers: **Core** (main entry + all subpaths below) and **Experimental** (`/workflow`, `/agents/coding`,
`/agents/coding/claude-code`) — we only need Core.

Subpaths: `@animahealth/adk` · `/openai` · `/gemini` · `/claude` · `/stores/sqlite` · `/stores/postgres` ·
`/stores/dynamodb` · `/testing` · `/eval` · `/agui` · `/web` · `/voice` · `/cli` · `/voyage` · `/qdrant`.

**Healthcare/FHIR helpers: none.** The only domain-specific thing is the built-in shared state scopes
`patient` / `practice` / `org` / `team` / `user` (see §6). No FHIR client, no consent model. Our own
`web/src/lib/fhir.ts` (`toFhirConsent`) is what we'd call from a tool.

---

## 2. Install + run — commands that actually worked

```bash
# 1. Vendor the framework (done)
git clone https://github.com/mycontinuum-com/adk vendor/adk

# 2. Build it (examples/consumers import the package by name -> needs dist/)
cd vendor/adk
pnpm install          # ~16 s. Warning about ignored build scripts for @google/genai & livekit is harmless.
pnpm run build        # tsup + tsc --emitDeclarationOnly; ~1 min. Produces dist/ incl. dist/claude, dist/stores/sqlite
pnpm run test         # 2111 tests, ~7 s, keyless

# 3. Run the README "first run" (keyless) inside the repo
#    NOTE: must wrap in main() — see gotcha about top-level await
npx tsx examples/_tmp.ts
# TEXT: Hello! Ask me anything.
# EVENTS: user -> invocation_start -> model_start -> model_end -> assistant -> invocation_end
```

Consuming it from **our own package** (this is how `agent/` should depend on it). Verified with
`docs/examples/package.spike.json`:

```jsonc
{
  "name": "family-companion-agent",
  "type": "module",                       // ESM: top-level await etc. all fine
  "dependencies": {
    "@animahealth/adk": "link:../vendor/adk",   // symlink; use "file:" or npm later
    "zod": "3.25.76"                             // MUST be zod 3.25.x — ADK refuses zod 4 schemas
  },
  "devDependencies": { "tsx": "^4.21.0", "typescript": "^5.8.3", "@types/node": "^22" }
}
```

```bash
pnpm install
npx tsx family-companion-spike.ts   # docs/examples/family-companion-spike.ts — full output in §4/§7
npx tsc -p tsconfig.json            # typechecks clean
```

With `link:` the optional peers (`better-sqlite3`, `@anthropic-ai/vertex-sdk`, `openai`, …) resolve through the
symlink from `vendor/adk/node_modules`. **If you ever install from npm instead, you must add the peers you use
yourself** (`better-sqlite3` for SQLite sessions, `@anthropic-ai/vertex-sdk` for Claude, `@modelcontextprotocol/sdk`
for MCP).

Environment on this machine (presence only): `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`,
`GOOGLE_APPLICATION_CREDENTIALS` — **all unset**. `gcloud` CLI is installed, ADC file exists at
`~/.config/gcloud/application_default_credentials.json`, active project `uterio`. We did **not** make a live model call
(would bill that project; Claude/Vertex enablement there is unknown).

---

## 3. Agent definition — annotated minimal example

Agents are **code, not config** (TypeScript objects built through an app-bound factory).

```ts
import { z } from 'zod'
import { adk, type StateSchema } from '@animahealth/adk'
import { claude } from '@animahealth/adk/claude'
import { sqliteStore } from '@animahealth/adk/stores/sqlite'

// 1. Schema-first: typed state. `session` = this thread. `patient` = shared by every
//    session bound to the same patient id (this is where consent lives).
const schema = {
  session: { viewer: z.object({ id: z.string(), name: z.string(), role: z.enum(['patient', 'family', 'clinician']) }) },
  patient: { consent: z.record(z.string(), z.array(z.enum(['appointments', 'medications', 'lab_results', 'diagnoses']))) },
} satisfies StateSchema

// 2. The app: name (namespaces sessions in the store), schema, store, app-wide hooks/errorHandlers,
//    optional `adapters` (inject mock/custom ModelAdapters), optional `defaultModel` for app.ask().
const app = adk({ name: 'family-companion', schema, store: sqliteStore('./sessions.db') })

// 3. The agent = model + context renderers + tools (+ hooks).
const companion = app.agent({
  name: 'companion',
  description: 'Used when other agents hand off to this one',           // optional
  model: claude('claude-sonnet-4-5', { vertex: { project: 'gcp-proj', location: 'us-east5' } }),
  context: [                                                             // the ONLY bridge ledger -> prompt
    app.context.system((ctx) => `You help ${ctx.state.viewer?.name}. Explain results in plain language.`),
    app.context.history(),        // scope: 'direct' (default) | 'all' | 'invocation' | 'ancestors' | 'agent'
    // app.context.user((ctx) => `...`)   inject a rendered user turn (no ledger event) – used for proactive runs
    // app.context.selectRecent(20), app.context.pruneReasoning(), app.context.limitTools([...])
  ],
  tools: [/* app.tool(...) results, MCP servers, provider-native tools */],
  hooks: [/* app.hook({ beforeTool, afterTool, beforeAgent, onEvent, ... }) */],
  // output: 'sessionKey' | { schema } | FunctionTool   -> structured output (native JSON mode)
  // toolChoice: 'auto', maxSteps: 25, maxTurns: 100, yields: false, timeouts: { inactivity, expiry }
})

// 4. Run: string or { session, input: { message | tools | state | initialState }, hooks, timeout }
const result = await app.run(companion, 'Hello')       // await -> RunResult; `for await` -> stream events
result.status      // 'completed' | 'yielded_tool' | 'yielded_message' | 'error' | 'max_steps' | ...
result.output.text // also .value (structured), .items (assistant events), .media
```

Composition primitives (deterministic, no LLM): `app.step({ execute(ctx) })` (can `ctx.fail()`, `ctx.respond()`,
`ctx.skip()`, or *return a runnable to route*), `app.sequence`, `app.parallel`, `app.loop({ while, yields })`.
From inside a tool/step: `ctx.run(agent, input)` (await sub-agent), `ctx.spawn` (background), `ctx.dispatch`
(fire-and-forget), or `return otherAgent` to transfer. `app.ask(prompt, { schema })` = one-shot typed LLM call.

---

## 4. Tool definition — the example we got working

From `docs/examples/family-companion-spike.ts` (runs keyless, typechecks):

```ts
const getUpcomingAppointments = app.tool({
  name: 'get_upcoming_appointments',                    // what the model sees
  description: "List the patient's upcoming appointments.",
  schema: z.object({ patient_id: z.string().describe('Patient identifier') }),  // zod 3 -> JSON schema for the model
  execute: (ctx) => ({                                  // ctx.args is typed from `schema`
    patient_id: ctx.args.patient_id,
    appointments: [
      { id: 'apt-1', when: '2026-09-18T10:30:00+03:00', clinician: 'Dr. Yılmaz', specialty: 'Cardiology', location: 'Acıbadem Maslak, Floor 3' },
      { id: 'apt-2', when: '2026-09-25T09:00:00+03:00', clinician: 'Lab', specialty: 'Blood draw (HbA1c, lipids)', location: 'Acıbadem Maslak, Lab B' },
    ],
  }),                                                   // return value -> `tool_result.result` (any JSON)
})
```

`ToolContext` gives you: `ctx.args`, `ctx.state` (typed; `ctx.state.viewer`, `ctx.state.patient.consent`,
`ctx.state.patient.update({...})`), `ctx.session`, `ctx.callId`, `ctx.toolName`, `ctx.invocationId`,
`ctx.run/spawn/dispatch`, `ctx.output(value)` (end the run with this as the result), `ctx.note()` (progress annotation).
Other options: `timeout`, `retry`, `prepare(ctx)` (transform args before yielding), `finalize(ctx)`.

**Yielding tool (human-in-the-loop)** — the ADK's signature move; use it for "confirm consent change":

```ts
const confirmConsent = app.tool({
  name: 'confirm_consent_change',
  description: 'Ask the patient to confirm a consent change in the UI.',
  schema: z.object({ grantee_id: z.string(), categories: z.array(z.string()) }),
  yieldSchema: z.object({ confirmed: z.boolean() }),        // <- run pauses with status 'yielded_tool'
  execute: (ctx) => { if (!ctx.input?.confirmed) return { cancelled: true }; /* apply */ return { ok: true } },
})
// Resume later:  session.input.tool({ callId, input: { confirmed: true } }); await app.run(agent, { session })
// Over REST:     POST { sessionId, input: { tools: [{ callId, input: { confirmed: true } }] } }
```

**How we confirmed the tool loads and executes** (two ways, both in the spike):

1. `runTest` from `/testing` (scripts only the model; the tool really ran):
   ```ts
   const t = await runTest(testAgent as unknown as Runnable, [
     user('What appointments does p001 have?'),
     model({ toolCalls: [{ name: 'get_upcoming_appointments', args: { patient_id: 'p001' } }] }),
     model('Two: cardiology on the 18th and a blood draw on the 25th.'),
   ])
   // -> status 'completed'; the tool_result event carries our hardcoded appointments
   ```
2. `adk({ adapters: { claude: new MockAdapter({ responses: [...] }) } })` and the real REST handler — this is the one
   that works with a `claude(...)`-configured agent (see gotcha: `runTest` only mocks openai/gemini).

Observed output (abridged):
```
=== G. runTest path === status: completed
toolReturned: { patient_id: 'p001', appointments: [ {id:'apt-1', clinician:'Dr. Yılmaz', ...}, {id:'apt-2', ...} ] }
```

---

## 5. LLM provider config — Claude support

| Provider | Import | Auth / env vars |
|---|---|---|
| OpenAI | `import { openai } from '@animahealth/adk/openai'` → `openai('gpt-5-mini', { temperature, reasoning: { effort }, promptCache })` | `OPENAI_API_KEY`; or Azure: `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_API_VERSION`; or `OPENAI_EU_API_KEY` (resolution order Azure → EU → standard) |
| Gemini | `import { gemini } from '@animahealth/adk/gemini'` → `gemini('gemini-2.5-flash', { thinkingConfig, vertex? })` | `GEMINI_API_KEY` (AI Studio) **or** Vertex via `GOOGLE_APPLICATION_CREDENTIALS` / `vertex.credentials` |
| **Claude** | `import { claude } from '@animahealth/adk/claude'` → `claude('claude-sonnet-4-5', { vertex: { project, location, credentials? }, thinking: { budgetTokens }, promptCache: { enabled, ttl: '5m'\|'1h', system }, retry, temperature, maxTokens })` | **Vertex AI only.** Uses `@anthropic-ai/vertex-sdk`. Needs `GOOGLE_APPLICATION_CREDENTIALS=/path/to/creds.json` **or** `vertex.credentials` path (the adapter copies it into `process.env.GOOGLE_APPLICATION_CREDENTIALS` — global side effect). `vertex` is **required** in the type. Claude must be enabled in the GCP project's Model Garden. |

**There is no direct Anthropic API support in Core.** `grep -r ANTHROPIC_API_KEY src` only hits the experimental
Claude-Code coding agent. `@anthropic-ai/sdk` is not a dependency (only transitively via vertex-sdk).

Ways to run on Claude for the hackathon, in order of preference:

1. **Vertex** (zero code): we already have gcloud ADC on this machine. `claude('claude-sonnet-4-5@20250929', { vertex: { project: '<gcp-project-with-claude-enabled>', location: 'us-east5', credentials: '/Users/ainergiz/.config/gcloud/application_default_credentials.json' } })`. Check Model Garden for the exact Vertex model id (Vertex uses `name@date`; the ADK passes `config.name` straight through as `model`). Not verified live here.
2. **Direct-API shim** (~25 lines, **not tested live — no key**): the Vertex coupling is *only* inside
   `ClaudeAdapter.getClient()` (`vendor/adk/src/providers/claude.ts` L133–165); everything else calls
   `client.messages.create(...)`, which `@anthropic-ai/sdk`'s `Anthropic` client also has. So:
   ```ts
   // agent/src/direct-claude-adapter.ts   (ClaudeAdapter is NOT exported from '/claude'; import from vendored source)
   import Anthropic from '@anthropic-ai/sdk'
   import { ClaudeAdapter } from '../../vendor/adk/src/providers/claude'   // tsx compiles TS; or copy the file
   export class DirectClaudeAdapter extends ClaudeAdapter {
     private direct = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
     // @ts-expect-error getClient is `private` upstream; we override at runtime
     protected getClient() { return this.direct }
   }
   const app = adk({ ..., adapters: { claude: new DirectClaudeAdapter() } })
   // model: claude('claude-sonnet-4-5-20250929', { vertex: { project: 'unused', location: 'unused' } })  // vertex still required by the type
   ```
   Risks: Vertex-specific request tweaks (prompt-cache fallback at L234, L365) are harmless on the direct API; the
   `vertex` object is dead config. `adk({ adapters })` is honoured by `app.run`, all `app.handler.*`, and `app.cli`
   (fixed in 0.6.0).
3. **OpenAI or Gemini** with a key — trivially supported, good fallback.
4. **`MockAdapter`** — what the spike uses; lets the whole UI/flow be built and demoed offline.

Error handling: `adk({ errorHandlers: [rateLimitHandler({ maxRetries }), timeoutHandler({ fallbackResult }), retryHandler({ maxAttempts })] })`.

---

## 6. Session / memory / multi-user model

**Session = one thread.** `Session { id, appName, version, scopes, events, state, status, yieldedTools, input.message()/tool(), output, stateAt(i), forkAt(i), ... }`.
Ids are normalized with a `session_` prefix (`'thread:p001:self'` → `session_thread:p001:self`; both `sessions.create`
and the handlers normalize, so you can keep using your raw id).

```ts
const s = await app.sessions.create({ sessionId: 'thread:p001:ayse', scopes: { user: 'ayse', patient: 'p001' } }) // commits immediately
await app.sessions.get(id) / list() / delete(id) / commit(session, expectedVersion) / merge(session, latest)
```

**State scopes** (all declared in `adk({ schema })`, all typed on `ctx.state`):

| scope | shared across | write API | notes |
|---|---|---|---|
| `session` | this thread only | `ctx.state.foo = x` / `ctx.state.update({...})` | e.g. `viewer` (who is talking) |
| `user`, **`patient`**, `practice`, `org`, `team` | every session created with the same scope id | `ctx.state.patient.update({...})` | **consent lives here**; persisted on commit; loaded+bound on `sessions.create`/`get` |
| `temp` | one model step | `ctx.state.temp.x` | not logged |

Every write emits a `state_change` event (audit for free). **Verified cross-session sharing** (spike §B/§F): the
patient's session wrote `consent.ayse = [appointments, lab_results]`; the daughter's separate session read it via
`ctx.state.patient.consent` and the persisted ledger shows `scopes: { user: 'p001', patient: 'p001' }`.

**Stores** (`adk({ store })`, all pass one compliance suite): `inMemoryStore()` (default), `sqliteStore(path)` from
`/stores/sqlite` (`':memory:'` ok; needs `better-sqlite3`; **verified**), `postgresStore(...)` (`pg`), `dynamoStore(...)`.
Optimistic concurrency: commits carry a version; conflicts resolve to `committed | merged | skipped | orphaned`
(`TurnResult.commitStatus`). Postgres is what they run in prod; SQLite is perfect for the demo.

**Multi-user reality check.** `UserEvent` = `{ type:'user', text, media?, source? }` — **no author/user-id field**.
So "one session with three humans" has no first-class attribution. The model that works (and that we verified):

- one **session per (viewer, patient) thread**: `thread:p001:self`, `thread:p001:ayse`, `thread:p001:mehmet`,
  plus `thread:p001:family-group` for broadcasts; all bound to `scopes.patient = 'p001'`;
- the web backend injects identity **per turn** via `input.state.viewer = { id, name, role }` (from its auth);
- if you want a genuinely shared group chat where several humans type, prefix each message text with the speaker
  (`"Ayşe: …"`) and pass the speaker in `input.state.viewer`; the agent's reply lands in the shared thread.

Isolation falls out naturally: `app.context.history()` only renders the current session, so the daughter's agent
never sees the patient's private chat.

**Vector memory** (optional, not needed for the demo): `memory({ model: voyage(...), index: inMemoryIndex()|sqliteVec({path})|pgvector()|qdrant(), collection, metadata })`
→ `mem.context({ query, topK })` (deterministic recall into the prompt) or `mem.tool()` (agent-driven recall).

---

## 7. HTTP / streaming surface for the web frontend

**The ADK ships no HTTP server.** Handlers are plain async functions you mount in any framework
(examples show AWS Lambda). Three flavours, all sharing one input shape:

```ts
// HandlerInput
{
  sessionId?: string,                         // omit -> new session id generated
  input: {
    message?: string | { text?: string, media?: MediaPart[], invocationId?: string },
    tools?:   Array<{ callId: string, input: unknown }>,  // resume yielded tools
    state?:   Record<string, unknown>,        // session-scope state to set before the run (validated by schema)
    initialState?: StateChanges,              // seed session + shared scopes
  }
}
// NOTE: no `scopes` here -> pre-create the session with app.sessions.create({ sessionId, scopes }) (see gotchas)
```

### 7a. `app.handler.rest({ agent, response?: { state?, events?, usage? }, hooks?, timeout? })` → `(input) => Promise<RestResponse>`

Observed response (spike §A):
```json
{
  "sessionId": "session_thread:p001:self",
  "status": "completed",
  "output": {
    "text": "Done — Ayşe can now see your appointments and lab results. Mehmet still cannot.",
    "value": "Done — …",
    "items": [ { "id": "event_…", "type": "assistant", "createdAt": 1789212121213, "invocationId": "inv_…", "agentName": "companion", "text": "Done — …" } ]
  },
  "state": { "viewer": { "id": "p001", "name": "Fatma", "role": "patient" } }
}
```
Other fields: `yieldedTools: [{ callId, name, args }]` when `status === 'yielded_tool'`; `error` when `'error'`;
`events` (full stream) if `response.events`; `usage` if `response.usage`; `warning` on `orphaned` commits.
`response.state` returns **session scope only** (not `patient`).

### 7b. `app.handler.agui({ agent })` → `(input) => AsyncIterable<AGUIEvent>` — **streaming, AG-UI protocol**

Observed event sequence (spike §E): `RUN_STARTED {threadId: sessionId, runId: invocationId}` → `STATE_SNAPSHOT` →
`TEXT_MESSAGE_START` → `TEXT_MESSAGE_CONTENT {delta}` × n → `TEXT_MESSAGE_END` → `RUN_FINISHED {commitStatus}`.
Also emitted when relevant: `REASONING_*`, `TOOL_CALL_START/ARGS/END/RESULT`, `STATE_DELTA`, `STEP_STARTED/FINISHED`,
`CUSTOM` (`runInterrupted` with `reason: 'tool_yield' | 'input_required'` for yields), `RUN_ERROR`.
Forward as SSE exactly like `examples/lambda-agui.ts`:

```ts
// Next.js route handler (web/src/app/api/agent/stream/route.ts) — or the same in Hono/Express in agent/
export async function POST(req: Request) {
  const body = await req.json()                       // HandlerInput
  const stream = new ReadableStream({
    async start(c) {
      const enc = new TextEncoder()
      for await (const ev of agui(body)) c.enqueue(enc.encode(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`))
      c.close()
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } })
}
```
On the client, `fetch` + `ReadableStream` (or `@ag-ui/client`), concatenate `TEXT_MESSAGE_CONTENT.delta`.

### 7c. `app.handler.turn({ agent })` → `(input) => TurnStream` — raw ADK events, for a custom protocol

```ts
const stream = turnHandler({ sessionId, input })
for await (const ev of stream) { /* ev.type: assistant_delta | tool_call | tool_result | state_change | ... */ }
const result = await stream       // TurnResult = RunResult + { sessionId, invocationId, commitStatus }
```
ADK stream event types: `thought_delta, thought, assistant_delta, assistant, tool_call, tool_yield, tool_input,
tool_result, state_change, invocation_start/end/yield/resume, model_start, model_end, artifact_update, annotation`.
`model_start/model_end` carry rendered context, token usage and **cost** — nice for an "interpretability" panel.

### 7d. Reading the ledger for an audit/interpretability view
`const s = await app.sessions.get(id); s.events` — every tool call, every `CONSENT_DENIED` tool_result, every
`state_change` with `oldValue/newValue`. `s.stateAt(i)` / `s.forkAt(i)` for time travel.

### Suggested minimal endpoints (agent service or Next.js API routes)
| Method & path | Body → Handler |
|---|---|
| `POST /api/agent/turn` | `HandlerInput` → `rest(...)` → JSON `RestResponse` |
| `POST /api/agent/stream` | `HandlerInput` → `agui(...)` → SSE |
| `GET  /api/agent/sessions/:id` | → `app.sessions.get(id)` → `{ events, state, scopes }` (audit panel) |
| `POST /api/agent/threads` | `{ sessionId, scopes }` → `app.sessions.create` (called once per persona/thread) |
| `POST /api/agent/proactive` | `{ patientId }` → runs the reminder agent (§8) |

---

## 8. Proactive / scheduled triggers

**Nothing built in.** No cron, no timers, no webhooks in the public API. (Internally `src/gateway/` has a process store
with `schedule: cron | interval` and `nextWakeAt`, but it is unexported "proposals-stage machinery" — don't build on it.)

The framework's position: any server code can run an agent on any session at any time. Two patterns, both verified:

1. **Synthetic trigger message** (spike §D): `rest({ sessionId: 'thread:p001:family-group', input: { message: '[SYSTEM TRIGGER] appointment_reminder …' } })`. Simple, but leaves a fake `user` event in the ledger.
2. **Rendered trigger, no user event** (`docs/examples/proactive-no-message.ts`) — cleaner:
   ```ts
   const reminder = app.agent({
     name: 'reminder', model,
     context: [
       app.context.system('You draft family reminders.'),
       app.context.user((ctx) => `TRIGGER ${ctx.state.trigger.kind} for ${ctx.state.trigger.patientId} within ${ctx.state.trigger.horizon}`),
       app.context.history(),
     ],
     tools: [getUpcomingAppointments, postToFamilyGroup],
   })
   const session = await app.sessions.get('thread:p001:family-group')
   await app.run(reminder, { session, input: { state: { trigger: { kind: 'appointment_reminder', patientId: 'p001', horizon: '7d' } } } })
   await app.sessions.commit(session, session.version)
   // ledger: state_change -> invocation_start -> model_start -> model_end -> assistant -> invocation_end   (0 user events)
   ```
   The model received `[system, user:"TRIGGER appointment_reminder for p001 within 7d"]`.

Who calls it: `setInterval`/`node-cron` in the `agent/` process, **Vercel Cron → `POST /api/agent/proactive`**, or the
NHS-SIM's clock (`GET/POST /api/clock` in `docs/sim-openapi.json`) advancing time → our webhook. The team's existing
`web/src/lib/agent/proactive.ts` (`runProactiveCheck`) is exactly this shape and ports directly.

---

## 9. MCP support

**Yes — as a client** (consume MCP servers as tools). Needs peer `@modelcontextprotocol/sdk` (already in vendor).

```ts
const ehr = app.mcp.server({
  name: 'nhs-sim',
  // stdio:
  command: 'npx', args: ['-y', 'some-mcp-server'], env: {...}, cwd,
  // or remote:
  url: 'https://…/mcp', transport: 'http' | 'sse', authorization: token, headers: {...},
  timeout, cacheToolsList: true, includeTools: [...], excludeTools: [...],
})
tools: [ehr, ehr.only(['get_patient']), ehr.exclude(['delete_record'])]
context: [ehr.resource('file:///…'), ehr.prompt('name', args)]
await app.mcp.connect() / disconnect(); app.mcp.tools(); server.healthCheck()
```
Lazy connect on first call, auto-reconnect. No built-in "confirm before MCP tool" — wrap risky ones in an
`app.tool` with `yieldSchema`. It does **not** expose our agent *as* an MCP server. For the hackathon, plain
`app.tool`s calling the NHS-SIM REST API (`/api/nhs/appointments`, `/api/nhs/pathology`, `/api/nhs/pds/Patient/{id}`,
`/api/nhs/gp-connect`…) are simpler than standing up an MCP server.

---

## 10. Recommended architecture for the three demo flows

### Package layout (the zod problem forces this)
`web/` is Next.js 16 on **zod 4**; the ADK **refuses zod 4** at `adk({schema})`/`app.tool()`. Don't fight it:

```
family-companian/
  vendor/adk/          # framework (built)
  agent/               # NEW: Node ESM service, zod 3.25, depends on "link:../vendor/adk"
    src/app.ts         # adk({ name, schema, store: sqliteStore('./data/sessions.db'), adapters?, hooks: [audit] })
    src/tools/*.ts     # get_appointments, get_lab_results, get_medications, update_consent, request_access, post_to_family_group
    src/consent.ts     # beforeTool hook (the consent engine) + TOOL_CATEGORY map
    src/agents.ts      # companion (chat) + reminder (proactive)
    src/server.ts      # Hono/Express on :4000: /turn /stream /sessions/:id /threads /proactive
  web/                 # Next.js: route handlers proxy to :4000 (or call fetch from server components)
```
(Alternative if a second process is unwelcome: alias `"zod3": "npm:zod@3.25.76"` in `web/` and write agent code with
`import { z } from 'zod3'`. Works with the `link:` install because the ADK resolves its own zod; but the proxy is cleaner.)

### Shared schema
```ts
session: { viewer: {id,name,role}, trigger?: {...} }
patient: { consent: Record<granteeId, Category[]>, announced: string[] /* appointment ids already broadcast */, ehrSyncVersion: number }
```
Categories = the team's existing `Category` union (`appointments | medications | lab_results | conditions | care_notes | mental_health`).

### The consent engine = one `beforeTool` hook (verified in spike §C)
```ts
app.hook({ beforeTool: (ctx, call) => {
  const cat = TOOL_CATEGORY[call.name]; if (!cat) return
  const v = ctx.state.viewer; if (!v || v.role === 'patient') return
  if ((ctx.state.patient.consent ?? {})[v.id]?.includes(cat)) return
  return { id: createEventId(), type: 'tool_result', createdAt: Date.now(), invocationId: call.invocationId,
           agentName: call.agentName, callId: call.callId, name: call.name,
           error: `CONSENT_DENIED: ${v.name} has not been granted "${cat}". Offer request_access.` }  // tool never runs
}})
```
Deterministic, prompt-independent, and every denial is a `tool_result` event in the ledger (= audit trail). Port the
team's `allowedRoles` check into the same hook. Their `tools.ts` `ToolDef {name, description, input_schema, handler}`
maps 1:1 to `app.tool({ name, description, schema, execute })`.

### Flow (a) — patient updates consent via chat
1. Web: `POST /api/agent/threads { sessionId: 'thread:p001:self', scopes: { user: 'p001', patient: 'p001' } }` once.
2. Patient types "let Ayşe see my results" → `POST /api/agent/stream { sessionId, input: { state: { viewer: {id:'p001', role:'patient', …} }, message } }`.
3. Agent calls **`update_consent`** — make it a **yielding tool** (`yieldSchema: { confirmed: boolean }`): the stream ends
   with `CUSTOM runInterrupted {reason:'tool_yield', payload:{toolName, args}}` (REST: `status:'yielded_tool'`,
   `yieldedTools:[{callId,name,args}]`). UI renders a confirm card ("Share *Test results* with Ayşe?").
4. Patient taps Confirm → `POST /api/agent/stream { sessionId, input: { tools: [{ callId, input: { confirmed: true } }] } }`.
   `execute` writes `ctx.state.patient.update({ consent })` **and** PUTs the FHIR `Consent` (existing `toFhirConsent`) to the sim.
5. Because consent is `patient`-scoped, Ayşe's and the group's sessions see it on their next turn — no extra plumbing.
   The `state_change` event (old vs new consent) is the interpretability artefact to show on screen.

### Flow (b) — proactive appointment reminder to the family group
1. Trigger: Vercel Cron / `setInterval` / sim clock → `POST /api/agent/proactive { patientId }`.
2. Server: `session = sessions.get('thread:p001:family-group')`; `app.run(reminderAgent, { session, input: { state: { viewer: {id:'agent', role:'clinician'}, trigger: {...} } } })` (pattern §8.2 — no fake user message).
3. Reminder agent calls `get_upcoming_appointments` (consent-gated: the group viewer only passes categories **every** member
   holds — compute the intersection in the hook when `viewer.role === 'group'`), skips ids already in
   `patient.announced`, writes the reminder as its `assistant` message, updates `patient.announced`.
4. The web app already has an SSE snapshot broadcaster (`web/src/lib/store.ts`); have the agent service emit
   "thread updated" on `RUN_FINISHED`, or let the UI poll `GET /api/agent/sessions/thread:p001:family-group`.
5. Per-member private addenda (the Sarah/lab-results case in `proactive.ts`) = a second `app.run` on that member's own thread.

### Flow (c) — daughter asks about a test result, agent respects consent
1. Ayşe's thread `thread:p001:ayse` (scopes `{user:'ayse', patient:'p001'}`), every turn carries `state.viewer = {id:'ayse', role:'family'}`.
2. "What do mum's results mean?" → model calls `get_lab_results` → hook allows (consent from flow a) → tool returns
   `{ HbA1c 7.8 %, LDL 145 … }` → model explains in plain language (spike §B: real data flowed).
3. Mehmet asks the same → hook returns `CONSENT_DENIED…` (spike §C) → model says it can't share and offers
   `request_access` (a tool that posts a request into `thread:p001:self` for the patient to approve — another yield).
4. Show the interpretability side-by-side: the two ledgers (`GET /api/agent/sessions/:id`) differ exactly at the
   `tool_result` event. `model_start` events show what context the model actually saw.

### Testing without any key (demo insurance)
Keep `adapters: { claude: new MockAdapter({ responses }) }` behind an env flag — the whole flow above runs offline
(that is literally what the spike does). Add `runTest`-based tests for the hook logic with an `openai(...)` descriptor.

---

## 11. Gotchas and limitations

1. **zod 3 only.** `adk({schema})` and `app.tool()` throw on zod 4 schemas. `web/` uses zod 4 → agent code needs its own package (or a `zod3` alias).
2. **Claude = Vertex AI only.** No `ANTHROPIC_API_KEY` path in Core. Options in §5. `vertex` is a required field even if you shim the client.
3. **`runTest` only mocks `openai` and `gemini`** (`BaseRunner({ adapters: { openai, gemini } })`). A `claude(...)` agent under `runTest` would try to load the real Vertex adapter. Use `adk({ adapters: { claude: new MockAdapter(...) } })` + `app.run`/handlers instead (what the spike does). Also `runTest(agent)` needs `as unknown as Runnable` for a schema-typed agent (type variance wart; runtime fine).
4. **`HandlerInput` has no `scopes`.** If the REST/AG-UI handler creates the session, shared scopes are **unbound** and `ctx.state.patient.update()` writes to an ephemeral `{}` that is **silently discarded** (we hit this: run 1 of the spike showed `scopes: {}` and the consent vanished). Always `app.sessions.create({ sessionId, scopes })` first (it commits immediately); handlers then `get` and bind.
5. **Top-level `await` fails when running `.ts` inside `vendor/adk`** (`"cjs" output format`) because its `package.json` has no `"type":"module"` — the README snippet as written won't run there. Wrap in `main()` or run from an ESM consumer package.
6. **No HTTP server, no scheduler, no webhooks** — you mount handlers and call `app.run` yourself (§7, §8).
7. **`UserEvent` has no author field** — multi-human threads need speaker prefixes / per-viewer sessions (§6).
8. **Session ids get a `session_` prefix** (`normalizeSessionId`). Both create and handlers normalize, but you'll see the prefixed form in `RestResponse.sessionId`, AG-UI `threadId`, and the DB.
9. **`RestResponse.state` is session scope only**; read `patient` consent via `app.sessions.get(id).state.patient` or return it from a tool.
10. **Optional peers are yours to install** when not using `link:` — `better-sqlite3` (native build; pnpm blocks postinstall scripts unless approved — vendor lists it in `onlyBuiltDependencies`), `@anthropic-ai/vertex-sdk`, `@modelcontextprotocol/sdk`, `openai`, `@google/genai`, `ink`+`react` for `app.cli`.
11. **`pnpm run test -- <path>` filter is ignored** (vite-plus `vp test run`); the whole suite runs (7 s, so fine).
12. **`MockAdapter` responses are consumed globally in order** across all agents/sessions in the app — one misordered step shifts every later scenario. Use one adapter per scenario or `defaultResponse`.
13. **Claude adapter mutates `process.env.GOOGLE_APPLICATION_CREDENTIALS`** on first client creation.
14. **Skill docs are partly stale**: they say there is no SQLite session store — there is (`/stores/sqlite`, restored in 0.6.0, verified). Trust `src/index.ts` + `package.json` exports over prose.
15. **Pre-1.0 churn**: e.g. `RunResult.stepEvents` removed in 0.6.0 (read `run.session.events`), `FunctionTool.requiresApproval` removed, executors removed, `sqliteIndex` → `sqliteVec`. Pin `0.6.0`; read `CHANGELOG.md` on any bump.
16. `app.cli()` is an Ink TUI for local dev only (needs a TTY); the deprecated `openai/gemini/claude` re-exports on the main entry still work but load provider SDKs — use subpaths.
17. `input.state` is validated against the session schema every turn and emits a `state_change` event — fine, but don't put large blobs there; use artifacts or tools.
18. Every `history()` renderer defaults to `scope: 'direct'`: sub-agents invoked via `ctx.run` see only their own invocation unless you pass `scope: 'all' | 'ancestors'`.

---

## Files produced by this research
- `vendor/adk/` — clone at v0.6.0, installed and built (`dist/` present).
- `docs/examples/family-companion-spike.ts` — the verified end-to-end spike (tool, consent hook, patient-scope sharing over SQLite, REST + AG-UI output, proactive run, `runTest`).
- `docs/examples/package.spike.json` — the consumer `package.json` that worked.
- `docs/examples/proactive-no-message.ts` — verified "run with no user message" pattern.
