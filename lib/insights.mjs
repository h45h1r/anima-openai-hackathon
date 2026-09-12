// CareCircle insights: pure longitudinal rules over the Anima patient view. No I/O, no LLM.
// buildInsights({ gp, wearables }, asOf, consent) -> { asOf, cards, upcoming }
import { initialState, FAMILY_IDS } from "./gate.mjs";

export const ANALYTES = [
  { id: "hba1c", system: "metabolic", noun: "sugar control" },
  { id: "white-cell-count", system: "immune", noun: "white blood cells", plural: true },
  { id: "neutrophils", system: "immune", noun: "infection-fighting cells", plural: true },
  { id: "potassium", system: "kidney", noun: "potassium level" },
  { id: "creatinine", system: "kidney", noun: "kidney reading" },
  { id: "bilirubin", system: "liver", noun: "liver reading" },
  { id: "albumin", system: "liver", noun: "blood protein level" },
  { id: "crp", system: "inflammation", noun: "inflammation marker" },
];

const PANELS = 6;
const TREND_RANK = { worsening: 0, watch: 1, improving: 2, stable: 3 };
const MAX_CARDS = 6;
const STEPS_DOWN = 0.3;
const STEPS_UP = 0.2;
const VITAL_DRIFT = 0.15;
const UPCOMING_LOOKBACK_MS = 7 * 24 * 3600 * 1000;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const iso = (ms) => new Date(ms).toISOString();
const day = (ms) => iso(ms).slice(0, 10);
const monthName = (date) => MONTHS[new Date(date).getUTCMonth()];
const dayMonth = (date) => `${new Date(date).getUTCDate()} ${monthName(date).slice(0, 3)}`;
const monthYear = (date) => `${monthName(date).slice(0, 3)} ${new Date(date).getUTCFullYear()}`;
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const fmt = (n) => (Number.isInteger(n) ? n.toLocaleString("en-GB") : String(n));
const pct = (a, b) => (b ? (a - b) / b : 0);

// ---------- series extraction ----------
export function labSeries(gp = [], analyteId) {
  return gp
    .filter((r) => r.kind === "report" && Array.isArray(r.data?.analytes))
    .map((r) => ({ at: r.data.collectedAt ?? r.createdAt ?? 0, a: r.data.analytes.find((x) => x.id === analyteId) }))
    .filter((x) => x.a && Number.isFinite(x.a.value))
    .sort((p, q) => p.at - q.at)
    .slice(-PANELS)
    .map(({ at, a }) => ({ date: day(at), v: a.value, lo: a.referenceLow, hi: a.referenceHigh, unit: a.unit, name: a.name }));
}

export function wearableSeries(wearables = [], metric) {
  return wearables
    .filter((r) => r.kind === "observation" && r.data?.metric === metric && Number.isFinite(r.data?.value))
    .sort((p, q) => (p.data.observedAt || 0) - (q.data.observedAt || 0))
    .map((r) => ({ date: day(r.data.observedAt || r.createdAt || 0), v: r.data.value, unit: r.data.unit }));
}

export function stepsBaseline(wearables = []) {
  const flag = wearables.find((r) => r.kind === "observation" && /below personal baseline/i.test(r.title || ""));
  return Number.isFinite(flag?.data?.baseline) ? flag.data.baseline : null;
}

// ---------- lab rules ----------
const outOfRange = (p) => p.v < p.lo || p.v > p.hi;

export function labTrend(series) {
  const n = series.length;
  if (n < 2) return "stable";
  const latest = series[n - 1];
  const mid = (latest.lo + latest.hi) / 2;
  const d = series.map((p) => Math.abs(p.v - mid));
  const last3 = d.slice(-3);
  const toward = last3.length === 3 && last3[0] > last3[1] && last3[1] > last3[2];
  const away = last3.length === 3 && last3[0] < last3[1] && last3[1] < last3[2];
  const threeAgo = d[Math.max(0, n - 4)];
  if (toward && d[n - 1] < threeAgo) return "improving";
  if (away && outOfRange(latest)) return "worsening";
  if (outOfRange(latest)) return "watch";
  return "stable";
}

