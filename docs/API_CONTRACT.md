# CareCircle server API contract (server.mjs, Node 24, no deps except `openai` optional)

Serve: `app/` at `/`, `twin/` at `/twin/`. Port 4180. Reads `.env` (ANIMA_SIM_API_KEY, ANIMA_SIM_BASE_URL, OPENAI_API_KEY from process.env).
All JSON. Every response includes `state` (full state below) so the UI can re-render from any call.

## State shape
{
  patient: { id:"SIM-000006", name:"Eleanor Chen", age:83 },
  people: [
    { id:"eleanor", name:"Eleanor", role:"patient" },
    { id:"sarah", name:"Sarah", role:"daughter" },
    { id:"john", name:"John", role:"husband" },
    { id:"tom", name:"Tom", role:"son" } ],
  consent: { sarah:{results:true, followup:true, appointments:true, updates:true},
             john:{results:false, followup:false, appointments:true, updates:true},
             tom:{results:false, followup:false, appointments:false, updates:true} },
  gate: { step:"idle"|"ordered"|"result_detected"|"disclosed"|"released"|"escalated",
          testResourceId, orderedAt, resultAt, disclosedAt, releasedAt, escalatedAt,
          analytes:[{id,name,unit,lo,hi,v}] | null, abnormal:[names] },
  threads: { sarah:[msg], john:[msg], tom:[msg], family:[msg], eleanor:[msg] },
    msg = { at:ISO, from:"agent"|"sarah"|..., text, kind:"info"|"held"|"explain"|"task"|"question"|"answer"|"escalation", simulated?:true }
  trail: [ { at:ISO, source:"anima"|"carecircle", type, detail, resourceId? } ],   // newest last
  simNow: ISO string from Anima clock
}

## Routes
GET  /api/state
POST /api/reset                          -> fresh state (does not touch Anima)
POST /api/consent  {person, topic, allowed}   topics: results|followup|appointments|updates
POST /api/consent/agent {text}           -> natural-language consent change via OpenAI function-call; returns {applied:[{person,topic,allowed}], reply}
POST /api/order-lft                      -> Anima order_test panelId lft on SIM-000006 via /api/sites/gp/actions, body clientRequestId = randomUUID(); store resourceId; gate.step=ordered; trail entry
POST /api/advance {minutes}              -> Anima POST /api/clock {paused:true, advanceMinutes}; then GET /api/sites/gp/view?patient=SIM-000006&limit=300, find resource id==gate.testResourceId with data.analytes present (or status available) -> gate.step=result_detected, store analytes, compute abnormal (v<lo||v>hi); post a "held" message to eleanor thread ONLY ("A new blood result has arrived. Your practice will talk you through it."); nothing to family; trail entries for clock + result
POST /api/confirm-disclosure             -> simulated clinician action; gate.step=disclosed -> immediately release: for each person with consent.results -> explain message (OpenAI, grounded ONLY in analytes + consent + person role, plain English, <=70 words, no diagnosis); for consent.followup -> follow-up message; for consent.appointments only -> logistics message referencing the practice follow-up appointment (no values); for updates only -> "No action needed from you this week. Eleanor's practice is in touch with her."; family thread gets the appointments-level message. Then Anima create_task {patientId, title:"CareCircle: LFT result discussed, arrange follow-up", text} on gp site -> trail entry with resourceId; gate.step=released
POST /api/ask {person, question}         -> OpenAI answer using only what that person's consent allows (if results not allowed and question is about results: polite refusal that says Eleanor has not shared results with them); append question+answer to that person's thread
POST /api/escalate {days}                -> if gate.step==result_detected (undisclosed) and abnormal.length: Anima create_task {title:"CareCircle safety net: abnormal LFT not yet discussed with patient (N days)"}; eleanor thread gets "We will phone your landline today about a recent blood test."; family thread gets ONLY "There is something the practice needs to discuss with Eleanor. No details yet." gate.step=escalated; trail entries
GET  /api/trail                          -> merge Anima GET /api/clock events (map: at,type,actor,resourceId) with local trail

## Rules
- Retry Anima calls up to 4x on 502/503 with 1.5s backoff. Timeout 60s.
- Never send analyte values to a person whose consent.results is false. Assert this in a test.
- Never send anything to family before gate.step is disclosed/released, except the escalation notice.
- If OPENAI_API_KEY missing, fall back to templated text and set msg.simulated=true.
- Log every Anima request line to stdout.

# Additions (v2, patient-first UI), 12 Sep 13:40

## State additions
state.settings = { askFirst: true }            // ask Eleanor before sharing flagged results
state.pending  = { shareDecision: false }      // true while waiting for Eleanor's answer
gate.step may also be "awaiting_patient"       // practice told her, she has not yet decided to share
state.levels = { sarah:"everything", john:"practical", tom:"updates" }   // derived view of consent; keep consent topics as source of truth
  everything = results+followup+appointments+updates; practical = followup+appointments+updates; updates = updates only

## New routes
POST /api/consent/level {person, level}      -> sets the topic set for that level; returns state
POST /api/settings {askFirst:boolean}
POST /api/share {decision:"share"|"hold"}    -> only valid in awaiting_patient. share: release as today (step released), eleanor thread gets "Shared with Sarah and John." hold: step stays awaiting_patient, eleanor thread gets "Kept private. You can share later from Home."; nothing to family.
Change to POST /api/confirm-disclosure: after markDisclosed, if settings.askFirst && gate.abnormal.length>0 -> step "awaiting_patient", pending.shareDecision=true, eleanor thread gets kind "ask" message: "Your practice has talked you through your liver test. It is flagged. Do you want to share it with your circle?" and DO NOT release. Otherwise release immediately as now.
GET /api/insights -> longitudinal engine over the Anima patient view (gp + wearables). No LLM required; rules. Cache 60s.
{
  asOf: ISO,
  cards: [ { id, system: "metabolic"|"immune"|"liver"|"kidney"|"inflammation"|"mobility"|"heart"|"sleep",
             headline: string (<=70 chars, second person, plain English, no jargon),
             detail: string (<=140 chars, says what the numbers did and over what period),
             trend: "improving"|"stable"|"worsening"|"watch",
             audience: ["eleanor","sarah"] (people whose consent.results is true; mobility/heart/sleep cards go to anyone with updates),
             series: [{date, v}], lo, hi, unit, analyteName } ],
  upcoming: [ { at: ISO, title, who, detail } ]   // from appointment resources + discharge followUp text
}
Rules (implement exactly, keep pure in lib/insights.mjs with tests):
- For each analyte of interest [hba1c, white-cell-count, neutrophils, potassium, creatinine, bilirubin, albumin, crp]: take last 6 panels. trend = improving if the last 3 values move monotonically toward the reference midpoint and the latest is closer than 3 panels ago; worsening if monotonically away and latest out of range; watch if latest out of range and not improving; stable otherwise.
- Steps: compare the latest 3 days mean with the first 3 days mean of the available window; worsening if down >30%, improving if up >20%, else stable. Baseline from the "Activity trend below personal baseline" observation when present.
- Heart rate and sleep: stable unless latest is >15% from window mean.
- Headline templates per (analyte, trend); e.g. hba1c improving: "Your sugar control has improved {n} panels in a row"; neutrophils watch: "Your infection-fighting cells have been low since {month}"; steps worsening: "You are moving less than usual this week".
- Cards sorted: worsening, watch, improving, stable. Max 6.
