# Anima ADK: research notes for the hackathon team

Researched 12 Sep 2026 from https://adk.animahealth.com (every page, via the all-pages view),
the GitHub README (github.com/mycontinuum-com/adk) and the npm registry entry. Anything below
marked "not documented" was actually checked and is absent, not skipped.

## 1. What it is, concretely

| Fact | Value | Source |
|---|---|---|
| Language | TypeScript, Node >= 22 (ESM; docs use `.mts` + `tsx`) | README, install page, npm `engines` |
| Package | `@animahealth/adk`, latest 0.6.0 (published 1 Sep 2026), MIT, pre-1.0 | npm registry |
| Install | `npm install @animahealth/adk zod@^3.25` and `npm install -D tsx` | install page |
| Run | `export OPENAI_API_KEY=...` then `npx tsx agent.mts` | install page |
| Required peer | `zod` only. Everything else (openai, better-sqlite3, pg, playwright, livekit...) is an optional peer, installed only if you use that subpath | README, npm peerDependencies |
| What it wraps | The OpenAI Node SDK (`openai` ^5, verified: `src/providers/openai.ts` imports from `'openai'`), plus Gemini (`@google/genai`) and Claude via Vertex (`@anthropic-ai/vertex-sdk`) behind subpaths `@animahealth/adk/openai`, `/gemini`, `/claude` | README, models page, GitHub source |
| Does it wrap the sim API? | **No.** The docs contain zero references to `sim.animahacks.com`, the hackathon, patients-by-SIM-id, ordering tests, advancing a clock, GP tasks, or SMS. It is a general-purpose agent framework Anima uses internally; the sim is a separate product | grep across all.html: 0 hits for "hackathon", "animahacks" |
| Local machine | Node v24.6.0 is installed here, so it runs | checked |

Key design facts (from the README and "Why ADK" page):
- Everything an agent does is an append-only session **ledger** of events; all state derives from it.
- **Context renderers** are the only bridge between ledger and prompt; each agent chooses what it sees.
- **Yielding tools**: a tool can pause the run and wait for a human/system answer; the session persists as a row and resumes later (needs a store: in-memory or SQLite ship in core; Postgres/DynamoDB are subpaths).
- **Deterministic test kit** swaps only the model for scripted turns; your tools really execute. No API key needed.
- The OpenAI adapter accepts an ordered endpoint list (`OpenAIAdapter([{ type: 'openai', baseUrl, apiKey }])`), so any OpenAI-compatible host works if the hackathon hands out a proxy. Without endpoints it reads `AZURE_OPENAI_ENDPOINT`/`AZURE_OPENAI_API_KEY`, then `OPENAI_EU_API_KEY`, then `OPENAI_API_KEY`.
- Model names in the docs are `gpt-5.6-luna` / `gpt-5.6-terra`; the GitHub examples use `gpt-4o-mini`. Use whatever model the hackathon allowance actually gives you; the name is just a string on the descriptor.

## 2. Core abstractions

### Five runnables + one ledger (primitives page)
`Runnable` is a union of exactly five kinds; factories on the app return plain data you can nest arbitrarily.

| Kind | Factory | What it does |
|---|---|---|
| agent | `app.agent({ name, model, context, tools, output? })` | Calls the model in a loop until it stops asking for tools. The only kind that talks to a provider |
| step | `app.step({ name, execute(ctx) })` | Your TypeScript. No model. May `return someRunnable` to delegate (this is how routing is written). Signals: `ctx.skip()`, `ctx.fail(msg)`, `ctx.respond(text)`, `ctx.note()`, `ctx.output(value)` |
| sequence | `app.sequence({ name, runnables })` | In order, same session; stops early on error/yield |
| parallel | `app.parallel({ name, runnables, merge?, minSuccessful? })` | Concurrent on cloned sessions, events merged back |
| loop | `app.loop({ runnable, while, maxIterations, yields? })` | Repeat while predicate holds |

Plus wrappers `gated(runnable, check)` and `cached(runnable, { key, scope, ttlMs })`.

### Tools (tools page)
`app.tool({ name, description, schema: z.object(...), execute(ctx) })`. `ctx.args` is Zod-validated (coerced first, then parsed; invalid args become a `tool_result` error the model sees and can correct, the run does not throw). `ctx.state` is typed from the app's `schema`. Optional: `prepare`, `finalize`, timeouts, retries, `yieldSchema` (a tool with `yieldSchema` pauses the run and waits for typed input). Tools can also be provider tools (`{ type: 'web_search' }`) or MCP servers (`app.mcp.server({ name, url | command, ... })`).

