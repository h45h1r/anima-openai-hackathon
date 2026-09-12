# ADK integration research

Verified on 12 September 2026 against repository commit `138eb40d1280acb09750981fc7c1b0c1e381daf7` and published npm package `@animahealth/adk@0.6.0`.

ADK fits the agent runtime. It does not provide an EHR connection, patient consent rules, application authentication, or notification delivery. We build those around it.

## How it fits the GP interface

The copied GP interface can show the existing patient workflow with a consent panel, sharing controls, and explanations added to it. Enforcement belongs in our backend: hiding a field or disabling a button in the interface does not prevent access.

```text
GP / patient / family interface
              |
Authenticated application API
              |
Consent checks + filtered simulator adapter ---- Simulator API
              |
ADK tools and agents
              |
Permitted summaries / proposed next actions
              |
Consent recheck + notification outbox
```

Both normal interface requests and agent tools must use the same consent service. The backend derives identity from authentication, checks access to the requested patient, filters permitted fields, and records the decision. The model receives only the data needed for its task.

This demonstrates consent enforcement through our application. It does **not** prove that the original simulator or another client enforces our rules. Synchronizing consent into an EHR requires a supported upstream write operation and verified upstream enforcement; a consent note alone is not an access control rule.

## Verified capabilities

| Need | ADK provides | Application responsibility |
| --- | --- | --- |
| Agent runtime | TypeScript agents, structured output, deterministic steps, sequences and parallel execution | Healthcare workflow and prompts |
| Tools | Zod input schemas and async execution | Narrow simulator API wrappers and access checks |
| Consent interaction | Yield a tool, persist the session, resume with external input | Patient identity, consent UI and consent rules |
| Audit | Events for tool calls, inputs, results, state changes and model boundaries | Clear access explanations linked to source records |
| Persistence | In-memory, SQLite, PostgreSQL and DynamoDB session stores | Database setup and recipient access rules |
| API integration | Server-independent turn, REST and AG-UI handlers | HTTP hosting, authentication and session ownership checks |
| MCP integration | Connect to existing servers over stdio, HTTP or SSE | Publish our own MCP server if needed |
| Proactivity | Invoke agent runs programmatically | Scheduler/webhooks, retries and duplicate prevention |

Sources: [package and dependencies](https://github.com/mycontinuum-com/adk/blob/138eb40d1280acb09750981fc7c1b0c1e381daf7/package.json), [tools and orchestration](https://github.com/mycontinuum-com/adk/blob/138eb40d1280acb09750981fc7c1b0c1e381daf7/skills/adk/references/runnables.md), [handlers and MCP](https://github.com/mycontinuum-com/adk/blob/138eb40d1280acb09750981fc7c1b0c1e381daf7/skills/adk/references/handlers-voice-mcp.md).

## Setup recommendation

Requires Node.js 22 or newer. Pin ADK because it is pre-1.0.

```sh
npm install @animahealth/adk@0.6.0 zod@3 openai@5
# Local durable sessions:
npm install better-sqlite3
# Only when connecting to MCP:
npm install @modelcontextprotocol/sdk
```

Use `adk` from `@animahealth/adk`, `openai` from `@animahealth/adk/openai`, and `sqliteStore` from `@animahealth/adk/stores/sqlite`. PostgreSQL is also available for a shared deployment. Configure the model API key on the server.

Start with ordinary ADK tools calling our service layer. REST can expose that same layer to the GP interface. Add MCP when another agent needs access; it is not required for the initial demo.

## Proposed application tools

These are tools we would build, not existing ADK healthcare tools. Simulator operations must be checked separately before implementation.

- `get_permitted_care_timeline`: return only records allowed for the authenticated actor and purpose.
- `get_upcoming_appointments`: provide appointment details at the recipient's allowed detail level.
- `request_sharing_consent`: yield for a patient decision, then resume through an authenticated backend endpoint.
- `explain_access_decision`: explain the matched consent rule, recipient, purpose, permitted fields and expiry.
- `prepare_family_update`: draft a plain-language update from permitted facts, with source IDs.
- `send_family_update`: recheck current consent and enqueue delivery with a duplicate-prevention key.

Keep policy decisions in deterministic TypeScript functions or ADK steps. Use agents for interpreting permitted information and drafting explanations. Record the decision, patient, actor, recipient, purpose, source IDs, consent version and timestamp, linked to the ADK session.

## Limits that affect implementation

- **Client input is not authorization.** ADK handlers accept session IDs, state, initial state and tool-resume input. Our HTTP layer must restrict these and check session ownership. Never accept a browser-supplied `approved: true` without verifying the actor and pending request. [Input processing](https://github.com/mycontinuum-com/adk/blob/138eb40d1280acb09750981fc7c1b0c1e381daf7/src/handler/conflict.ts).
- **MCP support is a client connector.** Despite its name, `app.mcp.server()` connects to another server. Publishing our tools needs a separate MCP SDK server. [Implementation](https://github.com/mycontinuum-com/adk/blob/138eb40d1280acb09750981fc7c1b0c1e381daf7/src/mcp/server.ts).
- **Scheduling internals are not public API.** Gateway/process-store code exists, but the main export explicitly marks it internal. Use an application scheduler or webhook calling public handlers. [Export boundary](https://github.com/mycontinuum-com/adk/blob/138eb40d1280acb09750981fc7c1b0c1e381daf7/src/index.ts).
- **Trace data needs its own access controls.** Events can contain inputs and tool results. Present a filtered explanation to family members, not the raw session ledger.
- **Prompted approval is insufficient.** The example approval flow demonstrates yielding, but our write tools must check consent in code. [Example](https://github.com/mycontinuum-com/adk/blob/138eb40d1280acb09750981fc7c1b0c1e381daf7/examples/yieldResume.ts).
- **External writes are separate from session commits.** EHR writes and notifications need idempotency and failure handling. A committed agent session alone does not guarantee exactly-once delivery. [Turn lifecycle](https://github.com/mycontinuum-com/adk/blob/138eb40d1280acb09750981fc7c1b0c1e381daf7/src/handler/turn.ts).
- **Some bundled documentation is stale.** Its session reference says SQLite is unavailable, but the package exports it and the import works. Prefer actual exports and source for the pinned version. [SQLite implementation](https://github.com/mycontinuum-com/adk/blob/138eb40d1280acb09750981fc7c1b0c1e381daf7/src/session/sqlite.ts).

## Validation completed

Installed published version `0.6.0` outside this repository and ran a deterministic test with no model API key. A real typed consent tool yielded, resumed with approval, executed once, updated session state and produced `tool_yield`, `tool_input`, `invocation_resume`, `state_change` and `tool_result` events. The SQLite export imported successfully; database persistence was not tested.

This verifies ADK's tool and resume mechanism. It does not validate a complete consent service, simulator integration, real model output or message delivery.
