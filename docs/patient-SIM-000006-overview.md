# SIM-000006 Eleanor Chen: itemised health overview

Source: Anima sim world team-8942268fa18a, read 12 Sep 2026 (sim clock 2026-09-12 08:00). All data synthetic. 72 patient-linked resources across gp, hospital, community, wearables and patient views; none in pharmacy.

## 1. Demographics and identifiers
- Name: Eleanor Chen. Born 1943-05-12 (83). Address: 7 Meadow Walk, Northbank, GB.
- Email sim-000006@patients.example. Contact preference: telephone (landline). Does not use the patient app.
- Registered GP: Riverside Practice (ODS SIM-RIVERSIDE). Local IDs: gp RIV-5, hospital NBG-10005, legacy WH-90005.
- Social context: lives with her husband; weekly library group on Thursday mornings; husband cannot always drive her.
- Stated goal ("what matters to me"): attend local appointments with reliable transport.

## 2. Problem list (GP ehr-record)
Active: Musculoskeletal symptoms (2026-05-15), Sleep concern (2026-02-14), Preventive health review (2025-08-18), Follow-up after hospital contact (2025-05-20).
Resolved: Frailty (2026-08-13), Medication review (2025-11-16).
Note: the same five terms repeat on a ~3-month cycle back to 2019 (29 entries). Treat as a shape, not a clinical narrative.
Allergies: none recorded. Medications: none recorded (medicationProfile "condition-linked-v1", list empty).
Admin codes: contact preferences recorded, appointment invitation sent, record reviewed, correspondence received, care team updated.

## 3. Consultations (GP encounters)
| Date | Channel | Author | Reason | Content |
|---|---|---|---|---|
| 2026-01-15 | in-person | Dr Rowan Ellis | Frailty | Cancelled an upstairs appointment because the lift was unavailable; step-free room requested |
| 2026-06-21 | telephone | Dr Rowan Ellis | Frailty | Husband could not drive her to a review; asked whether appointments could be arranged locally |
| 2026-07-08 | in-person | (unnamed) | Long-term condition review | Generic: discussed next appointment and contact preferences |
| 2026-09-03 | in-person | Dr Rowan Ellis | Attend local appointments with reliable transport | Prefers a telephone call to arrange next appointment; library group Thursday mornings |
Observation 2026-07-08 08:10: contact preference = telephone. Observation 2026-09-08: personal context and contact preferences (as above).

## 4. Hospital
- Renal clinic discharge correspondence, sent 2026-09-05 09:00 by Dr Taylor Brook, assigned to practice document team, stage "sent". Reason: planned renal clinic review. Results: existing lab panel referenced, no new values. Diagnoses: none new. Follow-up: clinic secretary to confirm next appointment by separate letter. GP actions: match referenced panel to record and request outstanding medicines note. Medication changes: none requested; medicines reconciliation note still expected.
- Hospital attendance TODAY 2026-09-12: arrived 04:20, assessed 04:50, referred 05:20, stage "take", acuity 3, AMU bed 1, clinician Dr Alex Morgan, presenting complaint "Reduced mobility". Visible to hospital only.

## 5. Appointments
- GP: Practice follow-up, in-person, 2026-09-12 08:30, 15 min, Nurse Alex Morgan, status booked. (She is in AMU at that time.)

## 6. Community and social care
- Care plan (community): "Home support not yet arranged", open. carerAvailable=false, homeAccessConfirmed=false.
- Care package (social): "Home care assessment awaiting allocation", waiting. keySafe=false, visitsPerDay=2, fundingDecision=pending.

## 7. Wearables (Home activity watch, battery 76%, synced 2026-09-12 08:00)
| Date | Steps/day | Resting HR bpm | Sleep h |
|---|---|---|---|
| 09-05 | 4350 | 68 | 7.2 |
| 09-06 | 4100 | 67 | 7.5 |
| 09-07 | 4650 | 69 | 6.8 |
| 09-08 | 3900 | 68 | 7.1 |
| 09-09 | 3500 | 70 | 7.4 |
| 09-10 | 2800 | 69 | 6.9 |
| 09-11 | 2400 | 68 | 7.3 |
| 09-12 | 1800 (flag: below personal baseline 4200) | | |
Steps fell 61% in a week; HR and sleep stable.

