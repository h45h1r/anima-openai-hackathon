# Demo patients: who to simulate, and what the sim really contains

Findings from 12 September 2026, checked against the **live** NHS-SIM (world `team-8942268fa18a`),
not only the local replica. Machine-readable profiles of the 18 candidates inspected live are in
[research/demo-candidates-live.json](research/demo-candidates-live.json).

## 1. What the replica missed

The replica was bulk-pulled through the service-wide views. Several things only appear when a
patient is opened individually, and several things only exist for a small scenario cohort.

| Data | What the replica showed | What the live sim actually does |
| --- | --- | --- |
| Blood results | 10 patients | **Generated for any patient on first per-patient view**: 6 panels (FBC, U&E, HbA1c, LFT, CRP, lipids) × 6 dates. The world counters already list 1,224 materialised patients. Same six dates for everyone: 2025-09-12, 2026-01-15, 2026-05-15, 2026-07-14, 2026-08-29, 2026-09-11. |
| Lab coherence | — | Each analyte is an independent random walk that crosses its reference range. **eGFR and creatinine are not coupled**: in 13 of 18 candidates they move in the same direction. Do not contrast them in a demo. |
| Genome record | none | The hospital view adds a `genome-record` per patient, also generated lazily. |
| Appointments | 49,488 | 49,474 are "Historical practice appointment" in 2023. Only **14 are in the future**, all today, and 12 of them belong to the scenario cohort. Any other demo patient needs an appointment booked by us (`book_appointment` is allowed with the team key). |
| Medications | — | 16,672 patients have a current medicine, but the vocabulary is five items (metformin, amlodipine, two inhalers, diclofenac gel). Among the 70 scenario patients aged 70+ with two or more chronic conditions, only 27 have any medicine and most of the best candidates have none. |
| Notes | — | The **scenario cohort** (`SIM-000001` to about `SIM-000520`) has authored notes; only 32 patients have a "personal context" note and only **6 name a relative** (daughter, husband, wife, grandson). The **bulk cohort** (`SIM-000521` onward) has 8 templated encounters each, drawn from about 12 sentences ("Lives with a partner and prefers a familiar clinician…"). |
| Letters, tasks, conversations, hospital, wearables, community | — | Scenario cohort only: hospital letters 60 patients, open tasks 98, conversations 12, hospital attendances 8, wearables 2 (Eleanor Chen, Grace Okafor), community care plan 1 (Eleanor Chen). The community, wearables, pharmacy, referrals and patient-portal views are **empty** for everyone else. |
| Records created after capture | — | Our own consent tasks and the "CareCircle" tasks written to Eleanor's record today are not in the replica. Treat the replica as a directory index, and the live sim as the record. |

So the candidate pool is the scenario cohort. The bulk cohort is not usable for a story: no future
appointments, boilerplate notes, no relatives, no letters.

## 2. What "a good trajectory" means here

A patient is worth simulating when the record supports all three flows without us inventing anything:

1. **Consent** needs a real relative or carer in the notes, or at least a carer-involvement need.
2. **Proactive notification** needs something time-bound: a booked appointment, a letter that promises
   a follow-up, an open task, or a home-monitoring signal.
3. **Explaining a result** needs analytes that changed over the six dates in a way that is
   clinically tellable and self-consistent: HbA1c, potassium, sodium, CRP, haemoglobin, white
   cells, cholesterol. Lead with eGFR only if creatinine agrees.

## 3. Shortlist

### Tier 1: recommended

**Amira Khan · `SIM-000001` · 74 · heart failure, CKD · needs: home visit, carer involvement**
The sim's own discharge story is live today: hospital attendance for breathlessness, an acute bed,
two discharge letters ("Cardiology · Monitoring handover": booking office to send a follow-up
letter), an open GP task "Arrange post-discharge monitoring", a discharge prescription approved at
the pharmacy, a practice follow-up **today at 09:15 with Dr Maya Shah**, and a message "review
worsening oxygen requirement". Her notes say she lives alone, her **daughter visits after work,
asked for appointments to be grouped, and can collect a prescription but cannot attend in working
hours**. Goal on record: "Stay at home with a clear contact for help."
Labs: eGFR 53 → 63 → 69 → 68 → 60 → **49** (recovered, then fell back below 60 in the last two
draws; creatinine broadly agrees), potassium 5.1 to 5.7 hovering at the top of range (the
heart-failure-medicines watch item), white cells low but recovering 0.7 → 3.5, CRP borderline 5.6.
Supports all three flows with no setup. Suggested circle from the directory: daughter Freya Khan
`SIM-000308` (54), son Idris Khan `SIM-000454` (53, transport need), and optionally Zara Khan
`SIM-000011` (91, also a patient) as her mother for a two-generation demo.

