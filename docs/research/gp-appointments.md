# GP appointment book

Inspected 12 September 2026. All records below are synthetic simulator data. Exploration made read requests only.

## Data access

`GET /api/sites/gp/appointments?date=2026-09-12` returns `appointments`, `patients` (ID/name pairs), and `sessions`. The date is a required UTC day. Use the team key on the server; do not expose it in browser code.

The observed response contained 14 appointments, 14 patient names and six clinician sessions: Dr Maya Shah, Dr Daniel Brooks, and Nurse Alex Morgan, each with 08:00–12:00 and 13:00–17:00 sessions. Each session has 15-minute slots and a protected break. The simulator clock was paused at 08:00 UTC; the local machine's time is not the appointment book's Today.

Session resources contain `data.startsAt`, `endsAt`, `slotMinutes`, `clinician`, `location`, `mode`, and `blockedSlots` (start time and reason). Appointment resources contain `patientId`, `title`, `status`, `version`, `data.startsAt`, `durationMinutes`, `clinician`, and `mode`. Resources also carry provenance and visibility metadata.

Slots are derived from sessions. Occupancy uses overlapping appointment intervals for the same clinician. The source excludes cancelled and rejected appointments from occupied slots. Appointments outside session hours appear in a separate expandable list, so a calendar-only implementation would miss some records.

## Original interface

Recovered public bundles:

- [GP page](https://sim.animahealth.com/gp/)
- [UI JavaScript](https://sim.animahealth.com/gp/assets/systems-C0T_f8i5.js)
- [UI CSS](https://sim.animahealth.com/gp/assets/systems-DR1w4Obh.css)

The original is a compact blue/grey desktop appointment book with a left month calendar and clinician filter, an All day/AM/PM ribbon, clinician columns, coloured booked/arrived/completed slots and striped blocked slots. The local screen copies its appointment CSS and reconstructs its DOM in vanilla JavaScript. It is not a guessed visual design.

The original polls this appointment endpoint every three seconds. The prototype refreshes on explicit date selection/Refresh and leaves polling to the application shell. Original mutation buttons are disabled in the prototype. Available-slot and record-history details are simplified; this is a read-only reconstruction.

## Future tools

Read tools can expose `list_gp_appointments(date)`, `get_available_slots(date, clinician)` and `get_appointment_details(id)` using these records. Appointment reminders should reference the appointment ID/version and consult the consent engine before disclosing details to any family recipient. GP service visibility does not itself establish family consent.

The source calls `POST /api/sites/gp/actions` for these commands. They were inspected in source, not executed:

| Action | Key fields |
| --- | --- |
| `book_appointment` | `patientId`, `title`, `sessionId`, `sessionVersion`, `startsAt` |
| `create_appointment_session` | `title`, `clinician`, `location`, `mode`, `startsAt`, `endsAt`, `slotMinutes` |
| `set_appointment_slot` | session `resourceId`, `expectedVersion`, `startsAt`, `slotCommand` (`block`/`unblock`), reason in `text` for blocking |
| `arrive_appointment` | appointment `resourceId`, `expectedVersion` |
| `complete` | appointment `resourceId`, `expectedVersion` |
| `cancel_appointment` | appointment `resourceId`, `expectedVersion` |

Use current versions; the API documents 409 for stale versions, invalid transitions or unavailable capacity. Retry the same action with a stable `Idempotency-Key` (or UUID `clientRequestId`). The NHS-shaped appointments adapter is a simplified simulator projection, not a production NHS booking API.

## Implementation and verification

`prototype/screens/appointments.js` exports `renderAppointments({appointments, sessions, patients, onRecordSelect, date, onDateChange, now})`. It returns a DOM element. `onRecordSelect` receives the appointment resource; `onDateChange` receives a UTC date string. Load `appointments.css` in the shell and give the containing panel a bounded height.

Chrome verification against the observed response: three columns, six sessions, 96 slots; AM filter produces three sessions; nurse filter produces one column; Eleanor Chen's 08:30 booking opens `r-3690`; Open patient record passes that resource; next day emits `2026-09-13`. No browser JavaScript errors. Screenshot: `screenshots/gp-appointments-integrated.png`.