// Consecutive panels (ending at the latest) that moved toward the reference midpoint.
function improvingStreak(series) {
  const mid = (series.at(-1).lo + series.at(-1).hi) / 2;
  let streak = 0;
  for (let i = series.length - 1; i > 0; i--) {
    if (Math.abs(series[i].v - mid) < Math.abs(series[i - 1].v - mid)) streak++;
    else break;
  }
  return streak;
}

// First panel of the run that is still out of range (or still moving away) at the latest panel.
function runStart(series, predicate) {
  let i = series.length - 1;
  while (i > 0 && predicate(series[i - 1], series[i])) i--;
  return series[i];
}

const LAB_HEADLINE = {
  improving: (a, s) => `Your ${a.noun} ${verb(a, "has", "have")} improved ${improvingStreak(s)} panels in a row`,
  worsening: (a, s) => {
    const start = runStart(s, (prev, cur) => Math.abs(cur.v - mid(s)) > Math.abs(prev.v - mid(s)));
    const dir = s.at(-1).v > s.at(-1).hi ? "rising" : "falling";
    return `Your ${a.noun} ${verb(a, "has", "have")} been ${dir} since ${monthName(start.date)}`;
  },
  watch: (a, s) => {
    const start = runStart(s, (prev) => outOfRange(prev));
    const level = s.at(-1).v < s.at(-1).lo ? "low" : "high";
    return `Your ${a.noun} ${verb(a, "has", "have")} been ${level} since ${monthName(start.date)}`;
  },
  stable: (a) => `Your ${a.noun} ${verb(a, "has", "have")} stayed steady`,
};
const mid = (s) => (s.at(-1).lo + s.at(-1).hi) / 2;
const verb = (a, singular, plural) => (a.plural ? plural : singular);

// Describes the run that drives the trend (the improving/worsening streak), else the whole window.
function labDetail(s, trend) {
  const m = mid(s);
  const start = trend === "improving"
    ? runStart(s, (prev, cur) => Math.abs(cur.v - m) < Math.abs(prev.v - m))
    : trend === "worsening"
      ? runStart(s, (prev, cur) => Math.abs(cur.v - m) > Math.abs(prev.v - m))
      : s[0];
  const window = s.slice(s.indexOf(start));
  const last = s.at(-1);
  const moved = last.v === start.v ? "stayed at" : last.v > start.v ? `rose from ${fmt(start.v)} to` : `fell from ${fmt(start.v)} to`;
  return `${last.name} ${moved} ${fmt(last.v)} ${last.unit} over ${window.length} panels (${monthYear(start.date)} to ${monthYear(last.date)}); usual range ${last.lo} to ${last.hi}.`;
}

function labCard(a, gp, audience) {
  const s = labSeries(gp, a.id);
  if (!s.length) return null;
  const trend = labTrend(s);
  const last = s.at(-1);
  return {
    id: `lab-${a.id}`,
    system: a.system,
    headline: LAB_HEADLINE[trend](a, s),
    detail: labDetail(s, trend),
    trend,
    audience,
    series: s.map(({ date, v }) => ({ date, v })),
    lo: last.lo,
    hi: last.hi,
    unit: last.unit,
    analyteName: last.name,
  };
}

// ---------- wearable rules ----------
function stepsCard(wearables, audience) {
  const s = wearableSeries(wearables, "steps");
  if (!s.length) return null;
  const first = mean(s.slice(0, 3).map((p) => p.v));
  const latest = mean(s.slice(-3).map((p) => p.v));
  const change = pct(latest, first);
  const trend = change < -STEPS_DOWN ? "worsening" : change > STEPS_UP ? "improving" : "stable";
  const baseline = stepsBaseline(wearables);
  const headline = {
    worsening: "You are moving less than usual this week",
    improving: "You are moving more than usual this week",
    stable: "Your activity has been steady this week",
  }[trend];
  const direction = change < 0 ? "down" : "up";
  const usual = baseline ? ` (your usual is ${fmt(baseline)})` : "";
  const detail = `Steps averaged ${fmt(Math.round(latest))} a day over the last 3 days, ${direction} ${Math.abs(Math.round(change * 100))}% on ${fmt(Math.round(first))} earlier in the window${usual}.`;
  return {
    id: "steps",
    system: "mobility",
    headline,
    detail,
    trend,
    audience,
    series: s.map(({ date, v }) => ({ date, v })),
    lo: baseline,
    hi: null,
    unit: s.at(-1).unit || "steps/day",
    analyteName: "Steps",
  };
}

