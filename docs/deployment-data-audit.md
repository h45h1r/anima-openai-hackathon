# Production data audit

Checked 2026-09-12T16:10:37.265Z. Read-only, repeatable-read transactions against the archived capture (`anima_sim_replica_20260912`), the current local app (`anima_sim_app_20260912`) and Neon production (`kindred`, branch `br-rough-art-za6q8z12`). No data was changed.

## Result

**Production contains every patient ID and every service projection ID in the captured Anima dataset. No captured patient, resource projection, import page, endpoint response or legacy document is missing.**

All 50,000 patients have directory and demographic JSON matching both local databases. All 57 captured endpoint response bodies, 2,924 import-page metadata rows and the legacy document match the archive. All 3,176 patients in the captured carer cohort are present. No resource references a missing patient.

Production is the working application dataset, so some captured resource bodies have deliberate edits. Of the 376,004 original projections, 375,659 still have identical JSON and 345 have changed. Those 345 changed bodies also match the current local app. Production adds 687 projections, giving 376,691 projections and 375,386 distinct resource IDs.

## Service coverage

| Service | Captured projections | Production projections | Captured IDs missing |
| --- | ---: | ---: | ---: |
| community | 28 | 62 | 0 |
| diagnostics | 363 | 543 | 0 |
| gp | 374,916 | 375,115 | 0 |
| hospital | 450 | 632 | 0 |
| patient | 50 | 97 | 0 |
| pharmacy | 158 | 161 | 0 |
| referrals | 15 | 15 | 0 |
| wearables | 24 | 66 | 0 |

Counts are per service; the same resource can appear in several services.

## Differences from the current local app

- Both databases have 376,691 projections. Their shared resource IDs have identical JSON except the consent observation below.
- Eight demo appointments were booked independently in local and production, so their generated resource IDs differ. Matched by patient, all eight appointment `data` objects are identical. These are additions made by Kindred, not lost Anima records.
- Appointment patients: `SIM-000001`, `SIM-000006`, `SIM-000011`, `SIM-000107`, `SIM-000204`, `SIM-000244`, `SIM-000511`, `SIM-000514`.
- `gp/local-family-consent-SIM-000006` is version 22 in production and version 18 locally. Production has four additional consent updates. Copying the local record over production would roll back consent.
- Event IDs differ because demo enrichment and appointment actions ran independently in each database. Both contain 328 enrichment events and identical counts for every other event type except consent (production 36, local 32). The original archive contains no events.
- Sessions and idempotency caches differ by environment. These are runtime state, not missing captured clinical data. Production also contains durable Kindred runtime and clinical Ask state tables.

The 345 modified captured projections comprise 324 report projections, eight EHR records, eight appointment sessions, two capacity records, one telephone call, one pharmacy product and one pharmacy basket. The enrichment process is documented in [the enrichment README](../sim-app/enrich/README.md).

## Base-table inventory

| Table | Archive | Local app | Production |
| --- | ---: | ---: | ---: |
| `companion.audit` | — | 32 | 36 |
| `companion.members` | — | 9 | 9 |
| `companion.patients` | — | 3 | 3 |
| `companion.sessions` | — | 17 | 23 |
| `public.kindred_care_state` | — | — | 2 |
| `public.kindred_runtime_state` | — | — | 1 |
| `sim.endpoint_responses` | 57 | 57 | 57 |
| `sim.events` | 0 | 437 | 441 |
| `sim.import_pages` | 2,924 | 2,924 | 2,924 |
| `sim.legacy_documents` | 1 | 1 | 1 |
| `sim.local_clock` | — | 1 | 1 |
| `sim.local_jobs` | — | 12 | 12 |
| `sim.local_requests` | — | 15 | 8 |
| `sim.local_settings` | — | 0 | 0 |
| `sim.patients` | 50,000 | 50,000 | 50,000 |
| `sim.resource_projections` | 376,004 | 376,691 | 376,691 |
| `sim.worlds` | 1 | 1 | 1 |

## Method and limits

Compared every patient ID and MD5 of its directory/demographic JSON; every `(world_id, site, resource_id)` and MD5 of its complete JSON body; endpoint bodies; import-page counts/source totals/URLs; and legacy-document title/content/source URL. Table counts and service/kind coverage were queried from base tables. Checks used independent read-only snapshots, so later app writes can change runtime counts.

This verifies the captured API dataset, not the upstream simulator’s private database. The original capture contains 39 resource kinds. It does not contain organiser-only scheduled jobs, historical event logs, private configuration or other teams’ data. The full-world export rejected the team key. The patient service reported 51 records but exposed 50; the omitted failed-delivery conversation is present in the GP projection. See [capture coverage](research/replica-coverage.md).

The source capture dates to 12 September 2026. This audit does not claim that upstream changes made after capture have been synchronised. Production holds the app’s edited clinical dataset; the local archival replica and its backup preserve the original captured resource bodies.
