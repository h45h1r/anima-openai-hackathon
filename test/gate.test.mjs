import { test } from "node:test";
import assert from "node:assert/strict";
import * as gate from "../lib/gate.mjs";
import { explainTemplate, askTemplate, consentTemplate } from "../lib/llm.mjs";

const RAW_ANALYTES = [
  { id: "alt", name: "ALT", unit: "U/L", value: 11, referenceLow: 0, referenceHigh: 40 },
  { id: "alp", name: "Alkaline phosphatase", unit: "U/L", value: 55, referenceLow: 30, referenceHigh: 130 },
  { id: "bilirubin", name: "Bilirubin", unit: "µmol/L", value: 25, referenceLow: 0, referenceHigh: 21 },
  { id: "albumin", name: "Albumin", unit: "g/L", value: 33, referenceLow: 35, referenceHigh: 50 },
];
const RESULT = { id: "r-1", status: "available", data: { analytes: RAW_ANALYTES } };
const AT = "2026-09-12T10:00:00.000Z";

function detectedState() {
  const ordered = gate.markOrdered(gate.initialState(), "r-1", AT);
  return gate.markResultDetected(ordered, RESULT, AT);
}

function allMessagesTo(state, thread) {
  return state.threads[thread].map((m) => m.text).join("\n");
}

test("initial state matches the contract shape", () => {
  const s = gate.initialState("2026-09-12T08:00:00.000Z");
  assert.equal(s.patient.id, "SIM-000006");
  assert.deepEqual(Object.keys(s.threads), ["sarah", "john", "tom", "family", "eleanor"]);
  assert.equal(s.gate.step, "idle");
  assert.equal(s.gate.analytes, null);
  assert.deepEqual(s.gate.abnormal, []);
  assert.equal(s.consent.john.results, false);
  assert.equal(s.consent.tom.updates, true);
});

test("result detection computes abnormal by reference range and holds family", () => {
  const s = detectedState();
  assert.equal(s.gate.step, "result_detected");
  assert.deepEqual(s.gate.abnormal, ["Bilirubin", "Albumin"]);
  assert.equal(s.threads.eleanor.length, 1);
  assert.equal(s.threads.eleanor[0].kind, "held");
  for (const t of ["sarah", "john", "tom", "family"]) assert.equal(s.threads[t].length, 0);
});

test("no analyte values ever appear in a message to a person with results:false", () => {
  let s = gate.markDisclosed(detectedState(), AT);
  for (const item of gate.releasePlan(s)) {
    const ctx = gate.visibleContextFor(item.thread === "family" ? "tom" : item.thread, s);
    const text = item.kind === "explain" ? explainTemplate(ctx).text : item.text;
    s = gate.addMessage(s, item.thread, { at: AT, from: "agent", text, kind: item.kind });
  }
  for (const person of ["john", "tom"]) {
    assert.equal(s.consent[person].results, false);
    const ctx = gate.visibleContextFor(person, s);
    assert.equal(ctx.analytes, null, `${person} context must not carry analytes`);
    assert.equal(ctx.abnormal, null);
    const text = allMessagesTo(s, person) + "\n" + allMessagesTo(s, "family");
    assert.equal(gate.containsAnalyteValues(text, s.gate.analytes), false, `${person} saw a value: ${text}`);
    for (const a of s.gate.analytes) assert.equal(text.includes(a.name), false, `${person} saw analyte name ${a.name}`);
    const refusal = askTemplate(ctx, "What were her liver results?");
    assert.match(refusal.text, /not shared/);
    assert.equal(gate.containsAnalyteValues(refusal.text, s.gate.analytes), false);
  }
  const sarah = gate.visibleContextFor("sarah", s);
  assert.equal(sarah.analytes.length, 4);
  assert.match(allMessagesTo(s, "sarah"), /Bilirubin/);
});

test("containsAnalyteValues detects leaked numbers", () => {
  const analytes = gate.mapAnalytes(RAW_ANALYTES);
  assert.equal(gate.containsAnalyteValues("Her bilirubin was 25 today", analytes), true);
  assert.equal(gate.containsAnalyteValues("See you at 3pm on the 12th", analytes), false);
});

test("no family message before disclosure, except escalation", () => {
  const s = detectedState();
  assert.equal(gate.canPostToFamily(s, "info"), false);
  assert.equal(gate.canPostToFamily(s, "explain"), false);
  assert.equal(gate.canPostToFamily(s, "escalation"), true);
  assert.equal(gate.canPostToFamily(gate.markOrdered(gate.initialState(), "r-1", AT), "info"), false);
  const escalated = gate.markEscalated(s, AT);
  assert.equal(escalated.threads.family.length, 1);
  assert.equal(escalated.threads.family[0].kind, "escalation");
  assert.equal(escalated.threads.family[0].text, gate.TEXT.escalationFamily);
  assert.equal(gate.containsAnalyteValues(escalated.threads.family[0].text, escalated.gate.analytes), false);
  assert.equal(gate.canPostToFamily(gate.markDisclosed(s, AT), "info"), true);
  assert.equal(gate.releasePlan(gate.markDisclosed(s, AT)).some((i) => i.thread === "family"), true);
});