function vitalCard({ id, metric, system, label, noun }, wearables, audience) {
  const s = wearableSeries(wearables, metric);
  if (!s.length) return null;
  const avg = mean(s.map((p) => p.v));
  const latest = s.at(-1).v;
  const drift = pct(latest, avg);
  const trend = Math.abs(drift) > VITAL_DRIFT ? "watch" : "stable";
  const headline = trend === "stable" ? `Your ${noun} has been steady` : `Your ${noun} is ${drift > 0 ? "higher" : "lower"} than usual`;
  const unit = s.at(-1).unit;
  const detail = `${label} was ${fmt(latest)} ${unit} on ${dayMonth(s.at(-1).date)}, against an average of ${fmt(Math.round(avg * 10) / 10)} ${unit} over ${s.length} days.`;
  return { id, system, headline, detail, trend, audience, series: s.map(({ date, v }) => ({ date, v })), lo: null, hi: null, unit: s.at(-1).unit, analyteName: label };
}

const VITALS = [
  { id: "heart-rate", metric: "heart-rate", system: "heart", label: "Resting heart rate", noun: "resting heart rate" },
  { id: "sleep", metric: "sleep", system: "sleep", label: "Sleep", noun: "sleep" },
];

// ---------- upcoming ----------
export function upcomingFrom(gp = [], asOf) {
  const since = Date.parse(asOf) - UPCOMING_LOOKBACK_MS;
  const appts = gp
    .filter((r) => r.kind === "appointment" && r.status !== "cancelled" && Number.isFinite(r.data?.startsAt) && r.data.startsAt >= since)
    .map((r) => ({
      at: iso(r.data.startsAt),
      title: r.title,
      who: r.data.clinician || "Practice",
      detail: [r.data.mode === "in-person" ? "In person" : r.data.mode, r.data.durationMinutes ? `${r.data.durationMinutes} min` : null].filter(Boolean).join(", "),
    }));
  const letters = gp
    .filter((r) => r.kind === "discharge-summary" && r.data?.sections?.followUp)
    .map((r) => ({
      at: iso(r.data.sentAt || r.createdAt || Date.parse(asOf)),
      title: `${(r.title || "Hospital").split(" · ")[0]} clinic follow-up (date to be confirmed)`,
      who: r.data.sentBy || "Hospital",
      detail: r.data.sections.followUp,
    }));
  return [...appts, ...letters].sort((a, b) => a.at.localeCompare(b.at));
}

// ---------- entry point ----------
export function buildInsights(view = {}, asOf, consent = initialState().consent) {
  const gp = Array.isArray(view) ? view : view.gp || view.resources || [];
  const wearables = Array.isArray(view) ? view : view.wearables || view.community || [];
  const resultsAudience = ["eleanor", ...FAMILY_IDS.filter((id) => consent[id]?.results)];
  const updatesAudience = ["eleanor", ...FAMILY_IDS.filter((id) => consent[id]?.updates)];
  const cards = [
    ...ANALYTES.map((a) => labCard(a, gp, resultsAudience)),
    stepsCard(wearables, updatesAudience),
    ...VITALS.map((v) => vitalCard(v, wearables, updatesAudience)),
  ]
    .filter(Boolean)
    .sort((a, b) => TREND_RANK[a.trend] - TREND_RANK[b.trend])
    .slice(0, MAX_CARDS);
  return { asOf, cards, upcoming: upcomingFrom(gp, asOf) };
}
