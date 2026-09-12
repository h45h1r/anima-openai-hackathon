# Anima NHS-SIM integration cheat sheet (CareCircle)

Researched 12 Sep 2026 against the live hosted sim. Labels: **[V]** verified by a real request, **[D]** documented only (docs / OpenAPI), **[X]** not documented / not verified.
Sources: https://sim.animahacks.com/docs/ (handbook JSON at /docs/handbook.json), /api/openapi.json (71 paths), GP web bundle, live probes in a scratch world `carecircle-probe-9f7a3a` (not our team world).

## 1. Base URL, auth, isolation

- Base URL: `https://sim.animahacks.com`. `https://sim.animahealth.com` (the host in our `.env`) is the **same deployment** [V]: our key returned the same `world` on both. `/control/` is the neighbourhood map SPA (React, no API of its own).
- Our key (`.env` `ANIMA_SIM_API_KEY`) → `GET /api/team` = `{"team":"team-5","world":"team-8942268fa18a","scopes":["gp","hospital","community","pharmacy","diagnostics","referrals","wearables"]}` [V].
- Auth header: `Authorization: Bearer <apiKey>` (OpenAPI scheme `TeamKey`). Bad key → `401 {"error":"Get a team API key at POST /api/keys"}` [V].
- Key creation is public, no throttle: `POST /api/keys {"teamName":"..."}` → `201 {"apiKey":"sim_...","team","teamName","world","scopes":[...],"created":true}` [V]. Name is lowercased with whitespace removed and acts as a **join code**: anyone entering the same name joins the same world and gets the same key. Use a distinct name for scratch worlds.
- Isolation: one key = one world. Population baseline (50,000 patients) is shared read-only; every write (orders, tasks, messages, reviews) is stored per world. Team keys cannot pass `?world=` (operator only) [D]. Operator endpoints (`/api/control/*`) need `OPERATOR_TOKEN` we do not have.
- Timestamps everywhere are **simulation Unix ms**. World starts paused at `now = 1789200000000` = 2026-09-12T08:00Z, `speed: 60` [V].
- Host was intermittently returning `502` (Caddy, empty body) during research; build retries (5 x 5s) into every call [V].

## 2. Endpoints with real request/response shapes

### List / search patients
`GET /api/sites/gp/patients?q=<text>&offset=<n>` → `{"total":50000,"items":[Patient x30]}` [V]. Fixed page size 30, `offset` only. `q` matches name, SIM id, condition, need, goal (prefix/full-text). No filter by result state. `q=liver` → total 0 (population `conditions` arrays are mostly empty) [V].
```json
{"id":"SIM-000031","name":"Priya Reed","birthDate":"1977-09-03","localIds":{"gp":"RIV-30","legacy":"WH-90030","hospital":"NBG-10030"},"conditions":[],"needs":[],"goals":["Understand the next step","Avoid unnecessary travel"],"synthetic":true}
```
FHIR alternative: `GET /api/nhs/pds/Patient?family=Khan&_count=100&_offset=0` (Bundle searchset, follow `next` link) and `GET /api/nhs/pds/Patient/SIM-000001` [D].

### Patient full view
`GET /api/sites/{site}/view?patient=SIM-000001&limit=500&offset=0` with site ∈ gp | hospital | diagnostics | community | pharmacy | referrals | wearables | patient [V].
Response: `{id, now, speed, paused, population, counters{}, resources[], resourceTotal, resourceOffset, resourceLimit, staffing, faults, events[], agents}`. Unknown patient id → **200 with no patient resources, not 404** [V].
Resource envelope (every kind): `{id, patientId, kind, title, status, owner, visibleTo[], priority, createdAt, dueAt, data{}, version, provenance{created{actor{kind,name},source,action,time,version}, changes[]}}`.
Kinds seen for SIM-000001 in gp view [V]: `report` x36 (labs), `appointment-session` x42, `encounter`, `observation`, `ehr-record` (problems/allergies/miscCodes), `task`, `appointment`, `conversation`, `message-template`, `discharge-summary`, `capacity`, `telephone-call`. Hospital view adds `prescription`, `hospital-attendance`, `bed`, `document`.