test("escalation only fires when undisclosed and abnormal", () => {
  assert.equal(gate.canEscalate(gate.initialState()), false);
  assert.equal(gate.canEscalate(gate.markOrdered(gate.initialState(), "r-1", AT)), false);
  const abnormal = detectedState();
  assert.equal(gate.canEscalate(abnormal), true);
  assert.equal(gate.canEscalate(gate.markDisclosed(abnormal, AT)), false);
  assert.equal(gate.canEscalate(gate.markReleased(gate.markDisclosed(abnormal, AT), AT)), false);
  const normalRaw = RAW_ANALYTES.map((a) => ({ ...a, value: (a.referenceLow + a.referenceHigh) / 2 }));
  const normal = gate.markResultDetected(gate.markOrdered(gate.initialState(), "r-1", AT), { id: "r-1", status: "available", data: { analytes: normalRaw } }, AT);
  assert.deepEqual(normal.gate.abnormal, []);
  assert.equal(gate.canEscalate(normal), false);
  assert.throws(() => gate.markEscalated(normal, AT));
  assert.throws(() => gate.markEscalated(gate.markDisclosed(abnormal, AT), AT));
});

test("release plan follows consent tiers and is immutable", () => {
  const s = gate.markDisclosed(detectedState(), AT);
  const plan = gate.releasePlan(s);
  const threads = (t) => plan.filter((i) => i.thread === t).map((i) => i.kind);
  assert.deepEqual(threads("sarah"), ["explain", "task"]);
  assert.deepEqual(threads("john"), ["info"]);
  assert.deepEqual(threads("tom"), ["info"]);
  assert.equal(plan.find((i) => i.thread === "tom").text, gate.TEXT.updatesOnly);
  assert.equal(plan.find((i) => i.thread === "john").text, gate.TEXT.appointments);
  const changed = gate.setConsent(s, "john", "results", true);
  assert.equal(s.consent.john.results, false);
  assert.equal(changed.consent.john.results, true);
  assert.deepEqual(gate.releasePlan(changed).filter((i) => i.thread === "john").map((i) => i.kind), ["explain"]);
});

test("findResult only matches the ordered resource once analytes are present", () => {
  const open = [{ id: "r-1", status: "open", data: {} }, { id: "r-2", status: "available", data: { analytes: RAW_ANALYTES } }];
  assert.equal(gate.findResult(open, "r-1"), null);
  assert.equal(gate.findResult([open[1], RESULT], "r-1")?.id, "r-1");
  assert.equal(gate.findResult([open[1]], null), null);
});

test("consent template fallback parses simple instructions", () => {
  const r = consentTemplate("Let John see my results");
  assert.deepEqual(r.applied, [{ person: "john", topic: "results", allowed: true }]);
  const stop = consentTemplate("Stop sharing appointments with Tom");
  assert.deepEqual(stop.applied, [{ person: "tom", topic: "appointments", allowed: false }]);
});

test("consent template fallback parses compound sentences clause by clause", () => {
  const r = consentTemplate("Let John see my results and stop sharing appointments with Tom");
  assert.deepEqual(r.applied, [
    { person: "john", topic: "results", allowed: true },
    { person: "tom", topic: "appointments", allowed: false },
  ]);
});

test("computeAbnormal flags a >25% move against the previous panel even when in range", async () => {
  const { computeAbnormal } = await import("../lib/gate.mjs");
  const now = [{ id: "bilirubin", name: "Bilirubin", unit: "µmol/L", lo: 0, hi: 21, v: 13 }];
  const prev = [{ id: "bilirubin", name: "Bilirubin", unit: "µmol/L", lo: 0, hi: 21, v: 25 }];
  assert.deepEqual(computeAbnormal(now, prev), ["Bilirubin"]);
  assert.deepEqual(computeAbnormal(now, [{ ...prev[0], v: 14 }]), []);
});

// ---------- v2: ask Eleanor first ----------
function toldState() {
  return gate.markDisclosed(detectedState(), AT);
}

function applyRelease(s) {
  for (const item of gate.releasePlan(s)) s = gate.addMessage(s, item.thread, { at: AT, from: "agent", text: item.text || "explain", kind: item.kind });
  return gate.markReleased(s, AT);
}

test("initial state carries settings, pending and derived levels", () => {
  const s = gate.initialState();
  assert.deepEqual(s.settings, { askFirst: true });
  assert.deepEqual(s.pending, { shareDecision: false });
  assert.ok(gate.STEPS.includes("awaiting_patient"));
  assert.deepEqual(gate.withLevels(s).levels, { sarah: "everything", john: "practical", tom: "updates" });
  assert.equal("levels" in s, false, "levels are derived, not persisted");
});

