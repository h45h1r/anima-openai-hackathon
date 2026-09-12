// CareCircle gate: pure state transitions and audience filtering. No I/O.
// Every function returns a new state object; nothing is mutated.

export const PATIENT = { id: "SIM-000006", name: "Eleanor Chen", age: 83 };

export const PEOPLE = [
  { id: "eleanor", name: "Eleanor", role: "patient" },
  { id: "sarah", name: "Sarah", role: "daughter" },
  { id: "john", name: "John", role: "husband" },
  { id: "tom", name: "Tom", role: "son" },
];

export const TOPICS = ["results", "followup", "appointments", "updates"];
export const FAMILY_IDS = ["sarah", "john", "tom"];
export const STEPS = ["idle", "ordered", "result_detected", "disclosed", "awaiting_patient", "released", "escalated"];

// Sharing levels are a derived view of consent; the consent topics stay the source of truth.
export const LEVELS = {
  everything: { results: true, followup: true, appointments: true, updates: true },
  practical: { results: false, followup: true, appointments: true, updates: true },
  updates: { results: false, followup: false, appointments: false, updates: true },
};

const DEFAULT_CONSENT = {
  sarah: { results: true, followup: true, appointments: true, updates: true },
  john: { results: false, followup: false, appointments: true, updates: true },
  tom: { results: false, followup: false, appointments: false, updates: true },
};

const DEFAULT_SETTINGS = { askFirst: true };

export const TEXT = {
  held: "A new blood result has arrived. Your practice will talk you through it.",
  ask: "Your practice has talked you through your liver test. It is flagged. Do you want to share it with your circle?",
  kept: "Kept private. You can share later from Home.",
  shared: (names) => `Shared with ${names.join(" and ")}.`,
  updatesOnly: "No action needed from you this week. Eleanor's practice is in touch with her.",
  appointments:
    "Eleanor has a practice follow-up appointment coming up to talk through a recent blood test. Please help her get there if you can.",
  followup:
    "Eleanor's practice has asked for a follow-up. Could you make sure she attends and has a lift if she needs one?",
  escalationPatient: "We will phone your landline today about a recent blood test.",
  escalationFamily: "There is something the practice needs to discuss with Eleanor. No details yet.",
  taskTitle: "CareCircle: LFT result discussed, arrange follow-up",
  escalationTaskTitle: (days) =>
    `CareCircle safety net: abnormal LFT not yet discussed with patient (${days} days)`,
};

export function initialState(simNow = null) {
  return {
    patient: { ...PATIENT },
    people: PEOPLE.map((p) => ({ ...p })),
    consent: cloneConsent(DEFAULT_CONSENT),
    gate: {
      step: "idle",
      testResourceId: null,
      orderedAt: null,
      resultAt: null,
      disclosedAt: null,
      releasedAt: null,
      escalatedAt: null,
      analytes: null,
      abnormal: [],
    },
    threads: { sarah: [], john: [], tom: [], family: [], eleanor: [] },
    trail: [],
    simNow,
    settings: { ...DEFAULT_SETTINGS },
    pending: { shareDecision: false },
  };
}

export function levelFor(topics = {}) {
  if (topics.results) return "everything";
  if (topics.followup || topics.appointments) return "practical";
  return "updates";
}

export function levelsFor(consent) {
  return Object.fromEntries(Object.entries(consent).map(([id, topics]) => [id, levelFor(topics)]));
}

// Attach the derived levels view; call on every response, never persist it.
export function withLevels(state) {
  return { ...state, levels: levelsFor(state.consent) };
}

export function setLevel(state, person, level) {
  if (!(person in state.consent)) throw new Error(`Unknown person: ${person}`);
  if (!(level in LEVELS)) throw new Error(`Unknown level: ${level}`);
  return { ...state, consent: { ...state.consent, [person]: { ...LEVELS[level] } } };
}

export function setSettings(state, patch = {}) {
  const next = { ...state.settings };
  if ("askFirst" in patch) next.askFirst = Boolean(patch.askFirst);
  return { ...state, settings: next };
}

function cloneConsent(c) {
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, { ...v }]));
}

export function withSimNow(state, simNow) {
  return simNow ? { ...state, simNow } : state;
}

