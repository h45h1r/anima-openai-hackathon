# GP UI reconstruction

The editable local prototype recreates the main GP Records reading screens so a consent layer can be added in context. It is not an iframe and does not modify the hosted simulator.

## Source evidence

Observed original page: [GP Records](https://sim.animahealth.com/gp/). Captured on 12 September 2026. The original authenticated Journal screenshot is [gp-records-original.png](screenshots/gp-records-original.png).

Recovered public assets:

- [GP entry module](https://sim.animahealth.com/gp/assets/index-BZtm2W1c.js)
- [Shared stylesheet](https://sim.animahealth.com/gp/assets/index-B3tGnViK.css)
- [Clinical systems module](https://sim.animahealth.com/gp/assets/systems-C0T_f8i5.js)
- [Clinical systems stylesheet](https://sim.animahealth.com/gp/assets/systems-DR1w4Obh.css)
- [Document module](https://sim.animahealth.com/gp/assets/document-workspace-CYOOfCR3.js)
- [Messaging module](https://sim.animahealth.com/gp/assets/messaging-workspace-CTBgapxF.js)

These hashed deployment asset names can change. The local copy of shared CSS is `prototype/reference/gp-original.css`; screen CSS is adapted from the matching deployed components. The original application and assets belong to their respective authors. Our editable reconstruction and connection code live in `prototype/`.

## Layout and screens

The GP interface has a compact desktop style: blue-gray window/menu/tool bars, a pale yellow patient strip, a 174px record tree and a scrollable clinical area. Record navigation groups are Record, Clinical and Workflow. The original selected-patient opening screen is Journal.

| Screen | Original shape | Local module / data |
| --- | --- | --- |
| Journal / consultations | Date groups, narrative rows, author and activity disclosure | `screens/records.js`; patient-filtered GP resources |
| Problems / allergies / medication / codes | Clinical tables | `screens/records.js`; EHR collections and later record overrides |
| Results | Panel selection, analyte values, history and source | `screens/records.js`; `report.data.panel` and `analytes` |
| Appointment book | Month selector, clinician filters, session columns and timed slots | `screens/appointments.js`; dedicated appointment API |
| Document Inbox | Queue, letter, processing sidebar | `screens/documents.js`; selected patient's discharge summaries |
| Messagey | Inbox, thread, delivery state and templates | `screens/messages.js`; selected patient's conversations and practice templates |

The journal was compared with an authenticated original screenshot. Appointment, document and messaging layouts were reconstructed from deployed component code and CSS and tested locally. We do not claim pixel-perfect matching across all screens. The shell uses simplified icons and reading shortcuts; write buttons are disabled or omitted. The full practice-wide queues and editing flows are not copied.

The live GP view already supplies the selected patient's letter and conversation. Dedicated document/messaging endpoints were also read and mapped for later practice-wide queues. They can return multiple patients even when a patient query parameter is supplied, so always filter using the returned `patientId`.

## Consent placement

The local **Patient consent** button beside patient search opens a labelled design preview. It shows where sharing controls will fit and lists existing service visibility for the loaded records. It does not invent consent grants or claim that visibility is patient approval.

Planned integration points:

1. Patient strip: current sharing status and a route to the patient's choices.
2. Record details: explain the resource's source and the consent rule that permits access.
3. Appointment detail: show which family recipient may receive which reminder fields.
4. Document processing: check whether a proposed summary may be shared and preserve its source links.
5. Message composer: show recipient, permitted content and the final consent check before delivery.

The patient and family views are new application surfaces, not existing simulator roles we can simply enable. Access decisions must run in the backend, shared by REST endpoints and ADK tools. The current panel is an integration placeholder; implementing those rules is the next piece of work.

## Validation

Each delegated screen was exercised in Chromium with captured records. Appointment checks covered 3 clinicians, 6 sessions, 96 slots, AM/PM and clinician filters, Eleanor's 08:30 booking and date navigation. Document and message checks covered source callbacks, search, tabs, template switching and delivery history. No upstream mutations were used.

The local server binds to loopback and only provides GET routes. Data mode is explicit in the page URL and footer. A failed live request is visible and does not get replaced silently with snapshot data. `npm test` verifies read-only routing, snapshot patient boundaries, exact patient matching and resource pagination.