**Arthur Green · `SIM-000514` · 71 · COPD · needs: transport, telephone preferred**
The consent nuance in one record: "His daughter drives him when her shifts permit", "Arthur's
daughter requested enough notice to arrange transport. **Arthur prefers the practice to speak to
him first.**" Goal: "Coordinate practice and hospital follow-up." That is patient-first ordering of
notifications, with the daughter on *Important updates*.
Labs: HbA1c 55 → 42, a genuinely improving trajectory back to the edge of normal; cholesterol
5.5 → 6.5 rising; white cells, neutrophils and platelets all recovering from low. eGFR drifts
100 → 76 but creatinine falls, so leave kidney function out of the explanation.
Needs an appointment booked. Relatives: pick a Green in the directory.

**Iris Walker · `SIM-000511` · 89 · arthritis, frailty · needs: home visit, offline contact**
"Lives alone with support from a **neighbour**. Keeps appointment letters beside her landline."
Goal: "Know which team is visiting and when." She has no app, so the circle member is a neighbour,
not family, which tests the consent model beyond kin, and the family app is the only screen.
Labs: creatinine 153 → 121, improving but still high; HbA1c falling to 19, below range; platelets
on the upper limit. Needs an appointment booked.

### Tier 2: strong data, thinner story

| Patient | Why | Watch out |
| --- | --- | --- |
| **Daniel Patel** `SIM-000244`, 75, diabetes + heart failure, interpreter + carer involvement | The positive story: HbA1c 61 → 45 → 48, eGFR 41 → 63 recovered, haemoglobin 123 → 138, CRP 5.2 → 2. One watch item: potassium creeping 5.2 → 5.5. Interpreter need is an inclusion angle. | No letters, notes or appointment. Book one. |
| **Zara Lewis** `SIM-000204`, 90, hypertension + CKD, carer involvement | eGFR 74 → 52 moved out of range; HbA1c 68 → 56 is high although diabetes is not coded, a good "explain a surprise"; white cells rising to 12.1; open task "Confirm follow-up arrangements". | Creatinine contradicts eGFR. No relatives in notes. |
| **Freya Reed** `SIM-000107`, 95, diabetes + hypertension + CKD + heart failure | Sodium 135 → 130 and potassium 3.9 → 3.1 drifting low together, the classic diuretic story; eGFR 89 → 65. | No relatives, letters or appointment. |
| **Zara Khan** `SIM-000011`, 91, hypertension + heart failure, step-free | Surgery letter, open task, closed conversation, pharmacy referral. Potassium persistently low 2.7 to 3.3; eGFR 35 to 53; CRP rising 6.6 → 10.3. | Pairs with Amira as a Khan family where both are patients. |
| **Eleanor Chen** `SIM-000006`, 83, frailty (current demo patient) | The only patient with home monitoring: steps 4350 → 1800 over the last week and the sim's own "Activity trend below personal baseline" observation, a care package waiting, hospital attendance for reduced mobility, a renal clinic letter, husband in notes, appointment today 09:30. | Labs are the weakest: eGFR and creatinine both rise, conditions list is just "Frailty". Keep her for the wearables and community story. |

### Not recommended

- **Aisha Okafor `SIM-000304`, Sofia Clarke `SIM-000349`, Aisha Evans `SIM-000371`** (95–96): rich
  condition lists but no letters, tasks, notes or relatives, and contradictory kidney series.
- **Samuel Singh `SIM-000047`** (90): ten analytes out of range, but eGFR rises while creatinine
  rises and liver enzymes drift up without a story to hang them on.
- **Anyone above `SIM-000520`**: templated.

## 4. Setting a patient up

1. `SIM_PATIENT_ID=<id>` in `web/.env.local`, then **Reload record** in the app. Opening the
   patient's GP view generates the 36 blood reports the first time; this is idempotent.
2. Put the relatives in `web/src/lib/data/circle.ts` (sim IDs, relation, default level), or add
   them from the Circle screen if the companion service is running.
3. For anyone outside the scenario cohort, book an appointment so the scheduled check has
   something to announce: read a session from `GET /api/sites/gp/appointments?date=2026-09-1x`,
   then `POST /api/sites/gp/actions` with `type: "book_appointment"`, `sessionId`,
   `sessionVersion`, `startsAt`, `patientId`, `title`. A `book_appointment` agent tool would let
   Kindred do this on request.
4. In the explanation flow, steer to self-consistent analytes. If a clinician is in the room,
   say up front that the results are synthetic and per-analyte.
5. The sim clock is paused at 2026-09-12 08:00. New results only land after an `order_test`
   followed by `POST /api/clock {"paused": true, "advanceMinutes": 121}`.

## 5. Recommendation

Run the demo on **Amira Khan**. Everything the pitch claims is already in her record: a daughter
with limited availability, a discharge that needs monitoring, an appointment today, a letter that
promises another, and results that dipped again last week. Keep **Arthur Green** as the second act
for the patient-first consent rule and **Iris Walker** to show a circle that includes a neighbour,
booking one appointment for each.
