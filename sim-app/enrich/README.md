# Kindred demo enrichment

`enrich.mjs` makes the synthetic records of the Kindred demo cohort clinically coherent. The
sim generates every blood analyte as an independent random walk (eGFR and creatinine disagree,
HbA1c drops below 20, Eleanor is neutropenic), most candidates have no medicines, and only two
patients have a future appointment. See [docs/demo-patients.md](../../docs/demo-patients.md)
for the findings this script answers.

It writes only to the app database (local `anima_sim_app_20260912`, or Neon when
`DATABASE_URL`/`DIRECT_DATABASE_URL` is set) and refuses the archival replica. Nothing is
forwarded to the source simulator.

## What it changes

For each patient (default: the eight demo candidates below):

1. **Blood histories.** Rewrites the 36 `report` resources `blood-v1-<pid>-<panel>-<i>`
   (panels fbc, ue, hba1c, lft, crp, lipids; i = 0..5) on the patient's existing six collection
   dates (falling back to Amira's dates, then the sim's fixed six). Every analyte follows one
   smooth story. Creatinine is solved from the target eGFR with **CKD-EPI 2021**
   (creatinine-only, race-free) using the patient's sex and age at each draw, rounded to an
   integer, and the stored eGFR is recomputed from that integer. Urea tracks creatinine.
   Panel ids, analyte names, units, reference ranges, the laboratory name and provenance
   structure are the sim's own; the only additions are new values and
   `data.enrichment: { version: "kindred-v1", story }`.
2. **Medicines and problems.** Adds repeat medicines to `ehr-record.data.medications`
   (UK generic name, strength and form; `isCurrent`, `prescriptionType: "repeat"`, `route`,
   `indication`, `issueDate` in the last 90 days, `reviewDate` in the next 6 months,
   `supplyStatus: "dispensed"`, `synthetic: true`, a short `note`) for each coded condition,
   never more than six current medicines, never a duplicate generic, losartan instead of
   ramipril and no metformin when the latest eGFR is below 30. Adds an active problem
   (`code: SIM-KINDRED-<n>`, dated 2–8 years ago) for any directory condition without an
   active entry on the problem list. Existing entries are kept.
3. **Appointments.** Books one story appointment per patient through the local action API
   (`POST /api/sites/gp/actions`, `book_appointment`, `Authorization: Bearer local-demo`,
   a fresh `Idempotency-Key`) into a free slot of an existing `appointment-session` for the
   named clinician and mode in the week after the sim date, so session versions, overlap
   checks and events are handled by the app. If no matching session exists it creates one
   first (`create_appointment_session`). Skipped when a booked appointment with the same
   title already exists on or after the sim date.
4. **Home monitoring (Amira only).** A `device` "Home activity watch" and daily
   `observation`s for the last ten days for `steps`, `heart-rate` and `sleep`, plus the
   "Activity trend below personal baseline" observation, copying the JSON shape, `visibleTo`
   and metric ids of Eleanor Chen's wearables history (the sim stores pulse as `heart-rate`).

