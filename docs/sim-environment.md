# NHS-SIM (sim.animahealth.com) — environment report

Researched 2026-09-12 against `https://sim.animahealth.com`. Companion files in this folder:

| File | What it is |
| --- | --- |
| `sim-openapi.json` | The live OpenAPI 3.1 spec (`GET /openapi.json`, 71 paths, 28 schemas). Import into an API client or feed to an agent. |
| `sim-handbook.json` | Every handbook page as MDX source (`GET /docs/handbook.json`) — good RAG material for the agent. |
| `sim-catalogue.json` | Runtime catalogue (`GET /api/catalogue`): sites, adapters, scenarios, docs links. Public, no auth. |

> **Important constraint honoured during research:** the only way to get a working credential is `POST /api/keys {teamName}`, which creates a persistent "team world" (an account-like credential). Per the brief I did **not** create one, so every request/response shape below comes from the OpenAPI spec, the handbook, the runtime catalogue, and the front-end bundles (which embed the Zod contract and the exact payloads the UI sends). No live record was fetched. The very first thing to do when you decide to proceed is the one-liner in §2.3 — it takes ~1 second and gives you a reusable key for the whole team.

---

## 1. Overview — what the sim is and how it is controlled

**NHS-SIM** is a synthetic "health neighbourhood" (Riverside & Northbank) with five workplaces, each a React app on the same origin, all reading and writing **the same per-team record store** in PostgreSQL:

| Place on the map | App(s) | URL | API "site" scope |
| --- | --- | --- | --- |
| Riverside Practice (primary care) | GP Records, Document Inbox, Messagey, Reception Calls | `/gp/`, `/gp/documents/`, `/gp/messages/`, `/gp/telephony/` | `gp` |
| Northbank General (secondary care) | Hospital EPR | `/hospital/` | `hospital` |
| Neighbourhood Care (community) | Community Care | `/community/` | `community` |
| High Street Pharmacy | Pharmacy | `/pharmacy/` | `pharmacy` |
| At home | **Home Health** (wearable dashboard, "phone" UI) + patient **Messages** | `/wearables/`, `/wearables/messages/` | `wearables`, `patient` |
| (API-only) | Diagnostics, Referrals | — | `diagnostics`, `referrals` |
| Staff Identity (CIS2 emulator) | OIDC sign-in demo | `/cis2/` | separate credential |
| The neighbourhood map / control panel | `/control/` | — | `control` (operator only) |

Core concepts:

* **Team world** — one isolated copy of the world per team name. All portals + API calls with that key affect only that world. New worlds inherit a published synthetic population (500 people minimum, up to 50k if the organiser seeded it) plus 61 seeded discharge letters, lab histories, appointment sessions, etc.
* **Simulation clock** — each world has its own clock (Unix ms, UTC). It runs at `speed`× real time, can be paused, and can be **advanced** up to 7 days per call. Advancing executes due jobs (lab results, visit completions, watch readings, supplier deliveries). This is the "scenario engine" a team can drive.
* **Resources** — every record (task, appointment, lab test, observation, prescription, conversation, discharge letter…) is one generic `Resource` with `kind`, `status`, `owner` (service), `visibleTo[]` (services that can see it), `version`, `data` (kind-specific), and provenance.
* **Actions** — all writes go through one typed envelope `POST /api/sites/{site}/actions` with 43 action `type`s (see §5). Optimistic concurrency via `expectedVersion`, idempotency via `Idempotency-Key` header.
* **Events** — every action and clock tick emits an `Event` (`{time,type,actor,resourceId,patientId,detail,visibleTo}`), readable via `GET /api/clock` (last 100) and `GET /api/sites/{site}/view`. There is **no push channel** (no webhooks/SSE); the UI polls every 3 s.
* **Incidents & scripted agents** — eight named disruptions (pathology outage, wearable disconnect, winter pressure…) and background "world agents" — but these are **operator-token only** (see §6).
* **Interactive explorer** — Swagger UI at `/docs/explorer/`; handbook at `/docs/`.

The whole thing is explicitly "synthetic, not NHS-certified"; every patient has `synthetic: true` and IDs like `SIM-000006`.

---

## 2. Auth model

Four credential types (from `components.securitySchemes`):

| Scheme | How | Who gets it | Grants |
| --- | --- | --- | --- |
| **TeamKey** (what we use) | `Authorization: Bearer <apiKey>` | Anyone: `POST /api/keys {"teamName": "..."}` — **no login, no throttle, public** | Full read/write on that team's world for every scope (`gp, hospital, community, pharmacy, diagnostics, referrals, wearables`, plus `patient`) |
| OperatorKey | `Authorization: Bearer <OPERATOR_TOKEN>` | Hackathon organisers only (deployment env var) | `/api/control/*`, `/api/operator/*`, `?world=` switching, incidents, agents, population seeding |
| BrowserSession | HttpOnly cookie `sim_session` from `POST /api/session` | Derived from a TeamKey | Only needed for the HTML-only "legacy EPR" at `/browser/legacy` |
| CIS2AccessToken | Bearer from `/cis2/token` (OIDC code+PKCE) | Anyone via the fictional staff sign-in | **Only** `/cis2/userinfo`. Does *not* unlock any team data |

