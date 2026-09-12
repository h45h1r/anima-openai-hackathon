# Local simulator app

The original simulator screens run against a separate, writable PostgreSQL database. Open [the local app](http://localhost:4192/control/).

## Run

```sh
npm install --prefix sim-app
npm start --prefix sim-app
```

The server binds to `127.0.0.1:4192`. It uses database `anima_sim_app_20260912` through the PostgreSQL socket at `/tmp`. Set `PORT`, `APP_DATABASE`, or `PGHOST` to override those defaults. The archived replica database is rejected as an app target.

The app database has already been restored locally. On a new machine, restore the ignored capture dump into a new database first:

```sh
createdb anima_sim_app_20260912
pg_restore --no-owner --no-acl -d anima_sim_app_20260912 replica/data/anima_sim_replica_20260912.dump
```

Use PostgreSQL 18 tools for the existing dump. The source dump is not included in Git; see [replica setup](../replica/README.md) to obtain a new API-visible capture. Starting the app creates its local clock, job, settings and idempotency tables. It preserves existing edits.

To start fresh, restore into another new database and pass its name as `APP_DATABASE`. Do not drop the working database to reset a demo.

## Screens and workflows

| Screen | Route | Local behavior |
| --- | --- | --- |
| Neighbourhood | `/control/` | Original map, videos, app launcher and simulation clock |
| GP Records | `/gp/` | Patient search, clinical history, consultations, problems, allergies, appointments and tasks |
| GP documents | `/gp/documents/` | Letter assignment, review, annotations and filing |
| GP messaging | `/gp/messages/` | Conversations, templates, manual delivery, replies and internal notes |
| Reception | `/gp/telephony/` | Shared call queue, answer, hold, transfer, notes and completion over WebSocket |
| Hospital | `/hospital/` | Attendances, bed capacity, notes, signatures, addenda and discharge letters |
| Pharmacy | `/pharmacy/` | Stock, supplier baskets/orders, receipts, prescriptions and referral workflow |
| Community | `/community/` | Scheduled visits, completion and capacity |
| HomeHealth | `/wearables/` | Device connections and locally generated readings |
| Patient messages | `/wearables/messages/` | Delivered conversations and patient replies; internal notes excluded |
| Staff Identity | `/cis2/` | Fictional staff selection, PKCE, signed tokens, sessions and local operator settings |
| Handbook | `/docs/` | Original linked handbook and API reference |

The browser uses the local development key `local-demo`. Organiser screens accept `local-operator`, exposing the single imported world, its local change history and capacities. These keys identify a local demo; they do not enforce patient or family authorization.

The clock starts paused. Advancing it processes new local jobs for visits, tests and devices. Message delivery and pharmacy stock receipt are explicit actions. All writes stay in the app database. No requests are forwarded to the source simulator.

## What is reproduced

The frontend is the original compiled HTML/JavaScript/CSS and media, with a small local bootstrap. The readable original React source was not available. The backend is our own implementation of the discovered API contracts, using 50,000 captured synthetic patient records and the accessible service resources.

This is not a copy of the source's internal database schema or its full simulation engine. Existing hidden scheduled jobs, organiser incidents, background agents, population generation and historical HTTP logs were not exposed. Unsupported organiser operations return errors. New lab outputs and device readings are explicitly local synthetic results; they do not reproduce the source clinical model. Staff sign-in simulates identity and does not access real smartcards or security keys. Sessions expire on server restart.

The original UI text and handbook may describe source features the local backend does not implement. The legacy letter transfer is a local consultation import for the captured scenario. A production consent policy engine, verified family relationships, ADK agent runtime and remote EHR consent synchronization are separate work.

## Verify

```sh
npm test --prefix sim-app
```

Tests cover version conflicts, appointment overlap, pharmacy inventory changes, document state transitions, patient reply restrictions, scheduled jobs, identity and reception ownership. The `integration-*.mjs` scripts are manual checks against a running local app; **they create demo records and may advance the simulation clock**.

Asset provenance and capture coverage are in [the UI report](../docs/research/full-app-ui.md) and `public/ATTRIBUTION.txt`.

## Patient and GP consent apps

Open [the existing Kindred Circle](http://localhost:3111/?as=eleanor&tab=circle) and [GP consent](http://localhost:4192/gp/consent/?patient=SIM-000006) side by side. GP Records has a **Family consent** navigation link; the neighbourhood footer has **Family & consent**.

The active patient UI is the existing Next.js app in `web/`, not the standalone UI under `public/companion`. The old `/companion/` entry redirects to Kindred. The Circle supports adding family members with sharing off, all six original category switches, removing access, and a link to GP consent. Existing demo people and their choices were preserved in the database; this does not verify their family relationships. Email is optional and no messages are sent.

The `companion` schema in the writable app database stores members, per-member permissions, versioned change history and hashed session/invitation tokens. Every successful change updates that patient's local GP `observation` resource (`local-family-consent-{patientId}`) and audit history in the same transaction. A failed write rolls everything back. Server-sent events update open GP, patient and family pages. Stale edits return 409.

The family page only receives selected fields from allowed categories. It excludes other family members, unshared categories, raw resource JSON, internal metadata and draft notes. Revocation invalidates links and sessions and clears connected family views. Restoring a member requires new sharing choices and a new link. Existing information a recipient has copied cannot be recalled.

**Identity scope:** patient and GP accounts are explicitly local demo identities selected by the `patient` query parameter. They are not verified patient/clinician authentication. The server binds to loopback; do not expose this demo to real patients or the internet as an authorization service. Family links are bearer credentials, stored hashed and valid for 30 days; family sessions last 12 hours. Consent categories apply only to the companion family API. They do not gate the existing simulator APIs or alter care-team clinical access. Sync is to the local GP copy, not an external EHR or a native FHIR Consent service.

Run `node sim-app/integration-companion.mjs` for the manual HTTP permission/sync regression check. It uses a separate synthetic patient and leaves its test membership revoked. The unit suite also covers category and field filtering. Kindred at port 3111 uses this database through `web/src/lib/consent-store.ts`. Its app, consent-request and agent consent writes wait for persistence before returning success. Open Kindred clients refresh external consent changes every 2.5 seconds. The original family-link API remains available for development, but it is not a second patient UI.

## Enrichment

`enrich/enrich.mjs` rewrites the demo cohort's synthetic blood histories so every analyte
tells one coherent story (eGFR coupled to creatinine through CKD-EPI 2021), adds repeat
medicines and active problems that match the coded conditions, books one story appointment
per patient through the local action API, and gives Amira Khan a home activity watch with ten
days of readings. It writes through the same projection and event tables as the app and is
idempotent.

```sh
node sim-app/enrich/enrich.mjs --dry-run
node sim-app/enrich/enrich.mjs
node sim-app/enrich/enrich.mjs --verify
```

Set `DATABASE_URL`/`DIRECT_DATABASE_URL` (for example with `node --env-file=.env.neon.development`)
and `--api` pointing at a backend on the same database to enrich Neon. Details, the cohort
stories and caveats are in [enrich/README.md](enrich/README.md).
