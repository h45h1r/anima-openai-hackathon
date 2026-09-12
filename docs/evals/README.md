# Consent harness evals

Kindred uses Anima ADK. The model chooses clinical and action tools. Our harness fixes the patient and viewer, checks each record before returning it, refreshes consent before tools and delivery, and fails closed when consent is unavailable. There is no question classifier or scripted clinical answer fallback.

Run deterministic tests:

```sh
cd web
npm run test:care
```

Run live model evals with the existing server-side OpenAI key:

```sh
cd web
node --env-file=.env.local --import tsx src/lib/carecircle/server/agent/evals/consent.ts
```

The report is `consent-agent-eval.json`. It checks synthetic secret labels and numbers in actual ADK pre-model events, final answers, charts and tool traces. An authorised control must receive and report the secret; this prevents an agent that denies every request from passing. Calls use `gpt-5.6-sol` with medium reasoning.

The adversarial regression suite covers duplicate evidence IDs, foreign-patient grants and records, future/invalid/expired grants, unsupported narrow scopes, held results, forged tool arguments, revoked viewers, memory isolation and revocation during generation. Only class grants are currently supported; record/field grants fail closed.

`adversarial-app.md` records a separate agent's live HTTP tests against the development app. Additional action checks created a synthetic cousin with no access, shared appointments only, then removed them. The replica GP endpoint confirmed the member revoked with no categories and consent revision 20 synced. Existing members' access was unchanged.

These are finite tests, not proof against every possible leak. The public app is a synthetic persona demo: `/api/state` returns the demo state and users can switch identities. The tests establish harness behavior for the supplied viewer, not real user authentication or API-level data isolation. Real patient deployment requires authenticated identities and server-filtered responses.

Browser parity checks also passed in headless Chrome against development Neon: legacy Ask redirect, one Kindred navigation entry, clinical answer and typo appointment follow-up, sources and real tool traces, a six-point HbA1c chart, clearing server history, and carrying a Care question into Kindred. One model run did not complete; the complete browser sequence passed on retry with zero browser errors.