test("askFirst holds release: abnormal result waits for Eleanor, family threads stay empty", () => {
  const told = toldState();
  assert.equal(gate.shouldAskPatient(told), true);
  const waiting = gate.markAwaitingPatient(told, AT);
  assert.equal(waiting.gate.step, "awaiting_patient");
  assert.equal(waiting.pending.shareDecision, true);
  assert.equal(waiting.threads.eleanor.at(-1).kind, "ask");
  assert.equal(waiting.threads.eleanor.at(-1).text, gate.TEXT.ask);
  for (const t of ["sarah", "john", "tom", "family"]) assert.equal(waiting.threads[t].length, 0);
  assert.equal(gate.isDisclosed(waiting), false, "family must not see it as disclosed");
  assert.equal(gate.canPostToFamily(waiting, "info"), false);
  assert.equal(gate.visibleContextFor("sarah", waiting).analytes, null);
  assert.equal(gate.visibleContextFor("eleanor", waiting).analytes.length, 4, "Eleanor herself has been told");
  assert.equal(gate.canShare(waiting), true);
  assert.equal(gate.canEscalate(waiting), false);
});

test("askFirst off, or a normal result, releases immediately", () => {
  const off = gate.setSettings(toldState(), { askFirst: false });
  assert.equal(off.settings.askFirst, false);
  assert.equal(gate.shouldAskPatient(off), false);
  const normalRaw = RAW_ANALYTES.map((a) => ({ ...a, value: (a.referenceLow + a.referenceHigh) / 2 }));
  const normal = gate.markResultDetected(gate.markOrdered(gate.initialState(), "r-1", AT), { id: "r-1", status: "available", data: { analytes: normalRaw } }, AT);
  assert.equal(gate.shouldAskPatient(gate.markDisclosed(normal, AT)), false);
  assert.throws(() => gate.markAwaitingPatient(detectedState(), AT), /after disclosure/);
});

test("share releases to the circle per consent and tells Eleanor who got it", () => {
  const waiting = gate.markAwaitingPatient(toldState(), AT);
  const shared = applyRelease(gate.markShared(waiting, AT));
  assert.equal(shared.gate.step, "released");
  assert.equal(shared.pending.shareDecision, false);
  assert.equal(shared.threads.eleanor.some((m) => m.text === "Shared with Sarah and John."), true);
  assert.ok(shared.threads.sarah.length > 0);
  assert.ok(shared.threads.john.length > 0);
  assert.ok(shared.threads.family.length > 0);
  assert.equal(gate.canShare(shared), false);
  assert.throws(() => gate.markShared(shared, AT));
});

test("hold keeps family threads empty and leaves the door open to share later", () => {
  const waiting = gate.markAwaitingPatient(toldState(), AT);
  const held = gate.markHeld(waiting, AT);
  assert.equal(held.gate.step, "awaiting_patient");
  assert.equal(held.pending.shareDecision, false);
  assert.equal(held.threads.eleanor.at(-1).text, gate.TEXT.kept);
  for (const t of ["sarah", "john", "tom", "family"]) assert.equal(held.threads[t].length, 0, `${t} must be empty after hold`);
  assert.equal(gate.canShare(held), true, "she can still share later from Home");
  assert.throws(() => gate.markHeld(gate.initialState(), AT));
  const later = applyRelease(gate.markShared(held, AT));
  assert.equal(later.gate.step, "released");
});

test("consent levels set the exact topic set and derive back to the same level", () => {
  let s = gate.initialState();
  s = gate.setLevel(s, "tom", "practical");
  assert.deepEqual(s.consent.tom, { results: false, followup: true, appointments: true, updates: true });
  assert.equal(gate.levelsFor(s.consent).tom, "practical");
  s = gate.setLevel(s, "john", "everything");
  assert.equal(gate.levelsFor(s.consent).john, "everything");
  s = gate.setLevel(s, "sarah", "updates");
  assert.deepEqual(s.consent.sarah, { results: false, followup: false, appointments: false, updates: true });
  assert.equal(gate.levelsFor(s.consent).sarah, "updates");
  assert.throws(() => gate.setLevel(s, "sarah", "all"));
  assert.throws(() => gate.setLevel(s, "eleanor", "updates"));
  assert.equal(gate.initialState().consent.tom.followup, false, "immutable");
});

test("share moves the gate to disclosed so Sarah's release context includes the numbers", () => {
  let s = gate.initialState();
  s = gate.markOrdered(s, "r-1", "2026-09-12T10:00:00Z");
  s = gate.markResultDetected(s, { id: "r-1", data: { analytes: [{ id: "alt", name: "ALT", unit: "U/L", referenceLow: 0, referenceHigh: 40, value: 55 }] } }, "2026-09-12T12:00:00Z");
  s = gate.markDisclosed(s, "2026-09-12T12:30:00Z");
  s = gate.markAwaitingPatient(s, "2026-09-12T12:30:00Z");
  assert.equal(gate.visibleContextFor("sarah", s).analytes, null);
  s = gate.markShared(s, "2026-09-12T12:36:00Z");
  assert.equal(s.gate.step, "disclosed");
  assert.equal(s.pending.shareDecision, false);
  assert.ok(Array.isArray(gate.visibleContextFor("sarah", s).analytes));
});