### 2.1 Team key semantics
* `teamName` is lowercased and whitespace-stripped (`"Family Companion"` → `familycompanion`). Same name ⇒ same world ⇒ **same reusable key returned again**. So the name is a join code; pick something non-guessable if you care.
* Omit `site` to get all scopes (do this). `site` restricts a key to one service.
* Capacity: 5,000 worlds per deployment. Body limit 64 KB.
* Response (`Key` schema): `{"apiKey": "...", "team": "Family Companion", "teamName": "familycompanion", "world": "<world-id>", "scopes": ["gp","hospital",...], "created": true}`.
* `GET /api/team` → `{"team","world","scopes"}` — use as a health/auth check.

### 2.2 What the UI stores
`localStorage`: `sim-key`, `sim-team`, `sim-world`. The "Join the world" dialog asks only for **Team name** (button "Create or join team"), with a disclosure "Use an existing team key" (password field). "Organiser controls" asks for **Operator token** (password field) — "A team API key cannot unlock organiser access."

### 2.3 Bootstrapping from Node (do this first)
```bash
export SIM_ORIGIN=https://sim.animahealth.com
export SIM_KEY=$(curl -fsS "$SIM_ORIGIN/api/keys" -H 'Content-Type: application/json' \
  -d '{"teamName":"<pick a distinct team name>"}' | jq -r .apiKey)
curl -fsS "$SIM_ORIGIN/api/team" -H "Authorization: Bearer $SIM_KEY"
```
Notes for server-side use:
* Same-origin `servers: [{url: "/"}]` — base URL is simply `https://sim.animahealth.com`.
* The spec says "Browser origin checks permit only the deployed application origin for mutations". That is an `Origin`-header check; server-to-server requests (curl/Node `fetch`) send no `Origin` and the handbook's own quickstart uses curl for `POST` actions, so this should pass. If you ever get 403 on a mutation from Node, make sure you are not forwarding a browser `Origin` header.
* I saw intermittent **502s** from the host during research (recovered within a few seconds). Wrap calls in a small retry.
* Unauthenticated errors look like `{"error":"Get a team API key at POST /api/keys"}` (401); unknown path `{"error":"Unknown API endpoint"}` (404).

---

## 3. Every API endpoint (71 paths)

Base: `https://sim.animahealth.com`. All JSON. Auth column: **T** = TeamKey (also accepts Operator/BrowserSession), **O** = OperatorKey only, **–** = public, **C** = CIS2 token. Common error body: `{"error": string, "message"?: string}`; status table: 400 invalid, 401 no/invalid key, 403 scope/origin/operator, 404 unknown, 409 stale version / invalid transition / capacity, 413 body too big, 429 5k-team cap, 501 deliberately unsupported (legacy), 503 simulated identity outage.