export function addTrail(state, entry) {
  return { ...state, trail: [...state.trail, entry] };
}

export function addMessage(state, thread, msg) {
  if (!(thread in state.threads)) throw new Error(`Unknown thread: ${thread}`);
  return { ...state, threads: { ...state.threads, [thread]: [...state.threads[thread], msg] } };
}

export function setConsent(state, person, topic, allowed) {
  if (!(person in state.consent)) throw new Error(`Unknown person: ${person}`);
  if (!TOPICS.includes(topic)) throw new Error(`Unknown topic: ${topic}`);
  return {
    ...state,
    consent: { ...state.consent, [person]: { ...state.consent[person], [topic]: Boolean(allowed) } },
  };
}

export function markOrdered(state, testResourceId, at) {
  return { ...state, gate: { ...state.gate, step: "ordered", testResourceId, orderedAt: at } };
}

export function mapAnalytes(raw = []) {
  return raw.map((a) => ({
    id: a.id,
    name: a.name,
    unit: a.unit,
    lo: a.referenceLow,
    hi: a.referenceHigh,
    v: a.value,
  }));
}

// Out of range, or moved more than 25% against the previous panel of the same test.
export function computeAbnormal(analytes = [], previous = []) {
  return analytes
    .filter((a) => {
      if (a.v < a.lo || a.v > a.hi) return true;
      const prev = previous.find((x) => x.id === a.id);
      return !!prev && prev.v > 0 && Math.abs(a.v - prev.v) / prev.v > 0.25;
    })
    .map((a) => a.name);
}

// Latest historical report for the same panel, excluding the ordered test itself.
export function previousPanel(resources = [], panelId, excludeId) {
  const reports = resources
    .filter((r) => r.id !== excludeId && r.kind === "report" && r.data?.panel?.id === panelId && Array.isArray(r.data?.analytes))
    .sort((a, b) => (b.data.collectedAt || 0) - (a.data.collectedAt || 0));
  return reports.length ? mapAnalytes(reports[0].data.analytes) : [];
}

// Find the ordered test resource with a result attached, or null.
export function findResult(resources = [], testResourceId) {
  if (!testResourceId) return null;
  const r = resources.find((x) => x.id === testResourceId);
  if (!r) return null;
  const hasAnalytes = Array.isArray(r.data?.analytes) && r.data.analytes.length > 0;
  return hasAnalytes || r.status === "available" ? r : null;
}

export function markResultDetected(state, resource, at, previous = []) {
  const analytes = mapAnalytes(resource.data?.analytes || []);
  const next = {
    ...state,
    gate: { ...state.gate, step: "result_detected", resultAt: at, analytes, abnormal: computeAbnormal(analytes, previous) },
  };
  return addMessage(next, "eleanor", { at, from: "agent", text: TEXT.held, kind: "held" });
}

export function markDisclosed(state, at) {
  return { ...state, gate: { ...state.gate, step: "disclosed", disclosedAt: at } };
}

export function markReleased(state, at) {
  return { ...state, gate: { ...state.gate, step: "released", releasedAt: at }, pending: { ...state.pending, shareDecision: false } };
}

// After the practice has told her: ask Eleanor first when the result is flagged and askFirst is on.
export function shouldAskPatient(state) {
  return Boolean(state.settings?.askFirst) && state.gate.abnormal.length > 0;
}

export function markAwaitingPatient(state, at) {
  if (state.gate.step !== "disclosed") throw new Error("Can only ask the patient after disclosure");
  const next = { ...state, gate: { ...state.gate, step: "awaiting_patient" }, pending: { ...state.pending, shareDecision: true } };
  return addMessage(next, "eleanor", { at, from: "agent", text: TEXT.ask, kind: "ask" });
}

export function canShare(state) {
  return state.gate.step === "awaiting_patient";
}

// Eleanor keeps it private: step stays awaiting_patient so she can share later; nothing reaches the family.
export function markHeld(state, at) {
  if (!canShare(state)) throw new Error("No share decision pending");
  const next = { ...state, pending: { ...state.pending, shareDecision: false } };
  return addMessage(next, "eleanor", { at, from: "agent", text: TEXT.kept, kind: "info" });
}