### Lab results and trends
Seeded history: `kind:"report"`, `owner:"diagnostics"`, `status:"available"`, `visibleTo:["gp","hospital","diagnostics"]`, id pattern `blood-v1-SIM-000001-lft-0 … -5` (6 panels fbc/ue/hba1c/lft/crp/lipids x 6 dates = 36 per patient) [V]. Trend = group by `data.panel.id` + analyte `id`, sort by `data.collectedAt`.
```json
{"id":"blood-v1-SIM-000001-lft-0","kind":"report","status":"available","owner":"diagnostics","version":1,"patientId":"SIM-000001",
 "data":{"kind":"blood-result","panel":{"id":"lft","name":"Liver function tests (LFT)"},"collectedAt":1778832000000,"laboratory":"Northbank training laboratory","synthetic":true,
  "analytes":[{"id":"alt","name":"ALT","unit":"U/L","value":22,"referenceLow":0,"referenceHigh":40},{"id":"alp","name":"Alkaline phosphatase","unit":"U/L","value":78,"referenceLow":30,"referenceHigh":130},{"id":"bilirubin","name":"Bilirubin","unit":"µmol/L","value":17,"referenceLow":0,"referenceHigh":21},{"id":"albumin","name":"Albumin","unit":"g/L","value":39,"referenceLow":35,"referenceHigh":50}]}}
```
**Lazy seeding gotcha [V]:** a patient's 36 reports only exist after that patient's record has been opened once (any `view?patient=SIM-x` call, even `limit=1`). Counter `bloodPatient:SIM-x: 1` appears in `view.counters` afterwards. In our team world only SIM-000001 and SIM-000006 were materialised at research time.
`GET /api/nhs/pathology?patient=SIM-000001` returned `total: 0` even for a materialised patient [V]; do not rely on it. Use the site views.

### Order a test (LFT)
`POST /api/sites/gp/actions` (hospital site also works [D]) with header `Idempotency-Key: <uuid>`:
```json
{"type":"order_test","patientId":"SIM-000003","title":"Liver function tests",
 "bloodTestOrder":{"panelId":"lft","panel":"Liver function tests (LFT)","specimen":"Serum","priority":"routine","collection":"now","clinicalDetails":"LFT monitoring."}}
```
→ `200` `{"id":"r-3831","kind":"test","status":"open","owner":"diagnostics","visibleTo":["diagnostics","gp","patient"],"version":1,"createdAt":1789200000000,"dueAt":1789286400000,"data":{"bloodTestOrder":{...},"text":"..."}}` [V]. Panel ids: `fbc ue hba1c lft crp lipids`; `priority` routine|urgent; `collection` now|next-round.
**The result lands on the same `test` resource** (no new `report` is created) [V]: status `open` → `available`, `version` 2, `data` gains `kind:"blood-result"`, `panel`, `analytes[]` (same shape as above), `report:"Synthetic result ready for review. No clinical decision implied."`, `collectedAt`; `provenance.changes` gains `{actor:{kind:"simulation",name:"laboratory"},action:"result.available",source:"diagnostics"}`. `dueAt` on the order is +24h and is **not** the result time; ignore it.
Detect a new result: poll `GET /api/sites/gp/view?patient=SIM-x` (or diagnostics) for `kind in (test, report)` with `data.analytes` and `status == "available"`, or scan `GET /api/clock` `events[]` for `type:"result.available"` (`resourceId`, `patientId`, `detail` = order title) [V].

### Advance the clock
`POST /api/clock {"paused":true,"advanceMinutes":121}` → `200 {"now":1789207260000,"paused":true,"speed":60,"events":[...]}` [V]. `advanceMinutes` 0–10080, `speed` 0–3600. Docs say advancing an unpaused clock returns 409 [D]; our world was already paused so `{"advanceMinutes":121}` alone also worked [V]. Always send `paused:true`. `GET /api/clock` returns the latest 100 visible events (newest first) [V].