### 3.1 Discovery (public)
| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/healthz` | – | `{"ok":true,"database":"postgresql","mode":"synthetic"}` (verified live) |
| GET | `/api/catalogue` | – | Sites, NHS adapters, workspaces, 8 incident scenarios, identity issuer, doc links (verified live; saved as `sim-catalogue.json`) |
| GET | `/openapi.json`, `/api/openapi.json` | – | OpenAPI 3.1 (saved) |
| GET | `/api/plan-lab` | – | Retired → 410 |
| GET | `/docs/`, `/docs/handbook.json`, `/docs/explorer/` | – | Handbook (Docusaurus), handbook JSON, Swagger UI |

### 3.2 Team
| Method | Path | Auth | Purpose / shape |
| --- | --- | --- | --- |
| POST | `/api/keys` | – | Body `{"teamName": string, "site"?: enum}` → 201 `Key` (see §2.1) |
| GET | `/api/team` | T | → `{"team","world","scopes":[...]}` |
| POST | `/api/session` | T | Body `{}` → sets `sim_session` cookie (1 h) for `/browser/legacy` |

### 3.3 Simulation time (the scenario engine we can drive)
| Method | Path | Auth | Purpose / shape |
| --- | --- | --- | --- |
| GET | `/api/clock` | T | → `Clock` `{"now": <sim unix ms>, "paused": bool, "speed": number, "events": Event[≤100]}` |
| POST | `/api/clock` | T | Body `{"paused"?: bool, "speed"?: 0..3600, "advanceMinutes"?: 0..10080}`. **Manual advance requires `paused:true` in the same request or you get 409.** Returns updated `Clock` incl. new events. Example (from spec): `{"paused":true,"advanceMinutes":121}` = "run delayed test results". |

### 3.4 Service workspaces (generic read + the single write endpoint)
`{site}` ∈ `control | gp | hospital | community | pharmacy | diagnostics | referrals | wearables | patient` (`patient` only for view/actions/messaging; `control` needs operator; `legacy` → 501).

| Method | Path | Auth | Purpose / shape |
| --- | --- | --- | --- |
| GET | `/api/sites/{site}/view?patient=SIM-000006&offset=0&limit=500` | T | → `View`: `{id, now, speed, paused, population, counters{}, resources: Resource[], resourceTotal, resourceOffset, resourceLimit, staffing{doctors,nurses,staffedSpaces,waiting}, faults{<incidentId>:bool}, events: Event[], agents:[{id,enabled}]}`. Without `patient` returns the service's whole visible set (paged). `site=patient` = GP scope minus staff-only conversation content — **this is the patient-portal view**. |
| GET | `/api/sites/{site}/patients?q=<text>&offset=0` | T | Search name / ID / condition / need / goal (prefix + full text). Page size fixed 30. → `{"total": n, "items": Patient[]}` |
| POST | `/api/sites/{site}/actions` (+ header `Idempotency-Key`) | T | Body `Action` (§5). → 200 the created/updated `Resource`. |
| GET | `/api/sites/{site}/appointments?date=YYYY-MM-DD` | T | One UTC day → `{"appointments": Resource[], "patients":[{id,name}], "sessions": Resource[]}` |
| GET | `/api/telephony/live` | – (auth in first WS frame) | WebSocket reception switchboard (`TelephonyClientMessage`/`TelephonyServerMessage`). Not relevant to us. |

### 3.5 Site-specific read projections (all return `Workspace` = `{resources: Resource[], patients: Patient[], now}`)
| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/sites/hospital/attendances` | T | A&E take, ED and inpatient list (`hospital-attendance` resources) |
| GET | `/api/sites/hospital/documents` | T | Hospital discharge-summary drafts + sent letters |
| GET | `/api/sites/gp/documents` | T | Discharge letters visible to GP with processing stage |
| GET | `/api/sites/pharmacy/pharmacy-workspace` | T | Prescriptions, Pharmacy First referrals, products, stock movements, supplier quotes, orders, baskets |
| GET | `/api/sites/gp/messaging-workspace` | T | Practice conversations + message templates (staff view) |
| GET | `/api/sites/patient/messaging-workspace?patientId=SIM-000006` | T | **One patient's delivered conversations** (no internal notes / undelivered) |

