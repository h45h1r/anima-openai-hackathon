import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildInsights, labTrend, labSeries, upcomingFrom } from "../lib/insights.mjs";
import { initialState, setConsent } from "../lib/gate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = (f) => JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", f), "utf8"));
const GP = load("p6-gp.json");
const COMMUNITY = load("p6-community.json");
const AS_OF = new Date(GP.now).toISOString(); // 2026-09-12T08:00:00.000Z sim clock
const VIEW = { gp: GP.resources, wearables: COMMUNITY.resources };

const card = (insights, id) => insights.cards.find((c) => c.id === id);

test("fixture is Eleanor's real shape: 6 panels x 6 dates, 8 days of steps, one appointment, one letter", () => {
  const reports = GP.resources.filter((r) => r.kind === "report");
  assert.equal(reports.length, 36);
  assert.equal(new Set(reports.map((r) => r.data.panel.id)).size, 6);
  assert.equal(COMMUNITY.resources.filter((r) => r.data?.metric === "steps").length, 8);
  assert.equal(GP.resources.filter((r) => r.kind === "appointment").length, 1);
  assert.equal(GP.resources.filter((r) => r.kind === "discharge-summary").length, 1);
});

test("hba1c card: improving, 3 panels in a row toward range", () => {
  const out = buildInsights(VIEW, AS_OF);
  const c = card(out, "lab-hba1c");
  assert.ok(c, "hba1c card present");
  assert.equal(c.trend, "improving");
  assert.equal(c.system, "metabolic");
  assert.equal(c.headline, "Your sugar control has improved 3 panels in a row");
  assert.deepEqual(c.series.map((p) => p.v), [51, 57, 61, 60, 55, 49]);
  assert.equal(c.lo, 20);
  assert.equal(c.hi, 41);
  assert.equal(c.unit, "mmol/mol");
});

test("neutrophils card: watch (still low, not monotonically improving)", () => {
  const out = buildInsights(VIEW, AS_OF);
  const c = card(out, "lab-neutrophils");
  assert.ok(c, "neutrophils card present");
  assert.ok(["watch", "worsening"].includes(c.trend), c.trend);
  assert.equal(c.system, "immune");
  assert.equal(c.headline, "Your infection-fighting cells have been low since July");
});

test("steps card: worsening, baseline taken from the flagged observation", () => {
  const out = buildInsights(VIEW, AS_OF);
  const c = card(out, "steps");
  assert.ok(c, "steps card present");
  assert.equal(c.trend, "worsening");
  assert.equal(c.system, "mobility");
  assert.equal(c.headline, "You are moving less than usual this week");
  assert.equal(c.lo, 4200);
  assert.equal(c.series.length, 8);
  assert.match(c.detail, /2,333 a day/);
  assert.match(c.detail, /down 47%/);
  assert.match(c.detail, /usual is 4,200/);
});

test("bilirubin is worsening (rising away from range for three panels)", () => {
  assert.equal(labTrend(labSeries(GP.resources, "bilirubin")), "worsening");
  const c = card(buildInsights(VIEW, AS_OF), "lab-bilirubin");
  assert.equal(c.headline, "Your liver reading has been rising since July");
});

test("heart rate and sleep are stable within 15% of the window mean", () => {
  const all = buildInsights(VIEW, AS_OF);
  // They are pushed off the 6-card list by stronger signals; check the rule directly on a larger cap.
  assert.equal(all.cards.some((c) => c.id === "heart-rate"), false);
  const hr = labTrendOf("heart-rate");
  const sleep = labTrendOf("sleep");
  assert.equal(hr, "stable");
  assert.equal(sleep, "stable");
  function labTrendOf(id) {
    const only = { gp: [], wearables: COMMUNITY.resources.filter((r) => r.data?.metric === id) };
    return card(buildInsights(only, AS_OF), id).trend;
  }
});

test("cards are sorted worsening, watch, improving, stable and capped at 6", () => {
  const out = buildInsights(VIEW, AS_OF);
  assert.equal(out.cards.length, 6);
  const rank = { worsening: 0, watch: 1, improving: 2, stable: 3 };
  const ranks = out.cards.map((c) => rank[c.trend]);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  assert.deepEqual(out.cards.map((c) => c.id), ["lab-bilirubin", "steps", "lab-white-cell-count", "lab-neutrophils", "lab-hba1c", "lab-potassium"]);
});

test("headline and detail length limits hold for every card", () => {
  for (const c of buildInsights(VIEW, AS_OF).cards) {
    assert.ok(c.headline.length <= 70, `${c.id} headline ${c.headline.length}: ${c.headline}`);
    assert.ok(c.detail.length <= 140, `${c.id} detail ${c.detail.length}: ${c.detail}`);
    assert.match(c.headline, /^You/);
  }
});

test("audience follows consent: results cards to results:true, mobility to updates", () => {
  const consent = initialState().consent;
  const out = buildInsights(VIEW, AS_OF, consent);
  assert.deepEqual(card(out, "lab-hba1c").audience, ["eleanor", "sarah"]);
  assert.deepEqual(card(out, "steps").audience, ["eleanor", "sarah", "john", "tom"]);
  const johnSees = setConsent(initialState(), "john", "results", true).consent;
  assert.deepEqual(card(buildInsights(VIEW, AS_OF, johnSees), "lab-hba1c").audience, ["eleanor", "sarah", "john"]);
});

test("upcoming contains the 08:30 practice follow-up and the renal letter follow-up", () => {
  const out = buildInsights(VIEW, AS_OF);
  const appt = out.upcoming.find((u) => u.title === "Practice follow-up");
  assert.ok(appt, "practice follow-up present");
  assert.equal(appt.at, "2026-09-12T08:30:00.000Z");
  assert.equal(appt.who, "Nurse Alex Morgan");
  assert.equal(appt.detail, "In person, 15 min");
  const letter = out.upcoming.find((u) => /Renal/.test(u.title));
  assert.ok(letter, "renal follow-up present");
  assert.match(letter.detail, /clinic secretary/i);
  assert.equal(out.asOf, AS_OF);
});

test("engine is tolerant of empty input", () => {
  const out = buildInsights({ gp: [], wearables: [] }, AS_OF);
  assert.deepEqual(out.cards, []);
  assert.deepEqual(upcomingFrom([], AS_OF), []);
});