// Family members who receive more than the updates-only notice.
export function sharedWithNames(state) {
  return FAMILY_IDS.filter((id) => levelFor(state.consent[id]) !== "updates").map((id) => state.people.find((p) => p.id === id)?.name || id);
}

// Eleanor chose to share: the result is now disclosed to the circle and release may proceed.
export function markShared(state, at) {
  if (!canShare(state)) throw new Error("No share decision pending");
  const next = { ...state, gate: { ...state.gate, step: "disclosed" }, pending: { ...state.pending, shareDecision: false } };
  return addMessage(next, "eleanor", { at, from: "agent", text: TEXT.shared(sharedWithNames(state)), kind: "info" });
}

export function canEscalate(state) {
  return state.gate.step === "result_detected" && state.gate.abnormal.length > 0;
}

export function markEscalated(state, at) {
  if (!canEscalate(state)) throw new Error("Escalation requires an undisclosed abnormal result");
  let next = { ...state, gate: { ...state.gate, step: "escalated", escalatedAt: at } };
  next = addMessage(next, "eleanor", { at, from: "agent", text: TEXT.escalationPatient, kind: "escalation" });
  return addMessage(next, "family", { at, from: "agent", text: TEXT.escalationFamily, kind: "escalation" });
}

// Released to the circle (or in the act of releasing). awaiting_patient is NOT disclosed to the family.
export function isDisclosed(state) {
  return ["disclosed", "released"].includes(state.gate.step);
}

// The practice has talked Eleanor through it, whether or not she has shared yet.
export function isPatientTold(state) {
  return isDisclosed(state) || state.gate.step === "awaiting_patient";
}

// Family thread may only be written after disclosure, or for escalation notices.
export function canPostToFamily(state, kind) {
  return kind === "escalation" || isDisclosed(state);
}

// Which release messages each audience gets. Returns [{thread, kind, template|"explain"}].
// The "explain" entries need generated text (grounded in visibleContextFor) from the caller.
export function releasePlan(state) {
  const plan = [{ thread: "eleanor", kind: "explain" }];
  for (const id of FAMILY_IDS) {
    const c = state.consent[id];
    if (c.results) plan.push({ thread: id, kind: "explain" });
    if (c.followup) plan.push({ thread: id, kind: "task", text: TEXT.followup });
    if (!c.results && !c.followup && c.appointments) plan.push({ thread: id, kind: "info", text: TEXT.appointments });
    if (!c.results && !c.followup && !c.appointments && c.updates)
      plan.push({ thread: id, kind: "info", text: TEXT.updatesOnly });
  }
  plan.push({ thread: "family", kind: "info", text: TEXT.appointments });
  return plan;
}

// The only facts a message to `person` may draw on. Analytes are absent unless results consent is true.
export function visibleContextFor(person, state) {
  const who = state.people.find((p) => p.id === person);
  if (!who) throw new Error(`Unknown person: ${person}`);
  const consent = person === "eleanor"
    ? { results: true, followup: true, appointments: true, updates: true }
    : { ...state.consent[person] };
  const disclosed = person === "eleanor" ? isPatientTold(state) : isDisclosed(state);
  const resultsVisible = consent.results && disclosed;
  return {
    person: who.id,
    name: who.name,
    role: who.role,
    patient: { name: state.patient.name, age: state.patient.age },
    consent,
    gateStep: state.gate.step,
    disclosed,
    hasNewResult: state.gate.analytes !== null,
    panel: "Liver function tests (LFT)",
    analytes: resultsVisible ? state.gate.analytes.map((a) => ({ ...a })) : null,
    abnormal: resultsVisible ? [...state.gate.abnormal] : null,
    appointment: consent.appointments
      ? "Practice follow-up appointment with the nurse at Riverside Practice"
      : null,
  };
}

// True if any analyte value appears as a number in the text. Used as a hard guard.
export function containsAnalyteValues(text, analytes = []) {
  if (!text || !analytes?.length) return false;
  const numbers = (text.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  return analytes.some((a) => numbers.includes(Number(a.v)));
}

export function isResultsQuestion(question = "") {
  return /\b(result|results|blood|test|lft|liver|level|levels|number|numbers|value|values|normal|abnormal|alt|alp|bilirubin|albumin|reading)\b/i.test(
    question,
  );
}