### Appointments
`GET /api/sites/gp/appointments?date=2026-09-12` (UTC date required) → `{"sessions":[appointment-session...],"appointments":[appointment...],"patients":[{id,name}]}` [V]. Session `data`: `{clinician, location, mode, startsAt, endsAt, slotMinutes, blockedSlots:[{startsAt,reason}]}`; slot grid = startsAt + k*slotMinutes. Historical population appointments have `status:"unknown"`.
Book: `POST /api/sites/gp/actions {"type":"book_appointment","sessionId":"appointment-session-1789218000000-0","sessionVersion":1,"startsAt":1789219800000,"patientId":"SIM-000003","title":"Discuss LFT result"}` → `200 {"id":"r-4004","kind":"appointment","status":"booked","visibleTo":["gp","patient"],"data":{"startsAt","durationMinutes":15,"clinician":"Dr Maya Shah","mode":"in-person","sessionId":...}}` [V]. Same slot again → `409 {"error":"Clinician already has an overlapping appointment"}` [V]. `arrive_appointment`, `complete`, `cancel_appointment` take `resourceId` + `expectedVersion` [D]. Create sessions with `create_appointment_session` (`title, clinician, location, startsAt, endsAt, slotMinutes, mode`) [D].

### GP task
`POST /api/sites/gp/actions {"type":"create_task","patientId":"SIM-000003","title":"Confirm patient informed of LFT result","text":"..."}` → `200 {"id":"r-3995","kind":"task","status":"open","owner":"gp","visibleTo":["gp","patient"],"dueAt":<now+24h>,"data":{},"version":1}` [V]. Tasks show in GP Records and in the activity trail (`GET /api/clock` event `type:"create_task"`). `GET /api/nhs/gp-connect?patient=SIM-x` gives the same tasks as FHIR-ish `Task` [V]. Progress with `review` / `accept` / `complete` + `resourceId` + `expectedVersion` [D, UI code]. Unknown `resourceId` → `404 {"error":"Unknown resource"}` [V].

### Mark a result reviewed (GP review)
`POST /api/sites/diagnostics/actions {"type":"review","resourceId":"blood-v1-SIM-000003-lft-2","expectedVersion":1}` → `200` same resource with `status:"reviewed"`, `version:2`, `provenance.changes[+]={actor:{kind:"team",name:"<team>"},source:"diagnostics",action:"review"}` [V].
- Must be sent to the **diagnostics** site (resource owner). Same body to `/api/sites/gp/actions` → `403 {"error":"Only owning service may change this record"}`; patient site → `403 {"error":"Record not visible to this service"}` [V]. Our key has diagnostics scope.
- Stale version → `409 {"error":"Stale resource version"}`; reviewing an already reviewed result → `409 {"error":"Invalid lifecycle transition"}` [V]. Applies to ordered `test` resources too once `available` (UI offers "Mark reviewed" for status open/draft/available) [V from GP bundle].
- Nothing else is stored: no `reviewedBy`/`reviewNote` on results (those fields exist only on discharge documents).

### Patient SMS / email
Create: `POST /api/sites/gp/actions {"type":"messaging_action","patientId":"SIM-000003","messagingCommand":{"kind":"create","subject":"Your recent blood test","body":"...","channel":"sms","allowReply":true}}` → `200 {"id":"r-3997","kind":"conversation","status":"open","visibleTo":["gp","patient"],"data":{"assignee":"","allowReply":true,"entries":[{"id":"r-3997-1","direction":"outgoing","body","channel":"sms","at","actor":{kind,name},"delivery":[{"status":"queued","at","actor"}]}]}}` [V].
Deliver (nothing is delivered until you do this): `{"type":"messaging_action","resourceId":"r-3997","expectedVersion":1,"messagingCommand":{"kind":"delivery","entryId":"r-3997-1","status":"delivered"}}` → entry `delivery` gains `{"status":"delivered"}` [V]. `status:"failed"` + `kind:"retry"` also exist [D].
Other commands [D]: `send` (`body, channel`) adds an entry to an existing conversation; `note`, `assign`, `complete`, `reopen`, `save_template`, `archive_template`. Patient-side reply: `POST /api/sites/patient/actions {"type":"messaging_action","patientId","resourceId","expectedVersion","messagingCommand":{"kind":"reply","body"}}`.
Read: `GET /api/sites/gp/messaging-workspace` (all conversations + templates) and `GET /api/sites/patient/messaging-workspace?patientId=SIM-000003` → `{"resources":[conversation...],"patients":[...]}`; the patient view only shows delivered entries [V].

