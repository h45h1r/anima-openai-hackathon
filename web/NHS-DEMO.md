# Separate NHS App demo

Run `npm run dev` from `web/`, then open <http://localhost:3000/nhs-demo>.

This route has its own UI, API, fictional records, family, consent store and conversations. It makes no requests to the Anima simulator, NHS services, or model providers. The existing `/` app is independent.

## Three-minute walkthrough

1. Select **Continue as Eleanor**. Open **Family care**, then turn on **Sarah: test results**. The GP consent mirror updates immediately. Alternatively, open **Kindred** and select **Let Sarah see my test results**.
2. Click **Advance to reminder day**. Select **Sarah Chen · Daughter** in the demo profile selector. Open the notification, then **Open message**. A read receipt appears in Activity.
3. Select **Talk to Kindred**, then **Explain Mum’s test result**. Expand **Why this response?** to inspect the source and consent version.
4. Select **Tom Chen · Son** and ask the same question. His request is denied before results are retrieved.
5. Switch to Eleanor and turn off Sarah’s test-result permission. Return to Sarah. Her result and previous result-related conversation are withheld, and another request is denied.
6. Select **Dr Patel · GP** to inspect the local consent mirror, or **Restart this demo** to repeat.

Turning off a relative’s appointment permission before advancing the clock also suppresses that relative’s reminder. Repeating the reminder action does not duplicate messages.

## What is simulated

- NHS App screens and login: explicit demo persona selection, not identity verification.
- Proxy permissions and GP sync: local state and local acknowledgement, not a claim of NHS API conformance or national EHR enforcement.
- NHS messages and receipts: local inbox and read events. No external messages are sent.
- Medical records: one fictional appointment and laboratory report, independent of the captured Anima records.
- Assistant: deterministic text with supported prompts and a fallback for unsupported requests. No model key is needed.
- Clock: a button advances the scenario from 12 to 16 September 2026; it does not schedule a background job.

Actual backend logic checks sharing permissions before returning a result, answering a result question, delivering a reminder, or returning conversation history. Family views do not receive the full record or other family members’ chats and permissions. The profile selector intentionally allows role-playing; it is not production authentication.

State is held in the Next.js server process, keyed by an HttpOnly demo cookie. Separate browser contexts get separate runs. Tabs in one browser share the demo session, including its selected profile; refresh to see changes made in another tab. State expires after eight hours of inactivity or a server restart. This demo is intended for a single local Next.js process.

## Files and checks

- `src/app/nhs-demo/`: isolated page, client UI and scoped CSS.
- `src/app/api/nhs-demo/route.ts`: validated actions and per-session state.
- `src/lib/nhs-demo/model.ts`: fixtures, permission checks, scripted replies and filtered snapshots.
- `src/lib/nhs-demo/model.test.mjs`: consent, revocation, notifications and isolation checks.

With a Node version supporting TypeScript type stripping (Node 22.18+):

```sh
node --test src/lib/nhs-demo/model.test.mjs
npx eslint src/app/nhs-demo src/app/api/nhs-demo src/lib/nhs-demo
npx tsc --noEmit
```