### 3.6 "NHS-shaped" adapters (simplified projections, `Bundle`-shaped, ≤100 resources)
Each has `GET /api/nhs/{id}?patient=SIM-000006` (or `?q=`) and `POST /api/nhs/{id}/actions` (same `Action` envelope, delegated to the owning site's engine).

| Adapter id | Path | Scope | Resource / kind | Notes |
| --- | --- | --- | --- | --- |
| `pds` | `/api/nhs/pds` | gp | Patient | demographics search |
| `ods` | `/api/nhs/ods` | referrals | Organization | fixed fictional directory |
| `dos` | `/api/nhs/dos` | referrals | HealthcareService | service discovery |
| `ers` | `/api/nhs/ers` | referrals | ServiceRequest / `referral` | create/read/accept/reject |
| `eps` | `/api/nhs/eps` | pharmacy | MedicationRequest / `prescription` | draft→approve→dispense→collect |
| `eps-tracker` | `/api/nhs/eps-tracker` | pharmacy | MedicationRequest / `prescription` | lifecycle read |
| `gp-connect` | `/api/nhs/gp-connect` | gp | Task / `task` | |
| `mesh` | `/api/nhs/mesh` | gp | Communication / `message` | JSON mailbox |
| `scr` | `/api/nhs/scr` | gp | DocumentReference / `document` | visible shared documents |
| `pathology` | `/api/nhs/pathology` | diagnostics | DiagnosticReport / `test` | **delayed lab results** |
| `radiology` | `/api/nhs/radiology` | diagnostics | DiagnosticReport / `report` | metadata only |
| `appointments` | `/api/nhs/appointments` | gp | Appointment / `appointment` | capacity-backed booking |

### 3.7 FHIR R4-shaped read-only subset (`application/fhir+json`, `OperationOutcome` on error, 405 on writes)
| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/nhs/pds/metadata` | T (gp) | CapabilityStatement |
| GET | `/api/nhs/pds/Patient?family=&given=&birthdate=&identifier=&_count=20&_offset=0` | T | `Bundle` searchset of `FhirPatient` |
| GET | `/api/nhs/pds/Patient/{id}` (`^SIM-\d{6}$`) | T | One `FhirPatient`: `{resourceType:"Patient", id, active, identifier:[{use,system:"https://nhs-sim.example/identifier/patient",value}], name[], birthDate, address[], telecom[], generalPractitioner[], meta}` |
| GET | `/api/nhs/ods/metadata` | T (referrals) | CapabilityStatement |
| GET | `/api/nhs/ods/Organization?name=&identifier=&active=` | T | `Bundle` of `FhirOrganization` |
| GET | `/api/nhs/ods/Organization/{id}` e.g. `SIM-RIVERSIDE` | T | Riverside Practice, Northbank General, Riverside Community Services, Riverside Pharmacy |

**No FHIR `Consent`, `RelatedPerson`, `Observation`, `Appointment` or `CarePlan` endpoints exist** (keyword sweep of the spec: `Consent` 1 hit — the CIS2 OIDC consent screen; `RelatedPerson`/`carer`/`nextOfKin`/`proxy` 0 hits).

### 3.8 Operator-only (we do not have this token; listed for completeness)
| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/control/worlds` | list world ids |
| GET | `/api/control/teams` | teams + activity summaries |
| GET | `/api/control/teams/{world}/activity` | request log, affected patients, record changes |
| POST | `/api/control/teams/{world}/session` | get a participant key for a world |
| DELETE | `/api/control/teams/{world}` / POST `/api/control/teams/delete` | delete teams |
| GET | `/api/control/snapshot?world=` | full world + event history |
| POST | `/api/control/incidents?world=` | `{"id": <incidentId>, "enabled": bool}` — toggle one of the 8 scenarios |
| POST | `/api/control/incidents/all` | same across all teams |
| POST | `/api/control/agents?world=` | `{"id","enabled"}` toggle scripted world agents |
| POST | `/api/control/model-propose` | ask the configured model agent for proposals (no execution) |
| POST | `/api/control/population`, `/population/publish`, `/population/attach` | seed / publish / attach synthetic population |
| GET/PUT/DELETE | `/api/operator/cis2` | identity-simulator settings |

### 3.9 Staff Identity (CIS2 emulator, OIDC)
`GET /cis2/.well-known/openid-configuration` (verified: issuer `https://sim.animahealth.com/cis2`, code flow, PKCE S256, RS256, scopes `openid profile`, client `nhs-sim-client`), `/cis2/jwks`, `/cis2/authorize` (HTML, browser only), `POST /cis2/authorize`, `POST /cis2/token` → `{access_token,id_token,token_type:"Bearer",expires_in,scope}`, `GET /cis2/userinfo` → `StaffIdentity {sub,name,role,org,organisation,nhs_sim:true}`, `GET /cis2/session` → `{"identity": null | StaffIdentity}` (verified live). Useful only if we want a "clinician logs in with a smartcard" moment in the demo; it never unlocks patient data.

---

## 4. Data model / resource types

### 4.1 `Patient` (directory record — `/api/sites/{site}/patients`, `Workspace.patients`)
```json
{
  "id": "SIM-000006",
  "name": "Eleanor Chen",
  "birthDate": "19XX-XX-XX",
  "localIds": { "gp": "...", "hospital": "..." },
  "conditions": ["..."],
  "needs": ["..."],
  "goals": ["..."],
  "synthetic": true
}
```
(Shape from the spec; `conditions/needs/goals` are free-text arrays and are searchable via `?q=`.) The FHIR projection of the same person is at `/api/nhs/pds/Patient/SIM-000006` (§3.7).

**Known sample people (from the handbook):**

| ID | Name | Why they matter for us |
| --- | --- | --- |
| **`SIM-000006`** | **Eleanor Chen** | Has a **Home Health dashboard (wearables), a practice record and community-care records** — the handbook's own "analogue to digital / sickness to prevention" persona. **Best fit for our elderly/chronic patient.** |
| `SIM-000001` | Amira Khan | Records across hospital, GP and pharmacy; discharge → primary-care handover; seeded follow-up task and discharge document. |
| `SIM-000002` | — | Rejected referral + diagnostics + legacy letter scenario. |
| (search by name) | Nina Brooks | Child whose **appointments are arranged by her parent** (narrative only). |
| (search by name) | Yasmin Ahmed | Taking over her own appointment arrangements at college. |
| (search by name) | Frank Walsh | Longer appointments with community transport. |
| Org `SIM-RIVERSIDE` | Riverside Practice | ODS Organization id. |

### 4.2 `Resource` (every record)
```json
{
  "id": "<string>",
  "patientId": "SIM-000006",
  "kind": "task | appointment | appointment-session | test | observation | device | prescription | referral | visit | care-plan | conversation | message-template | consultation | problem | allergy | ehr-record | hospital-note | hospital-attendance | discharge-summary | document | report | pharmacy-product | pharmacy-quote | pharmacy-order | pharmacy-basket | pharmacy-movement | pharmacy-referral | ...",
  "title": "Full blood count",
  "status": "open | draft | available | reviewed | accepted | scheduled | waiting | completed | booked | arrived | cancelled | approved | dispensed | collected | signed | queued | delivered | failed | active | inactive | resolved | rejected ...",
  "owner": "gp | hospital | community | pharmacy | diagnostics | referrals | wearables",
  "visibleTo": ["gp", "hospital"],
  "priority": "routine | urgent",
  "createdAt": 1789000000000,
  "dueAt": 1789007200000,
  "data": { "...kind-specific..." },
  "version": 3,
  "provenance": {
    "created": { "actor": {"kind":"team|operator|simulation","name":"..."}, "source": "...", "action": "create_task", "time": 1789000000000, "version": 1 },
    "changes": [ { "...RecordChange..." } ]
  }
}
```
`visibleTo` + `owner` are the **entire access-control model**: a service sees a resource only if it is listed in `visibleTo`. The UI labels this "Shared with". The action `share_record` appends a service to `visibleTo` (§5).

Kind-specific `data` shapes recovered from the UI's Zod schemas (all times = sim Unix ms):

| kind | `data` shape | Source |
| --- | --- | --- |
| `ehr-record` (one per patient, owner `gp`) | `{problems:[{term,code,date,status}], medications:[{term,isCurrent,issueDate,indication?,route?,prescriptionType?,supplyStatus?,reviewDate?,note?}], allergies:[{term}], miscCodes:[{term,code}]}` — **the structured GP record: conditions + medication history + allergies** | systems chunk |
| `observation` (owner `wearables`) | `{metric?: "activity"|"pulse"|"sleep"|"steps"..., value: number|null, unit: "steps/day"|"bpm"|"h", quality: "missing"|..., baseline?, observedAt?}` — `null`/`missing` = device disconnected | home chunk |
| `device` (owner `wearables`) | `{metric?: "steps", battery?: number, quality?}`; title `"Home activity watch"`; status `active` | home chunk |
| `test` (owner `diagnostics`) | `BloodTestOrder` on request (`panelId: fbc|ue|hba1c|lft|crp|lipids, panel, specimen, priority, collection: now|next-round, clinicalDetails`); after `dueAt` passes, `status: "available"` with result measurements (analyte, value, unit, ref interval; 6 historical sample dates per panel are seeded) | spec + handbook |
| `prescription` (owner `pharmacy`) | `MedicationOrder {drug,dose,unit,route,frequency,duration,quantity,indication}` + lifecycle `draft→reviewed→approved→dispensed→collected` | spec |
| `appointment` / `appointment-session` (owner `gp`) | session: `{clinician, location, mode: in-person|telephone|video|online, startsAt, endsAt, slotMinutes, blocked slots[]}`; appointment: `{sessionId, startsAt, durationMinutes, clinician, location, mode, reason}`, status `booked→arrived→completed` or `cancelled` | spec + handbook |
| `care-plan` (owner `community`) | `{carerAvailable: bool, homeAccessConfirmed: bool, ...}` ("Carer availability: Confirmed / Not confirmed") — **the only carer concept in the sim** | care chunk |
| `visit` (owner `community`) | purpose text; `dueAt = createdAt + 90 min`; status `scheduled→completed` | handbook |
| `conversation` (owner `gp`) | `{subject, channel: sms|email, allowReply: bool, assignee?, entries:[{id, direction: incoming|outgoing, body, at, actor:{name}, status?: queued|delivered|failed, internal?}]}`; status `open|done` | messaging chunk |
| `message-template` | `{title, body, channel}` | spec |
| `hospital-note` | `HospitalNote` (`template, sections[{id,heading,text}], text, stage: draft|signed, signedAt, signedBy, addenda[]`) | spec |
| `discharge-summary` | `dischargeSections {reason,course,diagnoses,medicationChanges,results,followUp,gpActions}` + `documentTags[]`, `documentSnomedCodes[{code,display}]`, stage `draft→sent→reviewed→filed` | spec |
| `hospital-attendance` | `{acuity:"1".."5", location, clinician?, disposition?, arrivedAt, assessedAt...}`; transitions `assign→assess→refer→admit→discharge` | spec |
| `task` | `{text?}`; status `open→reviewed→accepted→completed` | spec |
| `referral` | target service; `review/accept/reject/complete` | spec |

### 4.3 `Event` (the feed we will poll for proactive alerts)
```json
{ "id": "<string>", "time": 1789000000000, "type": "<string — NOT enumerated in the spec>",
  "actor": "<team label or simulation actor>", "resourceId": "<optional>", "patientId": "SIM-000006",
  "detail": "<human-readable sentence, shown in the UI's Activity trail>", "visibleTo": ["gp", "diagnostics"] }
```
Field names/requiredness are from the `Event` schema; the values above are placeholders. The `type` vocabulary is not enumerated anywhere — treat it as an opaque string and key alerts on `patientId` / `resourceId` / `detail`, then re-read the resource to get its real `status`.

### 4.4 Consent / family — what exists
* **No consent resource.** Handbook, verbatim: "Record sharing in this simulator is a simplified visibility model. It does not model NHS legal bases for processing or a production consent service."
* The consent-adjacent primitives are: per-resource `visibleTo[]`, the `share_record` action (service→service sharing), the `patient` site scope (a patient-facing projection that strips staff-only content), and `messagingCommand.allowReply` (practice controls whether the patient may reply).
* **No family / RelatedPerson / next-of-kin data anywhere** — only the `care-plan.data.carerAvailable` boolean and narrative mentions (Nina Brooks's parent). FHIR `Patient.contact` is not in the `FhirPatient` schema (`telecom`/`address` are).

---

## 5. Read vs write capabilities

**Reads (TeamKey):** everything in §3.3–3.7. Pagination: `view` ≤500/page, `patients` fixed 30/page, adapters ≤100.

**Writes (TeamKey): one endpoint, `POST /api/sites/{site}/actions`**, body = `Action`:
```json
{ "type": "<one of 43>", "patientId"?: "SIM-…", "title"?: "…", "text"?: "…", "target"?: "<site>",
  "resourceId"?: "…", "expectedVersion"?: 3, "clientRequestId"?: "<uuid>", ...type-specific fields }
```
Creation payloads (as the UI sends them): `{type, patientId, title, target}`. Updates: `{type, resourceId, expectedVersion, target?}`. Responses return the resulting `Resource`. `type` enum, grouped:

| Group | Types | Site(s) | Key fields |
| --- | --- | --- | --- |
| **Sharing / visibility** | `share_record` | gp, hospital (UI: "Share with hospital" / "Send to GP") | `resourceId, expectedVersion, target` (service to add to `visibleTo`) |
| Tasks & referrals | `create_task`, `create_referral`, `review`, `accept`, `reject`, `complete` | gp, hospital, community, referrals | `patientId, title, text?` / `resourceId, expectedVersion` |
| **Appointments** | `create_appointment_session`, `book_appointment`, `set_appointment_slot`, `arrive_appointment`, `cancel_appointment`, `complete` | gp | book: `sessionId, sessionVersion, startsAt, patientId, title`; session: `title, clinician, location, startsAt, endsAt, slotMinutes, mode`; slot: `resourceId, expectedVersion, startsAt, slotCommand: block|unblock, text` |
| GP record | `save_consultation` (`title,text,mode,consultationStatus: draft|saved`), `save_problem` (`title, problemStatus, problemCode?, onsetDate?`), `save_allergy` (`title, allergyStatus, reaction?`) | gp | edits need `resourceId, expectedVersion` |
| **Labs** | `order_test` (`bloodTestOrder`), then `review` when `available` | gp, hospital | result lands after 120 min (`now`) / 240 min (`next-round`) of sim time |
| Medicines | `draft_prescription` (`medicationOrder`), `link_prescription_stock`, `review`, `accept`, `dispense`, `collect` | gp/hospital → pharmacy | |
| **Messaging** | `messaging_action` + `messagingCommand.kind ∈ create|send|reply|note|assign|complete|reopen|delivery|retry|save_template|archive_template` | gp (staff) and **`patient` (reply only)** | create: `patientId, {subject, body, channel: sms|email, allowReply}`; delivery: `{entryId, status: delivered|failed}` — messages are *queued* until you mark them delivered |
| Legacy generic | `send_message` (generic, older) | | |
| **Home / wearables** | `connect_device` (`patientId, title:"Home activity watch"`) | wearables | first reading after 10 min, then hourly |
| Community | `schedule_visit` (`patientId, title`), `complete`, `dispatch_robot`, `report_absence`, `restore_staff`, `allocate_shift` | gp/hospital/community | visit due +90 min; capacity-limited (409 when exhausted) |
| Hospital | `hospital_note` (`hospitalNoteCommand: save|sign|addendum`), `save_discharge_summary` (`dischargeSections`), `process_document` (`documentCommand: send|assign|review|file|annotate`), `register_attendance` (`acuity, location, clinician?`), `update_attendance` (`hospitalCommand: assign|assess|refer|admit|discharge`, `disposition`) | hospital, gp | |
| Pharmacy ops | `receive_pharmacy_referral`, `update_pharmacy_referral`, `place_pharmacy_order`, `update_pharmacy_basket`, `remove_pharmacy_basket_line`, `checkout_pharmacy_basket`, `cancel_pharmacy_order`, `receive_pharmacy_order`, `receive_stock`, `update_stock_price` | pharmacy | |

Concurrency & retries: send the resource's current `version` as `expectedVersion` (409 on stale); send `Idempotency-Key` (or `clientRequestId` UUID) and reuse it only for identical retries (changed payload + same key ⇒ 409).

**Cannot do with a TeamKey:** toggle incidents/agents, read other worlds, delete anything, edit demographics (PDS is read-only), write FHIR, create patients (population is operator-seeded), define consent or family members.

---

## 6. Events, notifications, scenario triggers

* **No webhooks, SSE, or WebSocket event stream** ("there is no separate event-stream endpoint" — spec). The only WS is telephony.
* **Poll** `GET /api/clock` (≤100 latest `events`, cheap) and/or `GET /api/sites/gp/view?patient=…` (`events` + `resources`); the official UI polls every 3 s. Diff by `event.id` to detect new events → our own notifier (push/SMS/email/in-app) is where "proactive alerts to family" happens.
* **Time is the trigger.** `POST /api/clock {"paused":true,"advanceMinutes":N}` executes due jobs deterministically. Demo-able scripted scenarios with only a TeamKey:
  * Order bloods (`order_test`, `collection:"now"`) → advance 121 min → result `available` in `/api/sites/diagnostics/view?patient=` → agent explains it in plain language and alerts family (if consented).
  * `connect_device` → advance 15 min → first `observation`; advance +60 min repeatedly for hourly readings (values can be `null`/`quality:"missing"` if the operator toggled `wearable-disconnect`; we can also just synthesise a gap).
  * `book_appointment` on a real GP session slot (read sessions via `/api/sites/gp/appointments?date=`) → advance towards `startsAt` → agent reminds patient/family → `arrive_appointment`/`complete`/`cancel_appointment`.
  * Hospital `save_discharge_summary` → `process_document send` → letter appears in GP inbox → agent summarises "what happens next" (`followUp`, `gpActions`, `medicationChanges`).
  * `messaging_action create` (SMS from practice) → `delivery delivered` → shows in patient Messages → `patient` site `reply`.
  * `schedule_visit` → advance 91 min → visit `completed`.
* **Incidents** (`pathology-outage`, `staff-shortage`, `robot-failure`, `demand-surge`, `wearable-disconnect`, `winter-pressure`, `pharmacy-shortage`, `cyber-readonly`) and **scripted world agents** need the operator token. The `View` schema has optional `faults{}` and `agents[]` fields (the organiser panel reads them from a site view); if they are populated for a team key too, the agent can explain "the pathology feed is down, your result is delayed" when an organiser flips one — verify with your first `GET /api/sites/gp/view?limit=1`.
* Clock speed: `speed` 0–3600× lets a running world "live" during a demo without manual stepping.

---

## 7. Gaps — what we must build/mock ourselves

| Need | Sim provides | We build |
| --- | --- | --- |
| **Consent model** (patient decides who sees which categories) | Only service-level `visibleTo` + `share_record`; no consent resource, no categories, no grantee identities | Own consent store: `patientId → grantee (family member / clinician) → categories {appointments, labs, medications, conditions, messages, home_readings, documents} → allow/deny + expiry + audit log`. Interpretability = every alert cites the consent rule that permitted it. |
| **"Sync consent to the EHR"** | No consent write | Materialise the decision into the sim so clinicians can see it: e.g. `save_consultation` / `create_task` titled "Consent: Eleanor allows daughter to view appointments & labs (not messages)" in the GP record, and use `share_record` to mirror service-level sharing where it maps (gp↔hospital). Show the resulting `provenance` as the audit trail. |
| **Family members / RelatedPerson** | None (only `care-plan.carerAvailable`) | Own registry of fictional relatives per patient (name, relationship, contact channel, proxy role). |
| **Push notifications** | None; poll only | Poller (every few seconds during demo) → diff events → notification service (in-app feed, optional SMS/email/WhatsApp mock). |
| **Plain-language explanation of results** | Raw analytes + synthetic reference intervals | LLM step over `test.data` (+ `ehr-record.data.medications/problems` for context) with strict "no clinical advice" framing. |
| **Patient identity / login for family app** | None | Simple fake auth; map app users → grantee ids. |
| **Triggering disruptions** (e.g. device disconnect) | Operator-only | Either ask organisers to flip `wearable-disconnect` for our world, or simulate a gap by not advancing / synthesising a missing reading in our layer. |
| **Real appointment booking availability for the *hospital*** | Appointment book is GP-only (`site=gp`) | Hospital "appointments" can be modelled as GP sessions with a hospital clinician/location, or as `referral`/`task` resources with `dueAt`. |
| **Observation types** | Only activity (steps/day), pulse (bpm), sleep (h) | If we need BP/glucose/weight for a chronic-disease story, add them in our layer (or map: `hba1c` lab panel = diabetes control). |
| Reliability | Occasional 502 | Retry w/ backoff; cache last-good view. |

---

## 8. Recommended tools to expose to the agent (MCP server / tool layer)

All backed by `https://sim.animahealth.com` with `Authorization: Bearer $SIM_KEY`. Every tool that returns patient data should pass through our consent filter when the caller is a family member.

| Tool | Inputs | Output | Backing call(s) |
| --- | --- | --- | --- |
| `find_patient` | `query` (name / SIM id / condition) | `Patient[]` | `GET /api/sites/gp/patients?q=` |
| `get_patient_summary` | `patientId` | demographics + `ehr-record.data` (problems, medications, allergies) + FHIR `Patient` (address/telecom/GP) | `GET /api/sites/gp/view?patient=` (filter `kind==="ehr-record"`), `GET /api/nhs/pds/Patient/{id}` |
| `get_patient_view` (patient-safe) | `patientId`, `kinds?` | resources the *patient portal* may see | `GET /api/sites/patient/view?patient=` |
| `get_upcoming_appointments` | `patientId`, `fromDate`, `days` | appointments with `startsAt`, clinician, location, mode, status | `GET /api/sites/gp/appointments?date=` per day (or `GET /api/nhs/appointments?patient=`) |
| `find_free_slots` | `date`, `clinician?`, `mode?` | free slots from sessions | `GET /api/sites/gp/appointments?date=` → `sessions` minus booked/blocked |
| `book_appointment` | `patientId, sessionId, sessionVersion, startsAt, reason` | `Resource` | `POST /api/sites/gp/actions {type:"book_appointment", …}` |
| `cancel_appointment` / `mark_arrived` | `resourceId, expectedVersion` | `Resource` | `cancel_appointment` / `arrive_appointment` |
| `get_lab_results` | `patientId`, `panelId?` | tests with status, `dueAt`, measurements | `GET /api/sites/diagnostics/view?patient=` (or `/api/nhs/pathology?patient=`) |
| `explain_result_plain_language` (our LLM tool) | `test resource`, `ehr-record`, audience (patient/family) | explanation + "next actions" + citations of which fields were used | none (LLM) |
| `order_blood_test` | `patientId, panelId, collection, clinicalDetails` | `Resource` | `POST /api/sites/gp/actions {type:"order_test", bloodTestOrder}` |
| `get_medications` | `patientId` | current/previous meds + live prescriptions & pharmacy status | `ehr-record.data.medications` + `GET /api/nhs/eps-tracker?patient=` |
| `get_home_readings` | `patientId, period(day/week)` | observations by metric, flags for `missing` | `GET /api/sites/wearables/view?patient=` |
| `connect_home_device` | `patientId` | device `Resource` | `POST /api/sites/wearables/actions {type:"connect_device", title:"Home activity watch"}` |
| `get_conversations` (patient-side) | `patientId` | delivered practice messages | `GET /api/sites/patient/messaging-workspace?patientId=` |
| `send_practice_message` | `patientId, subject, body, channel, allowReply` then `deliver` | conversation `Resource` | `POST /api/sites/gp/actions {type:"messaging_action", messagingCommand:{kind:"create"…}}` then `{kind:"delivery", entryId, status:"delivered"}` |
| `reply_as_patient` | `patientId, resourceId, expectedVersion, body` | `Resource` | `POST /api/sites/patient/actions {type:"messaging_action", messagingCommand:{kind:"reply", body}}` |
| `get_documents` | `patientId` | discharge letters + stage, `followUp`, `gpActions` | `GET /api/sites/gp/documents`, `GET /api/sites/hospital/documents` |
| `get_care_plan_and_visits` | `patientId` | care-plan (`carerAvailable`, `homeAccessConfirmed`), visits | `GET /api/sites/community/view?patient=` |
| `share_record_with_service` | `resourceId, expectedVersion, target` | `Resource` (new `visibleTo`) | `POST /api/sites/{owner}/actions {type:"share_record", target}` |
| `record_consent_in_ehr` (our composite) | `patientId, decision` | GP task/consultation resource with provenance | `create_task` / `save_consultation` (+ `share_record` where applicable) |
| `create_task` | `patientId, title, text` | `Resource` | `POST /api/sites/gp/actions {type:"create_task"}` |
| `get_sim_time` / `advance_time` | — / `minutes` | `Clock` (+ new events) | `GET/POST /api/clock` (`{paused:true, advanceMinutes}`) |
| `poll_events` | `sinceEventId?`, `patientId?` | new `Event[]` | `GET /api/clock` (diff) — feeds the proactive-alert engine |
| `get_world_status` | — | `staffing`, `population`, `now/paused/speed`, plus `faults`/`agents` if present for team keys | `GET /api/sites/gp/view?limit=1` |

Implementation notes: one thin client with retry, `Idempotency-Key = uuid` on every action, auto-refetch on 409 then re-apply with the fresh `version`. Keep the team key server-side only.
