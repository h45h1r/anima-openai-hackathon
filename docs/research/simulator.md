# Simulator data and API access

Verified 12 September 2026 against [the hosted simulator](https://sim.animahealth.com/control/), its [handbook](https://sim.animahealth.com/docs/), [OpenAPI specification](https://sim.animahealth.com/api/openapi.json), and authenticated GET requests using the supplied key. No clinical actions, clock advances or messages were submitted.

## What our key can access

`GET /api/team` returned team `team-5`, world `team-8942268fa18a`, with scopes `gp`, `hospital`, `community`, `pharmacy`, `diagnostics`, `referrals`, and `wearables`. The world reports **50,000 synthetic patients**. The clock returned 12 September 2026, 08:00 UTC, paused, with no visible events at the first check.

Send `Authorization: Bearer <team key>`. A team key identifies a shared simulation world; it does not authenticate an individual patient, clinician or family member. Patient messaging uses GP scope. Operator operations require a separate token; CIS2 identity tokens do not grant access to team records. [Access documentation](https://sim.animahealth.com/docs/team-access/), [API authentication](https://sim.animahealth.com/docs/api/).

All seven service projections were readable with this key. The GP HTML and some API queries intermittently returned HTTP 502 or timed out; later reads of the same services succeeded. Our prototype reports these failures and offers an explicitly labelled captured snapshot.

## Data available

| Area | Read endpoint | Data |
| --- | --- | --- |
| Patient directory | `/api/sites/gp/patients?q=…&offset=0` | Name, birth date, identifiers, conditions, needs and goals; fixed 30-item pages |
| GP records | `/api/sites/gp/view?patient=SIM-000006&limit=500&offset=0` | EHR collections, encounters, observations, appointments, shared documents, reports and conversations |
| Appointments | `/api/sites/gp/appointments?date=2026-09-12` | Sessions, clinicians, locations, slots, bookings and patient names |
| Hospital | `/api/sites/hospital/view?patient=…` | Attendances, discharge documents, shared reports and operational resources |
| GP documents | `/api/sites/gp/documents` | Discharge correspondence and patient names |
| Practice messages | `/api/sites/gp/messaging-workspace` | Conversations, delivery attempts, internal notes, assignments and templates |
| Patient messages | `/api/sites/patient/messaging-workspace?patientId=…` | Documented patient projection of delivered conversations, with staff-only content removed |
| Community | `/api/sites/community/view?patient=…` | Care plans, care packages, visits and shared home observations |
| Pharmacy | `/api/sites/pharmacy/pharmacy-workspace` | Prescriptions, referrals, stock, products, orders and supplier quotes |
| Diagnostics | `/api/sites/diagnostics/view?patient=…` | Visible laboratory results and reports |
| Referrals | `/api/sites/referrals/view?patient=…` | Referral records and service capacity |
| Wearables | `/api/sites/wearables/devices?patient=…` and `/readings?patient=…&metric=steps` | Devices, activity, resting heart rate and sleep; timestamped values, units and quality |
| Clock and recent events | `/api/clock` | Simulation time and up to 100 visible recent events |

The patient message route is documented but its standalone read failed during this investigation. GP, hospital, community, pharmacy, diagnostics, referrals, wearable readings, directory, appointment, document and practice-messaging reads succeeded. Do not treat a documented action as write-tested.

The simulator also publishes PDS, ODS, DoS, e-RS, EPS, EPS Tracker, GP Connect, MESH, shared documents, pathology, radiology and appointment adapters under `/api/nhs/`. These are simulated subsets. Only the PDS Patient and ODS Organization routes publish specific FHIR search/read contracts; this is not a general production FHIR server. There is no published FHIR Consent endpoint. [API reference](https://sim.animahealth.com/docs/api/), [FHIR guide](https://sim.animahealth.com/docs/fhir/).

## Record shape and reading rules

Patients have `id`, `name`, `birthDate`, `localIds`, `conditions`, `needs`, `goals`, `synthetic`. Resources have `id`, optional `patientId`, `kind`, `title`, `status`, `owner`, `visibleTo`, `priority`, `createdAt`, optional `dueAt`, `data`, `version`, and sometimes `provenance`.

- Store identifiers together with their world. Resource IDs repeat across worlds.
- `data` depends on `kind`; the generic schema permits arbitrary properties. Use explicit normalizers for EHR collections, appointments, reports, letters and messages.
- Patient-filtered site views also return resources **without a patient**, such as capacity and appointment sessions. Filter by exact `patientId` before making a personal summary. The captured GP response contained 93 resources, of which 47 belonged to Eleanor.
- Read every page using `resourceTotal`, `resourceOffset`, and `resourceLimit`; the default/max view page is 500. Wearable pages default to 100 and max at 500.
- Deduplicate cross-service resources by world and resource ID; the same blood report can appear in GP, hospital and diagnostics.
- Timestamps are simulation Unix milliseconds. Appointment reminders must compare against simulator time; use appointment `data.startsAt`, not its creation time.
- Preserve missing values and quality flags. Missing wearable data is not zero; an empty medication array is not proof the patient takes no medication.
- A service's missing record may exist elsewhere but be hidden from that service. Read visibility and ownership, rather than assuming absence.
- Provenance distinguishes the original author and later changes. Do not infer an author when one is missing.

[Data guide](https://sim.animahealth.com/docs/data/), [wearable guide](https://sim.animahealth.com/docs/home/).

## Concrete demo patient

**Eleanor Chen, `SIM-000006`, born 12 May 1943.** Directory: frailty, step-free access, avoiding unnecessary travel and attending local appointments with reliable transport. Her GP narrative records that she uses a landline, does not use the patient app, and her husband could not drive her to an earlier review. This makes a good coordination example, while also showing why app-only consent is insufficient for this particular patient.

Observed records include:

| Source | Actual records |
| --- | --- |
| GP | 29 problem entries, 13 miscellaneous codes, four encounters, two observations, one booked appointment, one discharge letter, one conversation, 36 blood reports and a reception-call record; EHR medication/allergy arrays empty |
| Appointment | `r-3690`, practice follow-up at **08:30 UTC**, Nurse Alex Morgan, in person, 15 minutes |
| Hospital | Attendance for reduced mobility; renal clinic discharge correspondence shared with GP |
| Discharge letter | `document-batch-2-006`, version 2: a separate booking letter is expected; an outstanding medicines note needs follow-up |
| Community | `r-36`, home support not yet arranged; `r-44`, care assessment awaiting allocation |
| Wearables | One active activity watch and 22 observations; example activity value 1,800 steps/day with a recorded baseline of 4,200 |
| Messages | `messaging-example-6`, delivered registration-paperwork SMS conversation |

There were no patient-specific pharmacy or referral records in those two projections for Eleanor. These are synthetic examples, not clinical assessments. The captured diary had 14 appointments and six sessions across three clinicians. The prototype uses this patient and diary snapshot.

## Writes we could wrap as tools

The main action endpoint is `POST /api/sites/{site}/actions`. These actions are verified in the published schema and frontend code, **not executed in this investigation**:

| Possible application tool | Simulator operation | Conditions |
| --- | --- | --- |
| Create a coordination task | `create_task` | Patient ID, title, optional text; appropriate service |
| Arrange a visit | `schedule_visit` | GP/hospital/community; capacity checked; due after 90 simulation minutes |
| Book an appointment | `book_appointment` | Session ID/version, patient, start time; server validates slots |
| Share a service record | `share_record` | Record ID/version and service `target`; simplified service visibility |
| Write a GP note | `save_consultation` | A note can document a consent decision; it does not enforce it |
| Queue a patient message | `messaging_action`, command `create` | GP message to a synthetic patient; SMS/email is simulated only |
| Read delivery/reply status | Read conversation | Queued is different from delivered; internal notes must stay internal |
| Process a letter | `process_document` | Commands include assign/review/file/annotate; status transitions apply |

For updates, pass current `expectedVersion`. For retryable writes, use a stable `Idempotency-Key` for the same payload. A changed payload with the same key, stale version, or invalid transition can return 409. [Action reference](https://sim.animahealth.com/docs/api/), [messaging](https://sim.animahealth.com/docs/messaging/), [appointments](https://sim.animahealth.com/docs/appointments/).

## Consent gaps and architecture implications

The existing `visibleTo` field controls sharing between services. The published `Action` type includes `share_record`, but no patient consent grant/revoke operation, family recipient model, field-level sharing policy, or unshare operation. The handbook explicitly describes visibility as a simplified model rather than a production consent service. [Plan guide](https://sim.animahealth.com/docs/ten-year-plan/).

Therefore build a consent service in our backend with patient, authenticated actor, recipient, relationship, purpose, permitted categories/fields, start/expiry, revocation and version. Identity and relationship verification are separate from a person's name appearing in the record. Use the same service from the UI API, ADK tools and any later MCP server.

Keep the team's broad key server-side. A family endpoint must return only a permitted projection; it must not reuse the unfiltered GP endpoint. Recheck consent when returning a summary and just before delivering a notification. Persist an access decision with a plain-language reason, source record IDs/versions, consent version and recipient. ADK traces help with provenance but are not a family-facing explanation by themselves.

For the demo, we can enforce consent for access **through our application**. We cannot claim to revoke access for people using the original simulator directly. A GP note documenting consent is a synchronization demonstration, not upstream access enforcement. True EHR enforcement would require a supported upstream consent API or changes to the simulator backend. Previously shared records cannot be assumed retractable through this API.

Family messaging also needs our own recipient and delivery layer. The simulator's Messagey channel represents practice-to-patient communication; it does not provide a family-member inbox or send real SMS/email.

## Proactive triggers

No general webhook or durable event-stream subscription is published. `/api/clock` returns only up to 100 recent visible events, without a durable catch-up cursor. The telephony WebSocket is for reception calls, not a general clinical event feed.

Use an application-owned scheduler to poll relevant patient records and appointment dates. Compare stored resource versions and statuses, reconcile records periodically, and maintain a notification outbox with duplicate prevention. Events can prompt a refresh but cannot guarantee that every change was observed. ADK runs can be invoked from that scheduler. See [ADK research](adk.md).

The smallest useful later demo is: open Eleanor's upcoming appointment, record a patient's choice of recipient and allowed appointment fields, show the family's permitted view and access explanation, trigger a reminder using simulator time, then revoke the grant and demonstrate that our API blocks the next access/reminder. This remains proposed work; the current prototype copies and reads the screens only.