## 8. Messaging
- One SMS conversation, "Registration paperwork", 2026-09-12 01:00, from Dr Rowan Page: "Please contact reception to finish the outstanding registration paperwork." Delivered. Reply allowed. No message about any result, appointment or admission.

## 9. Blood results (6 panels x 6 dates, all status "available", none reviewed; L/H = outside reference)
### FBC (ref)
| | 25-09-12 | 26-01-15 | 26-05-15 | 26-07-14 | 26-08-29 | 26-09-11 |
|---|---|---|---|---|---|---|
| Haemoglobin g/L (115-165) | 156 | 153 | 147 | 141 | 140 | 144 |
| White cells x10^9/L (4-11) | 4.7 | 4.0 | 2.7 L | 1.6 L | 1.3 L | 2.1 L |
| Platelets x10^9/L (150-400) | 341 | 322 | 286 | 256 | 248 | 269 |
| MCV fL (80-100) | 90.7 | 89 | 85.8 | 83 | 82.4 | 84.3 |
| Neutrophils x10^9/L (2-7.5) | 3.5 | 3.0 | 2.0 | 1.2 L | 1.0 L | 1.6 L |
### U&E
| Sodium (133-146) | 136 | 134 | 133 | 134 | 136 | 138 |
| Potassium (3.5-5.3) | 3.5 | 3.2 L | 3.0 L | 3.1 L | 3.4 L | 3.7 |
| Urea (2.5-7.8) | 4.6 | 3.3 | 2.7 | 3.0 | 4.3 | 5.5 |
| Creatinine (45-110) | 42 L | 26 L | 18 L | 23 L | 37 L | 53 |
| eGFR (60-120) | 77 | 67 | 62 | 65 | 74 | 84 |
### HbA1c mmol/mol (20-41): 51 H, 57 H, 61 H, 60 H, 55 H, 49 H
### LFT
| ALT (0-40) | 11 | 3 | 0 | 0 | 3 | 11 |
| ALP (30-130) | 55 | 39 | 27 L | 27 L | 39 | 55 |
| Bilirubin (0-21) | 25 H | 22 H | 19 | 19 | 22 H | 25 H |
| Albumin (35-50) | 35 | 33 L | 31 L | 31 L | 33 L | 35 |
### CRP mg/L (0-5): 5.9 H, 7.4 H, 8.0 H, 7.3 H, 5.8 H, 4.3
### Lipids
| Total chol (0-5) | 3.8 | 4.3 | 4.4 | 4.2 | 3.8 | 3.4 |
| HDL (1-2.5) | 1.8 | 1.9 | 2.0 | 1.9 | 1.8 | 1.6 |
| Triglycerides (0-1.7) | 1.8 H | 2.0 H | 2.1 H | 2.0 H | 1.7 | 1.5 |

## 10. Signals worth surfacing (computed, not stated in the record)
1. Neutropenia: neutrophils 1.0 on 29 Aug, 1.6 on 11 Sep; white cells low on four consecutive panels. No review, no message, no task.
2. HbA1c in the diabetes range (49-61) on every panel; no diabetes on the problem list, no medications.
3. Persistent hypokalaemia Jan to Aug, now normal. Creatinine very low throughout (consistent with low muscle mass in a frail 83 year old).
4. Mild raised bilirubin and low albumin, raised CRP: low-grade chronic pattern, all resolved or borderline on 11 Sep.
5. Functional decline: steps down 61% in 7 days, then admitted 04:20 today with reduced mobility.
6. Coordination failure in progress: GP appointment at 08:30 today while she is in AMU; no carer available; home care assessment unfunded; husband cannot reliably drive; renal letter asks the GP for actions not yet done; only contact sent was about paperwork.
7. Access: landline only, no app. Any family communication layer has to route around her, not through the app.
