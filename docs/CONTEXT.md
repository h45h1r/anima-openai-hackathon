# CareCircle: hackathon context brief

Event: OpenAI x Anima Healthcare Hackathon, London, 12 Sep 2026. ~6 hours of build time.
Challenge: "Build a working product that advances the NHS 10-Year Health Plan. Choose the problem. Show the product working."

## Judging (each 1-10, equal weighting)
1. NHS relevance and impact: a clear plan priority and a meaningful patient or system outcome.
2. Quality of the working product: how well it works, how coherent it is.
3. Originality: a fresh approach in the technology, product, clinical or operational model.

Anima flagged chapters 2, 3, 4, 6, 8 of the plan as "strong fit". CareCircle sits in ch 3 (analogue to digital, power in your hands) and ch 6 (transparency of quality/safety), with a ch 2 angle (community, carers).

## Tools offered (strongly encouraged, not compulsory)
- Simulated NHS neighbourhood: sim.animahacks.com (synthetic patients, EHR/PMS, ~50k population)
- Anima ADK: adk.animahealth.com
- OpenAI / Codex allowance (see Discord)
- Suggested build method: orchestrator-subagent pattern. Intent + acceptance criteria -> orchestrator -> agents A/B/C -> deterministic tests + evals -> ready to demo. "Clean boundaries. A gate defined before the build."

## The problem (clinician-validated on the team)
- Patients are the human middleware between clinicians and family.
- GP practice on the team reports 10-15 "I don't understand this result" queries a day, each ~10-15 min (notes, work out plan, call back). ~200 min/day/practice. Extrapolated (flag as such): 6,000+ practices -> over a million clinician-minutes a day.
- Relatives have question anxiety and fragmented access; clinicians cannot disclose without explicit consent; family coordination is manual.
- Results are already visible in the NHS App, but nhs.uk still says "contact your GP if you don't understand a result". Visibility is solved; understanding, safe sharing and follow-up are not.
- Proxy access exists in the NHS App (practice-led setup, whole-record access levels). It gives access to a record; it does not do ongoing, role-specific communication.

## The product: CareCircle
"Your health. Your people. Your permissions."
One line: CareCircle converts each clinical event into the right explanation and next action for every trusted person, under the patient's control, and makes sure no result is ever left uncommunicated.

Two halves:
A. Safety net (the "who doesn't die" answer): a result arrives -> patient_disclosure_status = unconfirmed -> family release HELD. If abnormal and still unconfirmed after N sim days, escalate: create GP task in Anima, contact patient, only then tell family "there is something to discuss with Janice". HSIB precedent: unexpected radiology finding never communicated, patient died. Callen 2012 systematic review: 20-62% of results not followed up (verify exact wording in docs/evidence-check.md).
   Population number for the opening: run the rule across the 50k sim population: "X abnormal results in this neighbourhood have no evidence anyone told the patient."
B. Consent-aware family communication: once disclosure is confirmed, the same result becomes four experiences:
   - Janice (patient, 63, London, liver story via LFT trend): plain-language explanation, what changed, what next.
   - Sarah (daughter): permitted clinical explanation + follow-up responsibility.
   - John (husband): logistics, appointments, warning signs, no restricted detail.
   - Tom (son): no clinical result, only whether family help is needed.
   - Family group (simulated WhatsApp, labelled): reminders only after the gate opens.
   Follow-up Q&A answered within the same permission boundary.

## Anima sim: what is real vs what we build vs what we visibly simulate
REAL (Anima): patient lookup by SIM- id, read GP/hospital records, historical LFT trends, order LFT (result ~120 sim minutes later), advance clock, detect new result, appointments, create GP task, discharge docs, patient SMS/email, audit/activity trail, versioning.
BUILD (CareCircle): family profiles, standing consent, topic/channel permissions, patient-informed state, escalation rule, persona explanations (OpenAI), share log, population scan.
VISIBLY SIMULATED (labelled in UI): WhatsApp delivery, relative identity verification, clinician "result discussed with patient" confirmation, clinician approval of AI text, any oncology context. Anima's "mark result reviewed" is GP review, NOT proof the patient was told.

## Scope for the remaining hours
1. Anima loop: order LFT -> advance clock 121 min -> detect result -> gate -> create task. Real end to end.
2. Two live views: Janice and Sarah. John and Tom as static mockups.
3. Escalation rule + population count across 50k.
4. Simulated WhatsApp, labelled.
Cut: chemotherapy (sim only guarantees FBC, U&E, HbA1c, LFT, CRP, lipids). LFT trend on a liver story is enough.

## Demo script skeleton (2-3 min)
Problem first (~30%): Janice as human middleware + the HSIB story + the 200 min/day number.
Show working within 90s: order LFT in Anima, jump clock, result lands, gate holds, clinician confirms, four views fan out, task appears in Anima's activity trail.
Population number. Close: "No result ever sits uncommunicated. When it is, every trusted person gets the right version."

## Hackathon playbook reminders (from research)
- Simple and flawless beats ambitious and half-working. Lock scope early, mock everything non-core, never mock the core.
- Skeleton by hour ~1.5. Lock code ~1 hour before submit. Rehearse demo 5x, backup video.
- Pitch the problem harder than the solution. Judges decide in the first 30-90 seconds.
- Domain expertise wins AI hackathons; our clinician's real number is the asset.

## Update 12 Sep, ~16:00: the foundation is now "Kindred" (origin/main)
- Product name: Kindred. README: "A care companion for older people and patients with chronic conditions. Patients choose what to share with family members and carers; their choices appear in the GP consent view."
- App: web/ (Next.js, port 3111). Backend: sim-app/ (copied simulator frontend + own backend on a local Postgres replica of the 50k records, port 4192). Neon for hosting. Design system: docs/design-system.md (paper/ink/moss/plum/amber/rust, Bricolage Grotesque + Instrument Sans + JetBrains Mono, circle-of-care diagram is the signature).
- Circle: Grace Chen (daughter, SIM-000066), Thomas Chen (son, SIM-000009), Idris Chen (husband, SIM-000140). Names pulled from the sim by ID.
- Working: 3 sharing levels (Everything / Only practical / Important updates) over 6 categories (appointments, medications, test results, conditions, care notes, mood and wellbeing) + custom; change on Circle screen or by telling the agent; consent enforced in every tool (NOT_SHARED, never hints); request_access card to the patient; consent persisted in Postgres and mirrored live into the GP consent view (local GP observation + audit in one transaction, NOT native FHIR Consent to remote Anima); scheduled morning check posts appointment reminders to the family group with a lift ask; results explained with ranges, previous values, plain-language note; audit rail.
- NOT in Kindred: disclosure gate, "patient informed" state, escalation. Those live only in my prototype (server.mjs + lib/ + app/, 29 tests, real remote Anima writes). Pitch must label them "prototyped, next".
- My prototype folders (app/, lib/, server.mjs, test/, twin/, pitch/) are untracked and separate from web/ and sim-app/.