### Activity / audit
- `GET /api/clock` → `events[]` (max 100, newest first): `{id, time, type, actor, resourceId?, patientId?, detail, visibleTo[]}`; `type` is the action name (`order_test`, `result.available`, `review`, `create_task`, `messaging_action`, `book_appointment`, `clock.changed`) and `actor` is the team name or a simulation agent (`laboratory`, `patient-demand`, `acute-flow`) [V]. Also returned inside every `view` response (`events`) and in the `POST /api/clock` response.
- Per-resource audit: `provenance.created` + `provenance.changes[]` with actor, action, sim time, version [V].
- Full request log (`GET /api/control/teams/{world}/activity`, 2,000 requests / 7 days) is **operator-only** [D]. `GET /api/control/snapshot` (whole world) is operator-only [D].

### Population / list-all endpoints
- `GET /api/sites/gp/patients` pages the whole 50,000 directory at 30 per page (1,667 calls) [V]. No server-side filter on results.
- `GET /api/sites/{site}/view?limit=500&offset=N` without `patient` lists **every visible resource in the world**, paged by 500 (`resourceTotal` in gp view was 374,628 in our world; diagnostics view lists only diagnostics-visible resources, i.e. exactly the materialised lab results + a capacity row) [V]. One 500-row diagnostics page fetched in ~0.15 s (490 KB) [V].
- Operator-only: `GET /api/control/worlds`, `/api/control/teams`, `/api/control/snapshot`, `POST /api/control/population*` [D].
- No aggregate, count, or filter endpoint exists [X].

## 3. Result timing and abnormality representation

- Result appears exactly **120 simulation minutes** after `order_test` with `collection:"now"` (order at 1789200000000, `result.available` at 1789207200000) [V]; docs say 240 min for `next-round` [D]. Docs' worked example advances 121 min. A pathology "incident" (organiser-triggered) can hold results [D].
- Abnormality is **not flagged by the API**. Each analyte carries `value`, `referenceLow`, `referenceHigh`, `unit`; the GP UI computes `value < referenceLow → "Low"`, `value > referenceHigh → "High"` [V from bundle]. No priority/critical flag, no comment beyond the fixed `report` sentence. Reference intervals are illustrative only.
- Synthetic values are noisy: in a scan of 497 materialised results, 310 had at least one analyte outside its interval. Define "abnormal" tightly (e.g. specific LFT analyte, or > X% outside range) or the population number will be ~60% of everything.

## 4. "Patient informed / communicated" state

**None.** Results have only `status` (`open` → `available` → `reviewed`) and provenance. `review` records GP review by the acting team; it does not record patient contact. The only patient-facing evidence the sim can hold is a `conversation` entry with `delivery` status `delivered` (and a patient `reply`), which is a separate resource with no link to the result. CareCircle must own `patient_disclosure_status` itself and, if we want it inside Anima, encode it as a task title/text or a conversation, both of which appear in the activity trail.

## 5. Versioning, idempotency, conflicts

- Every mutation on an existing resource needs `resourceId` + `expectedVersion` (current `version`). Wrong version → `409 {"error":"Stale resource version"}`; wrong state → `409 {"error":"Invalid lifecycle transition"}` [V]. Re-read the resource after any 409. No ETag / If-Match headers; version is body-only [D].
- Idempotency **only works with a UUID**: `Idempotency-Key: <uuid>` header and/or `clientRequestId: <uuid>` in the body. Replay returns the same resource id; same key with a different body → `409 {"error":"Idempotency key reused with different action"}` [V]. A non-UUID key (`probe-lft-1`) was silently ignored and created three duplicate orders [V]. Header wins if both are present [D]. The body field is schema-validated as a UUID (v1–v8); use `crypto.randomUUID()` / `uuid4()`.
- Actions are cross-site: order/task from `gp`, result review on `diagnostics`, prescription lifecycle on `pharmacy`. Sending to the wrong site → `403 Only owning service may change this record`.
- Actions are attributed to the team name of the key, not a user; nothing lets us set a clinician identity on a review [D].

## 6. Rate limits, pagination, gotchas

