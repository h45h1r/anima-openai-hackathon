import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemo, applyAction, snapshot } from "./model.ts";

const login = (state, actor) => applyAction(state, { type: "login", actor });
const share = (state, relative, category, allowed) =>
  applyAction(state, { type: "consent", relative, category, allowed });

test("logged-out snapshots contain no records, grants, messages, or audit", () => {
  const view = snapshot(createDemo());
  assert.equal(view.appointment, null);
  assert.equal(view.result, null);
  assert.equal(view.grants, null);
  assert.deepEqual(view.events, []);
});

test("daughter cannot fetch results or self-authorise", () => {
  const state = createDemo();
  login(state, "sarah");
  assert.throws(() => share(state, "sarah", "results", true), /Only Eleanor/);
  applyAction(state, { type: "chat", text: "Explain Mum's eGFR result" });
  const view = snapshot(state);
  assert.equal(view.result, null);
  assert.equal(view.grants, null);
  assert.match(view.messages.at(-1).text, /not shared/);
  assert.doesNotMatch(JSON.stringify(view), /\b48\b|\b54\b|DEMO-LAB-001/);
});

test("patient grants results through chat; only that family member gains access", () => {
  const state = createDemo();
  login(state, "eleanor");
  applyAction(state, { type: "chat", text: "Let Sarah see my test results" });
  assert.equal(state.version, 2);
  login(state, "sarah");
  assert.equal(snapshot(state).result.value, "48");
  applyAction(state, { type: "chat", text: "Explain Mum's result" });
  assert.match(snapshot(state).messages.at(-1).source, /DEMO-LAB-001/);
  login(state, "tom");
  assert.equal(snapshot(state).result, null);
  assert.equal(snapshot(state).messages.length, 0);
});

test("revocation filters historical result messages and denies future requests", () => {
  const state = createDemo();
  login(state, "eleanor");
  share(state, "sarah", "results", true);
  login(state, "sarah");
  applyAction(state, {
    type: "chat",
    text: "What does 48 on Mum's eGFR result mean?",
  });
  login(state, "eleanor");
  applyAction(state, {
    type: "chat",
    text: "Stop sharing my test results with Sarah",
  });
  login(state, "sarah");
  assert.doesNotMatch(
    JSON.stringify(snapshot(state)),
    /\b48\b|\b54\b|DEMO-LAB-001/,
  );
  applyAction(state, { type: "chat", text: "Explain the result again" });
  assert.match(snapshot(state).messages.at(-1).text, /not shared/);
});

test("ambiguous or negative sharing text never silently grants access", () => {
  const state = createDemo();
  login(state, "eleanor");
  for (const text of [
    "Let Sarah not see my test results",
    "Let Sarah see my test results but not Tom",
    "Can Sarah access my results?",
  ]) {
    applyAction(state, { type: "chat", text });
    assert.equal(state.grants.sarah.results, false);
    assert.equal(state.version, 1);
  }
});

test("reminders respect consent, are idempotent, and keep recipient receipts separate", () => {
  const state = createDemo();
  login(state, "eleanor");
  share(state, "tom", "appointments", false);
  applyAction(state, { type: "remind" });
  applyAction(state, { type: "remind" });
  assert.equal(state.notices.length, 1);
  const id = state.notices[0].id;
  login(state, "tom");
  assert.equal(snapshot(state).notices.length, 0);
  assert.throws(() => applyAction(state, { type: "read", id }), /unavailable/);
  login(state, "sarah");
  applyAction(state, { type: "read", id });
  assert.equal(snapshot(state).notices[0].read, true);
});

test("revoking appointments withholds previously generated reminders", () => {
  const state = createDemo();
  login(state, "eleanor");
  applyAction(state, { type: "remind" });
  share(state, "sarah", "appointments", false);
  login(state, "sarah");
  assert.equal(snapshot(state).appointment, null);
  assert.deepEqual(snapshot(state).notices, []);
});

test("demo runs are independent and reset clears the entire journey", () => {
  const one = createDemo();
  const two = createDemo();
  login(one, "eleanor");
  share(one, "sarah", "results", true);
  applyAction(one, { type: "remind" });
  assert.equal(two.grants.sarah.results, false);
  assert.equal(two.notices.length, 0);
  applyAction(one, { type: "reset" });
  assert.deepEqual(one, createDemo());
});
