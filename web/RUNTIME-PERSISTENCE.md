# Serverless runtime state

When `DATABASE_URL` is set, Kindred stores messages, runtime audit, consent requests, level definitions, next actions and appointment announcement IDs in PostgreSQL. Every mutation restores the latest patient snapshot and holds a row lock until the request finishes. Successful responses commit; thrown errors and unsuccessful HTTP responses roll back runtime changes. AsyncLocalStorage keeps each request's mutable state separate.

Without `DATABASE_URL`, the existing local process store and live broadcasts remain unchanged.

Environment:

- `DATABASE_URL`: Neon PostgreSQL connection URL, preferably the pooled URL. Server-only secret.
- `KINDRED_RUNTIME_NAMESPACE`: optional stable deployment/world name, default `kindred-v1`. Keep it unchanged across deployments to retain history. Use a different namespace for unrelated simulator worlds sharing a database.
- `SIM_PATIENT_ID`: existing patient setting, default `SIM-000006`; included in the storage key.
- Existing simulator and companion environment settings continue to supply clinical records and canonical consent. Runtime storage never stores or overrides canonical consent.

`runtime-schema.sql` defines `public.kindred_runtime_state`. The application creates it automatically. A transaction advisory lock serializes first-time schema creation across cold starts. The database role therefore needs permission to create the table on first use, and read/write access afterward.

GET state and deployed SSE connections read committed snapshots. SSE refreshes every 2.5 seconds, stops after 55 seconds and lets EventSource reconnect. Clinical source data is cached for at most 15 seconds within each instance; consent is refreshed separately. Mutations in progress are visible after commit, so deployed SSE does not stream unfinished agent replies. Busy-thread state is transient and is not restored after crashes.

Canonical consent mutations and runtime commits use separate services, so they are not one distributed transaction. Canonical consent remains authoritative if a later runtime operation fails. Long agent requests hold a database connection and patient row lock; conflicting writes can wait up to 110 seconds. Route duration limits still apply.

Development validation (never point this at production):

```sh
KINDRED_RUNTIME_TEST_DATABASE=development node --env-file=sim-app/.env.neon.development --test web/src/lib/runtime-store.test.mjs
```

Tests use unique namespaces and remove only their own rows. They check independent connections/cold-start recovery, concurrent writes, committed reads, patient isolation, transaction rollback, and preservation of canonical state during snapshot restoration.


## Shared clinical agent

Ask uses `public.kindred_care_state` with one JSON snapshot per session. It persists session metadata, short chat history, memories and completed runs. Requests for one session are serialized; different sessions can run concurrently. Streaming forwards progress immediately and sends the final response after the database commit. `npm run test:care` checks record filtering, tool selection, revocation, memory isolation and charts; with the development database environment it also checks persistence, concurrency, session isolation and rollback.

The Anima ADK agent used by Kindred refreshes canonical Circle members and category grants from the consent service before using clinical data. Consent edits go through that service, including its member version check and GP record sync. Kindred's selected patient is kept in an HTTP-only browser cookie; runtime storage remains separated by patient.

Kindred keeps answer citations and charts on its persisted message. Agent replies carry the requesting viewer as their audience. Clearing a direct conversation removes its chat history from the server snapshot; audit records and communication preferences remain. The model sees only fixed communication preferences from memory, and old assistant text is excluded for family viewers so revoked records cannot re-enter through chat history.

## Chat identifiers

Chats use UUIDv5 identifiers derived from the patient ID and legacy conversation name. This gives each existing chat a stable UUID across cold starts without creating duplicate conversations. Legacy thread names in saved messages are mapped on load and persisted on the next successful write. Chat URLs use `?tab=kindred&chat=<uuid>`. The chat API accepts `chatId`; legacy `threadId` callers remain supported. UUIDs identify conversations and do not replace viewer membership checks or authentication.
