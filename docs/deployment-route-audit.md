# Production data route audit

Read-only code and capture-manifest audit, 12 September 2026. No production queries or upstream requests were made for this audit. The Neon client was being changed during this review, so the findings below distinguish existing behavior from work in progress.

## Data paths

| Feature | Data path | Remaining dependency |
| --- | --- | --- |
| Ask clinical records and patient search | New `NeonClinicalClient` queries `sim.patients` and `sim.resource_projections` using server `DATABASE_URL` | Main integration is wiring and testing this client |
| Ask sessions, runs, memory | `public.kindred_care_state`, one row per Ask session | Server `DATABASE_URL` |
| Kindred patient records and picker | `sim/client.ts`; main integration is adding direct Neon reads | Previously `SIM_BASE_URL` HTTP client |
| Kindred messages and runtime state | `public.kindred_runtime_state`, keyed by namespace and patient | Server `DATABASE_URL` |
| Canonical consent for both pages | `consent-store.ts` calls our hosted companion service | `COMPANION_BASE_URL` and server protection bypass; that service uses the same production Neon database |
| Clinical writes and clock advances | Existing hosted simulator transaction engine | Same production Neon; not forwarded to original Anima |
| GP documents, messaging, pharmacy, attendances | Hosted simulator reads resource projections and builds workspaces | Same production Neon |
| PDS demographics | Hosted simulator queries `sim.patients.demographics` | Full PDS capture must remain in production |
| ODS and miscellaneous adapters | Captured responses, often exact endpoint/query matching | `sim.endpoint_responses`; missing query combinations return 404 |
| Legacy letter | `sim.legacy_documents` plus captured HTML in `sim.endpoint_responses` | Not automatically included in Ask's clinical service views |

Original Anima defaults still appear in optional non-database clients. A deployment with `DATABASE_URL` must consistently select the Neon client; it must not fall back upstream after a database error. Our hosted replica is a separate service backed by Neon, not original Anima.

## Patient switching

- Database-mode Kindred requests use AsyncLocalStorage and a per-patient runtime row. Successful picker POST sets the `kindred_patient` HTTP-only cookie. That prevents one visitor's selected patient from changing another visitor's runtime state.
- Empty picker search currently lists hardcoded demo patients; main integration is changing this to the production directory.
- Ask maintains its own selected patient in its session. The browser reselects the Kindred patient when it changes. API context and Ask routes reject a request whose patient does not match that Ask session.
- Remove the fallback in `useCareClinical.ts` that selects `SIM-000001` when the requested patient is missing. Main integration is handling this.
- During a patient switch, the hook currently leaves Ask ready until selection finishes. `ask()` checks the Ask session but does not check that its patient equals the currently displayed Kindred patient. Block Ask while switching and check equality before submitting.
- A previous patient's in-flight answer can append after the thread is cleared. Tie stream callbacks and completed answers to the current patient/viewer scope and ignore stale results.
- Ask session IDs and preferred patient IDs use localStorage, while the active patient cookie is also shared between browser tabs. These are not independent per-tab patient selections. Server mismatch checks prevent a stale Ask request from reading the newly selected patient, but different tabs can disrupt each other.
- `useKindred` restarts SSE after a switch, but it retains the old state until the new stream responds. Hide or disable actions during that interval so old member IDs cannot be submitted with the new patient cookie.

## Clinical completeness and fallbacks

- Ask `loadContext` and Kindred's mapper originally fetched only the first 500 service records. `resourceTotal` must drive pagination. Main integration is handling this.
- Ask uses GP, hospital, pharmacy, community, diagnostics, referrals and wearables scopes. Patient-only projection records and the separate legacy-letter table are outside this clinical context loader. This is an application-read limitation even when those rows are present in Neon.
- Kindred's clinical sections intentionally map the GP projection. Ask covers additional services. This difference is not proof that records are missing from production.
- Kindred `refreshConsent` catches a companion failure and sets `ehr.syncError`, retaining mapper defaults or previously cached grants. Family-facing agent reads should fail when canonical consent cannot be refreshed. Ask's `canonicalPolicy` already throws on this failure.
- ODS single-record reads may not have an exact captured response; Kindred falls back to the captured organization search. This is a same-database fallback. PDS/ODS data should not be fabricated from the family demo configuration.

## What the capture evidence proves

The migration checkpoint at `sim-app/deployment/neon-verification.json` records 50,000 patients and 376,047 service projections, with patient/resource JSON fingerprints matching the local migration snapshot at 12:47 UTC. This checkpoint alone does not prove that production contains later local changes.

`docs/research/replica-coverage.md` records 50,000 PDS demographics, four organizations, one accessible legacy letter, eight service projections and 29 discovered API path patterns. Supplementary endpoint responses preserve adapters, workspaces, metadata and recorded access errors. Verify these tables as well as patients/resources when checking production completeness.

The capture is an API reconstruction. The team key could not read the organizer snapshot (403), private operator configuration, other worlds, hidden scheduled jobs, or complete historical events. Transient reception streams were not a clinical database export. Do not claim that the original private PostgreSQL database was fully copied.

## Checks before declaring the switch complete

1. Compare production and local capture counts/fingerprints for patients, demographics, projections, organizations, legacy documents and successful endpoint captures; preserve production app writes.
2. Search an ordinary non-demo patient with an empty picker and by ID/name; verify displayed records, Ask session patient and browser cookie agree.
3. Switch quickly between patients while Ask streams; confirm no previous-patient answer appears under the new patient.
4. Verify original Anima is not contacted in database mode, including failure cases; verify hosted companion writes still reach the production database.
5. Verify unavailable canonical consent prevents family-facing reads rather than reverting to demo grants.


## Integration resolution

The deployment now selects direct Neon reads for Ask, Kindred records and patient search whenever `DATABASE_URL` is set. The unfiltered picker reads the Neon directory. Both clinical loaders fetch all pages. The wrong-patient fallback was removed; Ask sessions are isolated per browser tab, switching pauses input, and stale stream results are discarded. Kindred closes its prior record stream while switching and fails database requests if canonical sharing cannot be refreshed.

The direct clinical client was tested against Neon development with global HTTP fetch blocked. It returned patient search, paginated records, appointments and clock state without an Anima key. Separate tests passed for session durability, concurrency, isolation and rollback. See `deployment-data-audit.md` for the completed production inventory comparison; no data copy was needed.
