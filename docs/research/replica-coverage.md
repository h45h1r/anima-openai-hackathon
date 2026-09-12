# Anima simulator replica coverage

The local PostgreSQL database is **`anima_sim_replica_20260912`**. It contains the data retrieved through our team key for world `team-8942268fa18a`, plus its accessible legacy document. The simulator's `/healthz` confirms its backend is PostgreSQL. This is a reconstructed API dataset, not a copy of its private database schema.

## Retrieved and checked

| Dataset | Stored |
| --- | ---: |
| Patient directory records | 50,000 |
| Full PDS demographic records | 50,000 |
| GP service records | 374,916 |
| Hospital service records | 450 |
| Community service records | 28 |
| Pharmacy service records | 158 |
| Diagnostics service records | 363 |
| Referral service records | 15 |
| Wearable service records | 24 |
| Patient-visible service records | 50 |
| **Distinct service resource IDs across projections** | **375,140** |
| ODS organisations | 4 |
| Legacy-only documents | 1 |

Per-service counts overlap. We preserve each service's original projection and expose a separate view selecting one version per resource. The API patient view reports 51 but returns 50 visible records: a failed-delivery conversation is absent from that projection and present in the GP data. A separate 50-item request returned 49, and the final offset returned one, confirming the same 50 visible records across pagination.

Data import checks passed for page counts, unique patient IDs, resource totals and patient-reference joins. The carer cohort reconciles to 3,176 records. The local appointment API reproduces the captured day's 14 appointments and six sessions. Original patient, medication, problem, allergy, lab, conversation, appointment and provenance fields remain in JSONB; SQL views expose commonly used fields.

See [verification results](replica-verification.json), [database setup and usage](../../replica/README.md), and [query examples](../../replica/queries.sql).

## Endpoint discovery

Inspected **130 successful frontend HTML/JS/CSS assets** from the GP, hospital, community, pharmacy, wearable and control apps. Extracted **29 API path literals/templates**, with their source assets recorded in [frontend-endpoints.json](frontend-endpoints.json).

The important routes are:

- `/api/sites/{site}/patients`: shared patient directory, 30 records per page.
- `/api/sites/{site}/view`: scoped resources, up to 500 records per page; the main bulk extraction route.
- `/api/sites/gp/documents`, `/api/sites/hospital/documents`: correspondence workspaces.
- `/api/sites/gp/messaging-workspace` and `/api/sites/patient/messaging-workspace`: practice and patient conversation projections. All 12 patients represented in the practice conversation workspace were queried individually.
- `/api/sites/pharmacy/pharmacy-workspace`: stock, prescriptions, suppliers and orders.
- `/api/sites/hospital/attendances`: hospital activity projection.
- `/api/nhs/*`: PDS, ODS, service directory, referrals, prescriptions, tasks, shared documents and diagnostic adapters.
- `/api/control/snapshot`: full-world export, **403 with the supplied team key**.
- `/api/sites/control/view`: organiser-facing route found in frontend code; it uses operator access, not an additional team-key export.
- `/api/sites/legacy/view`: **501**, explicitly directs clients to the HTML workflow.
- `/api/session` plus `/browser/legacy`: documented browser authentication followed by a read of the legacy letter. Transfer forms were not submitted.
- `/api/telephony/live`: reception WebSocket, not a general clinical database export. Stored reception-call records are in the GP projection; transient live-stream activity is not cloned.

The frontend did not expose an alternative unrestricted SQL/database download route. We did not bypass the organiser gate or access another team's world. The captured endpoint responses include the current OpenAPI document, handbook, catalogue and capability statements.

## Limits

1. **Organiser-only data:** hidden scheduled jobs, full historical events, operator configuration, team credentials and other team worlds are not available through this key.
2. **Wearable routes:** dedicated `/devices` and `/readings` routes returned 404 during replication, despite working earlier in the session. The wearable service view successfully supplied its device and observation records and is included.
3. **No transactional snapshot:** the API offers independent reads. The clock and record versions are preserved, but this is not equivalent to one server-side `pg_dump` snapshot. A final live GP count matched 374,916.
4. **No simulator engine:** the replica does not execute bookings, messaging deliveries, prescriptions or scheduled jobs. Its local HTTP API is read-only.
5. **No invented relationships:** surname/address matches remain unverified. Our app must store patient-confirmed or clearly marked demo relationships and separate sharing grants.

To copy the hidden backend state and original schema, we would need an organiser export or database credentials from the simulator owner.