Reports, records, devices and observations are written exactly as `store.mjs` `save()` does
(delete the resource's projections, insert one row per site in `visibleTo` plus the owner)
and every created or updated resource gets a `sim.events` row of type `enrich_demo_data` by
actor "Kindred enrichment". New resources carry
`provenance.created.actor = { kind: "team", name: "Kindred enrichment" }`; updated ones keep
their original `created`, get an entry appended to `provenance.changes` and a bumped
`version`.

### Cohort and stories

| Patient | Story in the results | Medicines added | Appointment |
| --- | --- | --- | --- |
| SIM-000001 Amira Khan, 74, heart failure + CKD | eGFR 58→46 with a step down at the last two draws (admission), potassium 5.0→5.6, CRP 28 on the last draw, Hb 118→112, HbA1c non-diabetic | bisoprolol, ramipril, furosemide, atorvastatin (+ active Heart failure problem) | Heart failure review after discharge, Dr Maya Shah, in person; plus the activity watch (steps 3200→1400, pulse 72→88, sleep 6.5→5.2) |
| SIM-000514 Arthur Green, 71, COPD | HbA1c 55→42, cholesterol 5.0→6.3, eGFR ~78, CRP 6–9 | tiotropium, salbutamol | COPD annual review, Nurse Alex Morgan |
| SIM-000511 Iris Walker, 89, arthritis + frailty | eGFR ~52 stable, Hb 118→110, albumin 36→34, CRP 3–6 | paracetamol, colecalciferol, alendronic acid | Frailty review, Dr Daniel Brooks, telephone |
| SIM-000244 Daniel Patel, 75, diabetes + heart failure | HbA1c 68→50, eGFR 44→58, Hb 118→132, CRP 8→2, potassium 5.2→5.5 | metformin, atorvastatin, bisoprolol, ramipril, furosemide (+ active Diabetes and Heart failure problems) | Diabetes review, Nurse Alex Morgan |
| SIM-000204 Zara Lewis, 90, hypertension + CKD | eGFR 60→47 with creatinine 81→99, HbA1c 60→54, WCC 9→12 on the last two draws | amlodipine, ramipril, atorvastatin | Kidney function review, Dr Maya Shah |
| SIM-000107 Freya Reed, 95, diabetes + hypertension + CKD + heart failure | sodium 137→130 and potassium 4.0→3.2 falling together, eGFR 55→44, HbA1c 58 | metformin, atorvastatin, amlodipine, ramipril, bisoprolol, furosemide (+ active Diabetes and Heart failure problems) | Medication review, Dr Daniel Brooks, telephone |
| SIM-000011 Zara Khan, 91, hypertension + heart failure | potassium 3.1–3.4, eGFR 52→45, CRP 6→11, HbA1c normal | amlodipine, ramipril, bisoprolol, furosemide | Blood pressure review, Nurse Alex Morgan |
| SIM-000006 Eleanor Chen, 83, frailty | HbA1c 51→48, eGFR 66→70, Hb 130→124, bilirubin 19–24, normal white cells | colecalciferol, alendronic acid (+ active Frailty problem) | Falls and mobility review, Dr Maya Shah (her existing appointment today is kept) |

Patients outside this list get a generic coherent story derived from their coded conditions.

## Running it

From the repository root, with the local app running on port 4192:

```sh
node sim-app/enrich/enrich.mjs --dry-run   # print the plan, write nothing
node sim-app/enrich/enrich.mjs             # enrich the default cohort
node sim-app/enrich/enrich.mjs --verify    # check the result (exit 1 on failure)
```

Flags:

| Flag | Meaning |
| --- | --- |
| `--patients SIM-000001,SIM-000514` | Patient ids to enrich (default: the eight above) |
| `--dry-run` | Print what would be created, updated or booked; no writes, no API calls that write |
| `--verify` | Check the enriched state instead of writing |
| `--api URL` | Action/read API bound to the **same** database (default `http://localhost:4192`, or `SIM_API_URL`) |
| `--sex SIM-000123=female` | Sex for CKD-EPI when the FHIR record has no `gender` and the first name is unknown |
| `--no-tests` | Skip `npm test` during `--verify` |

The script is idempotent: a second run reports every resource as unchanged and every
appointment as already booked. Versions bump only when a story, a date set or the sim date
(for the ten-day monitoring window) changes.

### Neon

The database is selected exactly as `store.mjs` does: `DIRECT_DATABASE_URL` (preferred, the
direct endpoint) or `DATABASE_URL` when set, otherwise the local socket. Appointments go
through the action API, which must be bound to the same database, so start a temporary
backend on another port first and point the script at it. From `sim-app`:

```sh
PORT=4194 node --env-file=.env.neon.development server.mjs &   # temporary backend
node --env-file=.env.neon.development enrich/enrich.mjs --api http://localhost:4194 --dry-run
node --env-file=.env.neon.development enrich/enrich.mjs --api http://localhost:4194
node --env-file=.env.neon.development enrich/enrich.mjs --api http://localhost:4194 --verify
kill %1                                                         # stop the temporary backend
```

Use `.env.neon.production` the same way once development verifies clean. The script checks
that each booked appointment is visible in its own database and aborts if the API is bound
elsewhere. Connection strings are never printed.

## Verification

`--verify` prints, per patient: 36 `blood-v1` reports on the gp site with six distinct
collection dates; eGFR within ±2 of CKD-EPI 2021 on every U&E report; enrichment marker on
all 36; between two and six current medicines; an active problem for every coded condition;
a booked appointment after the sim clock; the read API (`/api/sites/gp/view?patient=…`)
returning 36 blood reports; and for Amira the device plus 31 wearables observations. Then,
for the world, no duplicate `(site, resource_id)` rows, and `npm test --prefix sim-app`.

## Caveats

- The FHIR `Patient` resources in the sim carry no `gender`, so sex for CKD-EPI comes from a
  first-name table covering the cohort; use `--sex` for other patients.
- Ages and the ten-day monitoring window are relative to the sim clock (`sim.local_clock`,
  paused at 2026-09-12). Advancing the clock by a day and re-running shifts the observation
  dates, which is a legitimate content change and bumps those versions.
- Reports are regenerated wholesale; the sim's random-walk values are replaced, not merged.
- No family members, relatives, personal-context notes or letters are created; relationships
  belong to the Kindred app.
