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

Production smoke check: the public deployment redirects `?as=eleanor&tab=ask` to `?as=eleanor&tab=kindred`, renders Kindred with no Ask navigation, and has no browser errors. An appointment question selected only `get_appointments`, returned 18 September at 10:15 am BST, and persisted one citation with an Eleanor-only audience.

To rerun named cases without replacing the full report, set `CONSENT_EVAL_CASES` to comma-separated case names. These results go to `consent-agent-eval-retry.json`; preserve the full report so transport failures remain visible.

Final live results: the full 14-case run recorded 10 passes, three provider JSON/transport failures and one authorised-read failure. The denial retry passed both transport-failed denial cases. The authorised-read failure exposed an optional text-filter schema problem: the model sent strings such as `all` and `null` instead of requesting an unfiltered read. The lab tool now returns permitted results without that optional filter. Both authorised controls then passed, including the chart. No canary leaks or unauthorised writes were observed in any recorded attempt. The original failed reports and successful retries are retained here; all 14 scenarios have a passing run after the fixes.

UUID migration checks passed: stable IDs across repeated requests, patient isolation, unchanged legacy history, old API aliases, five URL selection/ownership cases, and a live Neon chat turn. The development migration kept 20 existing messages; the new result reply persisted on the UUID conversation with 19 source citations.

The production UUID rollout was also checked in Chrome: all 16 existing messages remained visible, every thread ID was a UUID, the legacy Ask URL opened the correct UUID chat, and no browser errors occurred.

Chat feedback passed nine mocked-browser checks: instant outgoing bubble and typing status, double-submit prevention, no disappearing/duplicate bubble during a three-second POST-to-SSE delay, success draft preservation, failure recovery with and without an existing follow-up draft, retry, and zero browser errors. The change affects presentation only; no production requests were sent during these delayed-response tests.
