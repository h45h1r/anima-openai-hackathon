# GP Records: patient record screens

Inspected on 12 September 2026 using the supplied simulation team and synthetic patient `SIM-000006` (Eleanor Chen). No upstream write actions were used.

## Evidence and fidelity

The original GP Records application loaded successfully once in an isolated Chrome session. The selected-patient landing screen is **Journal**, titled **Consultation record**. Its screenshot is [gp-records-original.png](screenshots/gp-records-original.png). Subsequent original-browser loads timed out; other record views were reconstructed from the publicly served application JavaScript and CSS, then checked against the API response.

Observed source assets:

- `/gp/assets/index-BZtm2W1c.js`: application shell and site selection.
- `/gp/assets/index-B3tGnViK.css`: compact practice window, toolbars, patient strip, navigation tree.
- `/gp/assets/systems-C0T_f8i5.js`: GP record screen components and data mapping.
- `/gp/assets/systems-DR1w4Obh.css`: journal and results styling.

The prototype preserves the observed compact blue/gray desktop layout, yellow patient strip, record navigation, journal date groupings, row metadata, source attribution, search and entry-type filters. [gp-journal-integrated.png](screenshots/gp-journal-integrated.png) shows the local reconstruction inside the full shell. It is a research copy, not a claim of pixel-perfect parity.

## Available data and screens

| Screen | Source fields | Implemented behavior |
| --- | --- | --- |
| Journal | Patient-scoped resources, excluding infrastructure and the aggregated EHR record | Newest first, date groups, text/author search, resource-kind filter, 30-entry pagination, source attribution and detail links |
| Consultations | `encounter`, `consultation`, `clinical-note` | Read-only consultation history; original note authoring form deliberately not enabled |
| Problems | `ehr-record.data.problems`, patient `conditions`, standalone `problem` resources | Active/resolved filter; standalone resources replace their `sourceProblemKey` entry |
| Allergies | `ehr-record.data.allergies`, standalone `allergy` resources | Substance, reaction and status; standalone resources replace `sourceAllergyKey` |
| Medication | `ehr-record.data.medications`, `prescription` resources | Medication history and prescription requests; empty states are explicit |
| Results | Resource `data.panel`, `data.collectedAt`, `data.analytes` | Panel filters; latest and previous sample; reference intervals; chronological history; report detail links |
| Coded history | `ehr-record.data.miscCodes` | Code and term table |
| Care coordination | Visit, care-plan, handover, referral, discharge and task resources | Filtered read-only journal; only rows actually visible to GP are shown |

The original journal excludes `ehr-record`, `device`, `capacity`, `stock`, `pharmacy-stock`, `supplier-quote` and `appointment-session`. It displays raw resource titles, clinical/narrative sections and provenance. Resource `visibleTo` tells us which simulator services can see a record; it is not evidence of a patient's consent policy.

No patient conditions, medication or allergy entries were invented. Missing numeric result values display as **Not available** and are not compared with reference intervals. Reference intervals are simulation values, not clinical guidance.

## Verification

Checked all record tabs in the integrated local application with the captured API snapshot. No browser page errors occurred. Eleanor's snapshot contains 46 journal entries, 29 problem rows (19 active), 4 consultation encounters, 13 administrative codes and 19 analyte series. Searching the journal for `transport` returns two entries. Care coordination contains one shared hospital discharge summary. JavaScript syntax check passed.

The consent overlay can attach to a resource's ID, version, patient ID, owning service and provenance. Reading a raw record should remain distinct from preparing a permitted summary for a named recipient. No upstream consent synchronization or enforcement is implemented by these views.