- No documented per-key rate limit; only the 5,000-team cap (429) and body-size 413 [D]. Observed: single patient view ~0.3–2 s, 20 first-open patient views took 46 s sequentially (~2.3 s each because of lazy lab seeding); a 500-row view page ~0.15 s [V]. The host intermittently returned 502 for minutes at a time; retry with backoff and never rely on one call.
- Pagination: patients fixed 30/page via `offset`; views `limit` 1–500 + `offset` with `resourceTotal`; NHS adapters cap at 100 rows [D]; FHIR `_count` ≤ 100 with `next` links [D].
- `view?patient=` also returns service-wide resources without a patient (capacity rows, sessions, templates); filter by `patientId` client-side.
- Unknown patient in `view` returns 200 with no patient resources; check `items[0]` from `/patients?q=` first if you need existence.
- The team world may already be time-shifted by teammates using the UI; read `GET /api/clock` before assuming `now`. Clock advances process *all* scheduled jobs (A&E arrivals, requests) and the event list fills with simulation noise; filter by `actor == <team name>` or `type`.
- The SPA saves the key in localStorage; the docs explorer clears auth on reload. `sim_session` cookie flow (`POST /api/session`) is only needed for `/browser/legacy`.
- Error body is always `{"error": "..."}` (FHIR routes: `OperationOutcome`).

## 7. Counting across the population

Feasible, but only over **materialised** patients, and only client-side:
1. Materialise: `GET /api/sites/gp/view?patient=SIM-xxxxxx&limit=1` for each patient you want in the scan (seeds 36 reports; ~2.3 s each sequential, parallelise 8–10 ways). 1,000 patients ≈ 4–8 min in parallel; all 50,000 is out of reach for the hackathon (~30 h sequential).
2. Scan: page `GET /api/sites/diagnostics/view?limit=500&offset=N` until `offset >= resourceTotal` (36 rows per patient, so 1,000 patients = 72 pages ≈ 15 s). Keep `kind in (report, test)` with `data.analytes`, compute out-of-range per analyte, and treat `status != "reviewed"` as unreviewed. Everything is unreviewed until someone reviews it, so pair the count with a time-based rule (e.g. `collectedAt` older than N sim days and no `review` change in `provenance.changes`).
3. Present it honestly: "of the N patients whose records are open in this neighbourhood, X have an out-of-range result with no GP review and no delivered message", and say the sample is the opened cohort. Alternatively extrapolate the observed rate to 50,000 and label it as an extrapolation.
There is no bulk export, no `status`/`kind` filter parameter, and no count endpoint [X]. The operator `snapshot` would give the whole world but needs the organiser token.

## Minimal happy path (all verified)
```bash
O=https://sim.animahacks.com; K=$ANIMA_SIM_API_KEY; P=SIM-000001; A="Authorization: Bearer $K"
curl -s "$O/api/sites/gp/view?patient=$P&limit=500" -H "$A"                      # materialise + read history
curl -s -X POST "$O/api/sites/gp/actions" -H "$A" -H 'Content-Type: application/json' -H "Idempotency-Key: $(uuidgen)" \
  -d '{"type":"order_test","patientId":"'$P'","title":"Liver function tests","bloodTestOrder":{"panelId":"lft","panel":"Liver function tests (LFT)","specimen":"Serum","priority":"routine","collection":"now","clinicalDetails":"Liver monitoring"}}'
curl -s -X POST "$O/api/clock" -H "$A" -H 'Content-Type: application/json' -d '{"paused":true,"advanceMinutes":121}'
curl -s "$O/api/sites/diagnostics/view?patient=$P&limit=500" -H "$A" | jq '.resources[] | select(.kind=="test" and .status=="available")'
curl -s -X POST "$O/api/sites/gp/actions" -H "$A" -H 'Content-Type: application/json' -H "Idempotency-Key: $(uuidgen)" \
  -d '{"type":"create_task","patientId":"'$P'","title":"Confirm patient informed of LFT result","text":"CareCircle gate held"}'
curl -s -X POST "$O/api/sites/diagnostics/actions" -H "$A" -H 'Content-Type: application/json' -H "Idempotency-Key: $(uuidgen)" \
  -d '{"type":"review","resourceId":"<test id>","expectedVersion":2}'
```
