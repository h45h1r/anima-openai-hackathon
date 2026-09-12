# CareCircle demo plan (proposal, 12 Sep 2026)

Judging: NHS relevance and impact / quality of working product / originality, 1-10 each, equal weight.
Research says: problem first (~30% of the pitch), one working "oh, that is possible now" moment inside 90 seconds, flawless over ambitious, real state change beats animation.

## The one moment
A real result lands in Anima -> the gate HOLDS until the patient has been told -> clinician confirms -> the same result fans out as three different truthful versions to Sarah, John and Tom, under Eleanor's consent -> a follow-up task appears in Anima's own activity trail.

## Patient: use Eleanor Chen (SIM-000006), not fictional Janice
Real record, real gaps: neutrophils low on four consecutive panels with no review and no message; admitted to AMU this morning; GP appointment at 08:30 she will miss; husband cannot drive; care package unfunded; landline only, no app. She IS the human middleware and she is not even on the App.

## Arc (3 minutes)
1. Problem (35s). Eleanor's record on screen. "Four abnormal panels. The only text she ever got was about paperwork. She is in hospital right now and nobody in her family knows what any of it means."
2. Consent (35s). Eleanor sets her circle once: Sarah = results + follow-up; John = appointments, transport, warning signs; Tom = family updates only. Show one view flipping between lenses (this is where the twin earns its place: same body, markers lock and unlock per person).
3. Event (60s). Order LFT in Anima. Advance the clock 121 min. Result arrives. Gate: "held, Eleanor not yet told". Clinician taps "discussed with patient" (labelled simulated). Fan-out: Sarah's chat gets the explanation and can ask a follow-up; the family WhatsApp mock gets John's transport task for the follow-up appointment; Tom gets "no action needed this week". Anima activity trail shows the create_task.
4. Safety net (30s). "If nobody confirms within 3 days the agent escalates to a GP task and phones Eleanor on her landline." Neighbourhood number from the materialised cohort.
5. Close (15s). "No result ever sits uncommunicated. When it is, every trusted person gets the right version. Power in patients' hands, chapter 3, and the consent is synced to the record so the practice never asks twice."

## Surfaces (one web app, three panes)
- Family chat in a phone frame (primary, judges read messages fastest). Sarah's thread + family group.
- Eleanor's consent panel (three toggles per person, plus "talk to the agent" to change it by voice/text).
- Evidence pane: Anima activity trail + gate state. Proof the world changed.
- Optional: the twin as the lens switcher in step 2. Do NOT lead with it.

## Do not
- Do not copy Anima's UI. The judges are Anima staff; a clone scores zero on originality and costs hours. Write INTO their world (tasks, messages) and show their trail instead.
- Do not build four full persona apps. Two live (Eleanor, Sarah), two as message bubbles.
- Do not mock the core: the LFT order, clock advance, result detection and task creation must be real Anima calls.

## Build split (orchestrator pattern, gate defined before the build)
- Agent A: sim adapter (TS, plain async fns, UUID idempotency, retry on 502), gate state machine, escalation rule, cohort materialiser + count.
- Agent B: ADK agent with tools: get_consent / set_consent / explain_for(person) / notify(person) / create_followup; evals: "Tom output contains no clinical values", "no family message before disclosure=confirmed", "Sarah answer cites the real analyte and range".
- Agent C: web UI (chat frame, consent panel, evidence pane, lens toggle on the twin).
- Deterministic tests: replay a canned Anima result through the gate for all three people. Backup video recorded once the loop works.