### Sessions and typed state
`adk({ schema: { session: { slot: z.string().default(''), status: z.enum([...]) } } })`. Tools write `ctx.state.slot = ...`; renderers and later agents read the same fields. Every write is a `state_change` event in the ledger. Passing values between children of a sequence goes through `ctx.state`, not return values (a sequence never copies a child's `ctx.output` into its own result; `output.text` is just the last assistant event in the session).

### Context
`context: [app.context.system(string | ({ state }) => string), app.context.history({ scope: 'invocation' | ... })]`. Context is rebuilt before every model call. `scope: 'invocation'` gives a sub-agent only its own conversation while it still shares typed state.

### Orchestrator / sub-agent handoffs (multi-agent page)
Two moments to hand off:
1. **Before the run** (composition as data): sequence / parallel / loop.
2. **During the run**, from any step or tool `execute` (both contexts extend `OrchestrationContext`):
   - `await ctx.run(agent, msg)` waits, returns `SubRunResult` (rejects if the child yields)
   - `ctx.spawn(agent, msg)` returns a `SpawnHandle` with `wait()` / `abort()`
   - `ctx.dispatch(agent, msg)` fire-and-forget (run still waits for it to finish before resolving)
   - `return someAgent` from a tool/step = **transfer** (caller ends, target replaces it)
   Every child invocation is stamped with `parentInvocationId` and `handoffOrigin`, so the call tree can be rebuilt from ledger rows.

`examples/dynamicFlow.ts` in the repo is the canonical "coordinator agent with four sub-agents exposed as tools" example; `examples/staticFlow.ts` is the declarative version (parallel research, planning sequence, revision loop, yield for sign-off).

### Structured output
`app.agent({ ..., output: { schema: ZodSchema, key?: 'stateKey', mode?: 'native' | 'prompt' } })`. Result carries `output.value` (parsed, validated) alongside `output.text`. A forgiving parser repairs fenced/prefaced/single-quoted/trailing-comma JSON and coerces types. With `key`, the object is also written into session state for the next agent.

### Deterministic tests (`@animahealth/adk/testing`)
`runTest(runnable, [user('...'), model('...'), model({ toolCalls: [{ name, args }] })], { initialState? })`. The script owns the model's judgement; your tools, state writes, context rendering and yields run for real. Helpers: `getLastAssistantText`, `getToolCalls`, `getToolResults`, `findEventsByType`. Vitest matchers (`toHaveToolCall`, `toHaveState`, `toHaveEventSequence`, `toHaveStatus`, ...) via `await setupAdkMatchers()`. `MockAdapter` with `setResponses` / `addResponses('agent:<name>', [...])` for multi-agent scripts. `mockAgent(name)` for placeholder agents. Runs with no key, no network.

### Evals (`app.evaluate`, `app.simulate`, `@animahealth/adk/eval`)
- A **case**: `{ name, runnable, input, toolMocks, metrics, retries?, timeout? }`. `toolMocks` is strict per tool name: `{ execute(args, ctx) }` or the real tool for passthrough; an unmocked called tool records an error.
- A **metric**: `app.evaluate.metric({ name, evaluate(run) => { passed, score?, evidence?, data? } })` reading `run.session.events` / `run.session.state`. Built-ins in `/eval`: `eventCountMetric`, `eventSequenceMetric`, `stateMetric`, `timingMetric`, `codingDeltaMetric`.
- A **suite**: `app.evaluate(cases, { metrics (apply to all), concurrency, repeat, stopOnFirstFailure, onCase, hooks })` returns `{ summary: { total, passed, failed, errors, terminated, aborted, timedOut }, results[] }`. A case with no metrics passes vacuously ("a green suite without metrics is not evidence").
- **Report**: `app.evaluate.report({ title })(suiteResult)` returns markdown (pass rate, per-metric rates, failures with evidence, tokens/cost when live).
- **Simulate**: `app.simulate(agent, { input, userAgent, toolAgents, maxTurns, maxDuration, stateMatches })` runs a simulated user against a `yields: true` agent.
- `evaluate` never throws on failure; gate CI yourself on `summary.failed + errors + timedOut`.

### Mapping to the on-stage pattern
"Intent + acceptance criteria -> Orchestrator -> Agents A/B/C -> Deterministic tests + evals -> Ready to demo". This exact phrase/diagram is **not** on the ADK site (0 hits for "acceptance criteria" as a pattern; the site never mentions the hackathon). The ADK pieces that map onto it, from the docs:

| Stage | ADK surface |
|---|---|
| Intent + acceptance criteria | App `schema` (typed state) + `output: { schema }` on agents + eval `metrics` written before the build |
| Orchestrator | A `step` router (`return agentX`) or a coordinator `agent` whose tools call `ctx.run(...)`; or a declarative `sequence`/`parallel` |
| Agents A/B/C | `app.agent` each with `context.history({ scope: 'invocation' })` so they share state but not transcripts |
| Deterministic tests | `runTest` with scripted `model(...)` turns; tools/state real; vitest matchers |
| Evals | `app.evaluate(cases, { metrics })` against the live model, `toolMocks` for side-effecting tools, `report()` for the markdown |

## 3. Minimal working examples (verbatim from the docs)

### Install and setup page (live, one agent)
```bash
mkdir my-agent
cd my-agent
npm init -y
npm install @animahealth/adk zod@^3.25
npm install -D tsx
```
`agent.mts`:
```typescript
import { adk } from '@animahealth/adk'
import { openai } from '@animahealth/adk/openai'

const app = adk()

const assistant = app.agent({
	name: 'assistant',
	model: openai('gpt-5.6-luna'),
	context: [
		app.context.system('Answer concisely.'),
		app.context.history(),
	],
})

const run = await app.run(assistant, 'Suggest a name for a booking assistant.')
console.log(run.output.text)
```
```bash
export OPENAI_API_KEY="your-api-key"
npx tsx agent.mts
```

### README quick start (agent + tool)
```typescript
import { z } from 'zod'
import { adk } from '@animahealth/adk'
import { openai } from '@animahealth/adk/openai'

const app = adk()

const calculator = app.tool({
  name: 'calculate',
  description: 'Evaluate a mathematical expression',
  schema: z.object({
    expression: z.string().describe('Math expression to evaluate'),
  }),
  execute: (ctx) => {
    const sanitized = ctx.args.expression.replace(/[^\d\s+\-*/().eE%]/g, '')
    const result = Function(`"use strict"; return (${sanitized})`)()
    return { result }
  },
})

const assistant = app.agent({
  name: 'math_assistant',
  model: openai('gpt-5.6-luna'),
  context: [
    app.context.system(`You are helpful, use the calculator tool for arithmetic.`),
    app.context.history(),
  ],
  tools: [calculator],
})

const result = await app.run(assistant, 'What is 134 divided by 4?')
console.log(result.output.text) // 134 divided by 4 is 33.5.
```

### README first run, no API key (deterministic test)
```typescript
import { getLastAssistantText, runTest, user, model, mockAgent } from '@animahealth/adk/testing'

const greeter = mockAgent('greeter')
const result = await runTest(greeter, [user('hi'), model('Hello! Ask me anything.')])

console.log(getLastAssistantText(result.events)) // Hello! Ask me anything.
console.log(result.events.map((e) => e.type))
// [ 'user', 'invocation_start', 'model_start', 'assistant', ... ]
```

### Vitest test in your repo (testing page, "In your repo")
```typescript
import { describe, expect, it } from 'vitest'
import { getToolResults, model, runTest, user } from '@animahealth/adk/testing'
import { concierge } from './concierge'

describe('concierge', () => {
  it('quotes from the tool, not from the model', async () => {
    const outcome = await runTest(concierge, [
      user('Two nights for three of us?'),
      model({ toolCalls: [{ name: 'quote_nights', args: { nights: 2, guests: 3 } }] }),
      model('That comes to 240.'),
    ])
    expect(outcome.status).toBe('completed')
    expect(getToolResults(outcome.events)).toEqual([
      { name: 'quote_nights', result: { total: 240 } },
    ])
  })
})
```

### Eval suite runner (evals page, "In your repo")
```typescript
import process from 'node:process'
import { app } from './app'
import { refundCases } from './cases'
import { checkedFirst } from './metrics'

const result = await app.evaluate(refundCases, {
  metrics: [checkedFirst],
  repeat: 5,
  onCase: (caseResult, done, total) =>
    process.stdout.write(`\r${done}/${total} ${caseResult.name}`),
})
process.stdout.write(`\n${app.evaluate.report({ title: 'Refund suite' })(result)}\n`)
// The gate is yours: `evaluate` reports, it does not exit. A CI suite that never fails the
// build is a dashboard, not a gate.
const bad = result.summary.failed + result.summary.errors + result.summary.timedOut
process.exit(bad > 0 ? 1 : 0)
```

### Orchestrator with three sub-agents (multi-agent page, scripted)
```typescript
import { isInvocationStartEvent } from '@animahealth/adk'
const grader = mockAgent('grader')
const summariser = mockAgent('summariser')
const auditor = mockAgent('auditor')

const triage = app.step({
  name: 'triage',
  execute: async (ctx) => {
    const graded = await ctx.run(grader, 'Grade this ticket.') // wait here
    const pending = ctx.spawn(summariser, 'Summarise the thread.') // wait later
    const sent = ctx.dispatch(auditor, 'Write the audit line.') // never wait
    const summary = await pending.wait()
    ctx.output({
      ranInline: graded.output.text,
      spawned: `${pending.agentName} · ${summary.status}`,
      dispatched: sent.agentName,
    })
  },
})
```

## 4. Built-in sim tools?

**No.** Not documented anywhere. The ADK ships:
- `/web` tools: search, fetch, screenshot (needs playwright/readability peers)
- MCP client (`app.mcp.server({ url | command })`), so if the sim exposes an MCP endpoint you could attach it, but the sim docs, not the ADK docs, would say so (unverified; nothing on the ADK site mentions it)
- provider tools like `{ type: 'web_search' }`

Patient lookup, order test, advance clock, create task, send message: none exist in the ADK. You would write each as an `app.tool` whose `execute` calls `sim.animahacks.com` with `fetch`. That is roughly the same code as the tool functions you'd write for the plain OpenAI SDK; the ADK adds Zod validation, typed state writes, and ledger events around them.

## 5. Is it worth it for a 6-hour build?

Honest trade-off, given what CONTEXT.md says the product is (Anima loop: order LFT -> advance clock -> detect result -> gate -> create task; persona explanations; escalation rule; population scan):

**Costs**
- Zero prior team experience with it (assumed; nobody has used it before today). Pre-1.0, released to GitHub on 1 Sep 2026, 0 stars, API docs dense. Any surprise costs real minutes.
- No sim integration: every sim call is still your own `fetch` code.
- TypeScript/Node only. If the team's fastest language is Python, that alone decides it.
- The "sequence never returns a child's value, use ctx.state" and "concurrent agents share `output.text`" gotchas are documented but easy to trip on.

**Benefits**
- The pattern the organisers pitched on stage (orchestrator -> agents -> deterministic tests + evals) is literally the ADK's structure, and judges are Anima people. Showing an `app.evaluate` report and a `runTest` suite in the demo is cheap credibility on "quality of working product".
- Deterministic tests without a key: the whole CareCircle gate logic (disclosure unconfirmed -> hold family release -> escalate after N days) can be tested with scripted model turns and real tool/state code.
- Yielding tools map exactly onto "clinician confirms result discussed with patient" (a `yieldSchema: { confirmed: boolean }` tool that pauses the run until the clinician answers). That is a real feature we'd otherwise hand-roll.
- Typed session state (`patient_disclosure_status`, `consent` per relative) is a first-class thing, not a global.
- Everything is in one ledger, which is a good audit-trail story for a safety product.

**Recommendation: use the ADK, but with a strict blast-radius rule.**
- Hour 0-0.5: one person installs it and gets the README quick start + a `runTest` passing locally (Node 24 is already here). If that is not green in 30 minutes, drop it and use plain `openai` SDK + `fetch`; the tool functions are reusable either way, so write sim tools as plain async functions `(args) => ...` first and wrap them in `app.tool` second.
- Use only: `adk({ schema })`, `app.tool`, `app.agent`, `app.step` (router/gate), `app.sequence`, `app.run`, one yielding tool, `runTest` for tests, `app.evaluate` + `report` for evals. Do not touch stores (in-memory is fine for a demo), serving, voice, MCP, memory, or the experimental `/workflow` subpath.
- Keep the orchestrator as a `step` that routes in code, not a model that picks sub-agents. Cheaper, deterministic, and it is what the docs recommend ("Deterministic work belongs in a step, where it costs no tokens and cannot hallucinate").
- Wire the persona explanation agents (Janice / Sarah / John / Tom) as agents with `output: { schema }` so the UI gets typed objects, and add one metric per persona that asserts restricted fields are absent from Tom's/John's output. That is the "acceptance criteria before the build" gate the organisers asked for, and it is about 20 lines.

If the team's default language is Python, ignore all of the above and call the sim REST API + OpenAI SDK directly; do not port to TypeScript for the framework's sake.

## Unverifiable / not documented
- The on-stage diagram wording ("Intent + acceptance criteria -> ...") does not appear on the site.
- Any relation between the ADK and the sim (auth, MCP endpoint, tool bundles): not documented on the ADK site.
- Model names `gpt-5.6-luna`/`gpt-5.6-terra` are what the docs use; whether the hackathon allowance covers them is a Discord question.
- I did not install and run the package; claims about behaviour come from the docs and README, not execution. The one source check done: `src/providers/openai.ts` imports the `openai` npm package.
