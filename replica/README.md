# Local Anima simulator database replica

This copies data exposed to our team key into a separate local PostgreSQL database. It preserves original resource JSON, per-service visibility projections, patient demographics, patient directory fields, accessible events and endpoint responses.

It is **not a dump of the simulator's internal PostgreSQL schema**. The organiser-only snapshot returned 403. Hidden jobs, private operator tables and complete historical event logs are outside this key's access.

## Use the database

```sh
psql -d anima_sim_replica_20260912
```

The database uses the running local PostgreSQL server. The importer defaults to the local Unix socket `/tmp`; set `PGHOST`, `PGUSER` and normal PostgreSQL environment settings if needed. `REPLICA_DATABASE` selects another database.

The [SQL examples](queries.sql) cover patient search, carer needs, clinical records, source-backed relative mentions and coverage.

| Table/view | Contents |
| --- | --- |
| `sim.patients` | Patient directory JSON plus full PDS/FHIR demographic JSON |
| `sim.patient_directory` | Queryable name, date of birth, conditions, needs, goals, addresses and contacts |
| `sim.patient_conditions`, `sim.patient_needs` | One condition/need per patient row |
| `sim.resource_projections` | Every retrieved resource as seen by each service; original JSON, version, source and patient ID |
| `sim.resources` | One selected copy per resource ID: highest version, then owning service, then fuller staff projection. Original projections remain available |
| `sim.ehr_problems`, `sim.ehr_medications`, `sim.ehr_allergies` | Detailed EHR collection entries |
| `sim.lab_results` | Individual GP-visible lab analytes with source report and panel |
| `sim.appointments` | Appointment times, clinician, mode and original record |
| `sim.organizations` | Captured ODS organisations |
| `sim.legacy_documents` | Text exposed by the legacy browser table |
| `sim.events` | Events actually returned by accessible endpoints; not a complete event history |
| `sim.endpoint_responses` | Extra workspaces/adapters, capability statements, discovery documents and recorded access errors |
| `sim.import_pages` | Imported page counts and source offsets, committed with data for safe resume |

All identity keys include `world_id`. Simulator patient/resource IDs alone are not globally unique across team worlds. Relationships and consent belong in a separate application schema; nothing here turns matching names/addresses into family membership.

## Local API

```sh
node replica/server.mjs
```

Open [replica coverage](http://localhost:4180/replica/coverage). The API binds to loopback and supports these read routes:

- `/api/team` and `/api/clock`
- `/api/sites/{site}/patients?q=…&offset=…`
- `/api/sites/{site}/view?patient=…&limit=…&offset=…`
- `/api/sites/{site}/appointments?date=YYYY-MM-DD`
- `/api/nhs/pds/Patient` and `/api/nhs/pds/Patient/{id}`
- Exact additional endpoint/query combinations stored in `sim.endpoint_responses`

Responses come from the local database. No writes are forwarded upstream. This is a development data API, not a patient/family authentication or consent service. Search and sort behaviour are local implementations, not a claim to reproduce every simulator behaviour. The patient-specific view retains service resources without a patient ID, as the source does.

The API can be consumed by the ADK/tool layer by changing its simulator base URL to `http://localhost:4180`. Mutation workflows need a separately implemented local engine or the real simulator; the replica does not execute simulation jobs.

## Create or resume a capture

From the repository root:

```sh
npm install --prefix replica
createdb anima_sim_replica_20260912
psql -d anima_sim_replica_20260912 -v ON_ERROR_STOP=1 -f replica/schema.sql
node --env-file=.env.local replica/import.mjs
node --env-file=.env.local replica/supplement.mjs
node replica/discover.mjs
node replica/verify.mjs
```

Skip `createdb` for the existing database. `.env.local` holds `SIM_API_KEY` and is ignored by Git. The importer retries temporary network errors with backoff, stops repeated failure runs and resumes pages already committed. It never modifies the upstream clock or clinical records. The supplement creates only a documented browser authentication session to read the legacy page; it does not submit transfer forms.

The first local capture reused the complete, validated same-day PDS pages already downloaded for the address audit. This requires the explicit `REUSE_PDS_CAPTURE=1` option and the matching researched world. Missing cached pages are fetched normally.

Imported pages are retained as compressed original responses under ignored `replica/data/`. Cookies and CSRF secrets are not needed for the replica; CSRF form values in the legacy HTML are redacted.

The importer resumes an interrupted capture; it is not a continuous synchronizer and does not refresh pages already completed. Use a new database for a fresh full capture. The source does not offer transactional snapshot isolation through its API, so no multi-request export can guarantee a single instant across concurrent edits.

## Backup and restore

Use a `pg_dump` version at least as new as the running server. This machine has PostgreSQL 18 running:

```sh
/opt/homebrew/opt/postgresql@18/bin/pg_dump -Fc --no-owner --no-acl \
  -d anima_sim_replica_20260912 -f replica/data/anima_sim_replica_20260912.dump

# Restore into a new database:
createdb anima_sim_restored
/opt/homebrew/opt/postgresql@18/bin/pg_restore --no-owner --no-acl \
  -d anima_sim_restored replica/data/anima_sim_replica_20260912.dump
```

See [verification results](../docs/research/replica-verification.json) for actual counts and remaining gaps, and [endpoint discovery](../docs/research/frontend-endpoints.json) for the browser-facing API map. A verification file is not a replacement for checking the database itself.
