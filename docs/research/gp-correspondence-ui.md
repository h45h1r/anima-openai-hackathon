# GP correspondence and messages

Inspected on 12 September 2026. Screens are backed by the team's synthetic simulation data. No upstream writes were made.

## Source UI

- Document Inbox: `https://sim.animahealth.com/gp/documents/`
- Messagey: `https://sim.animahealth.com/gp/messages/`
- Document component: `/gp/assets/document-workspace-CYOOfCR3.js`
- Document styles: `/gp/assets/document-workspace-DARuS1bs.css`
- Messaging component: `/gp/assets/messaging-workspace-CTBgapxF.js`
- Messaging styles: `/gp/assets/messaging-workspace-Dfjvtjex.css`

These are separate lazy-loaded GP workspace components. Document Inbox uses a purple header, amber queue status, a three-column queue/letter/processing layout and paper-like letter contents. Messagey uses green conversation bubbles, a two-column inbox/thread layout and Inbox, Done and Templates folders. The local screen CSS derives from these public source styles, with local read-only and responsive adjustments.

## Data contract

| Screen | Original read endpoint | Resources |
| --- | --- | --- |
| Document Inbox | `GET /api/sites/gp/documents` | Discharge summaries plus patient names |
| Messagey | `GET /api/sites/gp/messaging-workspace` | Conversations, message templates and patient names |

The original workspaces poll their dedicated endpoints every five seconds. A patient-filtered GP view also contains that patient's correspondence, conversations and practice templates. Original standalone inboxes cover the whole practice by default. Our local screens filter supplied resources to the selected patient, while retaining practice templates.

Document fields: `id`, `patientId`, `status`, `priority`, `version`, `data.stage`, `sentAt`, `sentBy`, `assignee`, `sections`, `tags`, `snomedCodes`, `reviewNote`, `filingNote`, and `provenance`. Letter sections are reason, diagnoses, clinical course, results, medication changes, follow-up and GP actions. Workflow stages are sent → reviewed → filed, with drafts authored by the hospital.

Conversation fields: `id`, `patientId`, `title`, `status`, `version`, `data.assignee`, `allowReply`, and `entries`. Entries contain body, actor, time, direction, channel and delivery history. Directions are incoming, outgoing or internal. Internal notes are practice-only. Templates have title, channel and body.

## Consent integration points

- Letter metadata and sections can be checked separately: appointment follow-up may be shareable without exposing diagnoses or medication details.
- Keep the original author's name, source, version and history attached to every extract or explanation.
- A queued message is not proof of delivery. The delivery history contains queued, delivered and failed outcomes.
- Do not forward internal notes to a family member merely because they occur in a patient conversation.
- Proposed access checks belong before extraction, family-facing explanation and message delivery. The local source-record button passes the untouched record to the shell's access panel.

## Local implementation

`prototype/screens/documents.js` exports `renderDocuments({ resources, patient, onRecordSelect })`.

`prototype/screens/messages.js` exports `renderMessages({ resources, patient, onRecordSelect })`.

Both return a DOM element. `resources` is a resource array or an object containing a resource array. `patient` can be an object with `id` and `name`, or a patient ID. `onRecordSelect` receives the original selected resource. Shared CSS loads once through `correspondence-ui.js`.

Implemented interactions: document search, queue/urgent/unassigned filters, letter selection, authorship history, conversation search, Inbox/Done/Templates selection, template selection and delivery history. Mutating controls are disabled. All clinical text comes from passed records.

Verified with an isolated Chromium session using the actual SIM-000006 GP response: document rendering, original-record callback, document filtering, message rendering, template switching and completed-folder filtering. No browser page errors. Screenshots are in `docs/research/screenshots/documents-prototype.png` and `messages-prototype.png`.
