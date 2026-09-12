#!/usr/bin/env node
// Neighbourhood sweep against the Anima NHS-SIM. Read-only: only GET /api/clock,
// GET /api/sites/gp/patients and GET /api/sites/{gp,hospital}/view are called.
// Standalone: no imports from web/src, no npm dependencies (Node >= 18 for fetch).
//
//   node web/scripts/sweep.mjs [--n 2000] [--deadline-min 25] [--concurrency 5] [--skip-hospital] [--cache-only]
//
// Outputs web/scripts/out/sweep-summary.json and web/scripts/out/sweep-cases.json.
// Responses are cached in web/scripts/.cache/<id>.<site>.json so reruns are instant.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, "..");
const CACHE_DIR = path.join(__dirname, ".cache");
const OUT_DIR = path.join(__dirname, "out");

const DAY = 24 * 60 * 60 * 1000;
const ACTION_WINDOW_MS = 30 * DAY;
const TREND_SPAN_MS = 90 * DAY;
const CONCURRENCY_DEFAULT = 5;
const RETRIES = 6;
const PAGE_SIZE = 30;
const POPULATION = 50000;
const ELEANOR = "SIM-000006";
const TOP_CASES = 50;

// Rule B direction: "worse" means rising for these...
const RISING = new Set(["alt", "creatinine", "hba1c", "crp"]);
// ...and falling for these.
const FALLING = new Set(["egfr", "haemoglobin"]);
// "Clearly abnormal" variant: these analytes count when out of range at all.
const KEY_ANALYTES = new Set([
  "neutrophils", "white-cell-count", "haemoglobin", "potassium", "creatinine",
  "egfr", "hba1c", "crp", "alt", "bilirubin",
]);
const CLEAR_MARGIN = 1.2; // multiples of the reference width beyond the bound
const MISSED_STATUSES = new Set(["missed", "noshow", "no-show", "cancelled", "canceled", "dna", "did-not-attend"]);

// ---------- args + env ----------
const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const SAMPLE_N = Number(argVal("--n", "2000"));
const DEADLINE_MIN = Number(argVal("--deadline-min", "25"));
const SKIP_HOSPITAL = args.includes("--skip-hospital");
const CACHE_ONLY = args.includes("--cache-only"); // score only patients already in .cache, no network fetches
const CONCURRENCY = Number(argVal("--concurrency", String(CONCURRENCY_DEFAULT)));
const RUN_START = Date.now();
const FETCH_DEADLINE = RUN_START + DEADLINE_MIN * 60 * 1000;

function loadEnv() {
  const file = path.join(WEB_DIR, ".env.local");
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith("#")) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
const ENV = loadEnv();
const API_KEY = process.env.SIM_API_KEY || ENV.SIM_API_KEY;
const BASE = (process.env.SIM_BASE_URL || ENV.SIM_BASE_URL || "https://sim.animahealth.com").replace(/\/$/, "");
if (!API_KEY) {
  console.error("SIM_API_KEY not found in web/.env.local or the environment");
  process.exit(1);
}

// ---------- tiny fetch wrapper (copied from web/src/lib/sim/client.ts, GET only) ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let requestCount = 0;
let retryCount = 0;

async function call(p) {
  let lastErr;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      requestCount++;
      const res = await fetch(`${BASE}${p}`, {
        headers: { Authorization: `Bearer ${API_KEY}`, Accept: "application/json" },
        signal: AbortSignal.timeout(45000),
      });
      if (res.status >= 500) throw new Error(`sim ${res.status} on ${p}`);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw Object.assign(new Error(`sim ${res.status} on ${p}: ${body.slice(0, 200)}`), { fatal: true });
      }
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (e.fatal) throw e;
      retryCount++;
      if (attempt < RETRIES) await sleep(2500 * attempt);
    }
  }
  throw lastErr;
}

const sim = {
  clock: () => call("/api/clock"),
  listPatients: (offset) => call(`/api/sites/gp/patients?offset=${offset}`),
  view: (site, id, limit = 500) => call(`/api/sites/${site}/view?patient=${encodeURIComponent(id)}&limit=${limit}`),
};

// ---------- cache ----------
function cachePath(id, site) {
  return path.join(CACHE_DIR, `${id}.${site}.json`);
}
function readCache(id, site) {
  const f = cachePath(id, site);
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return null;
  }
}
async function fetchView(id, site) {
  const cached = readCache(id, site);
  if (cached) return { ...cached, fromCache: true };
  const view = await sim.view(site, id, 500);
  const resources = (view.resources ?? []).filter((r) => r.patientId === id);
  const slim = {
    id,
    site,
    fetchedAt: Date.now(),
    simNow: view.now,
    resourceTotal: view.resourceTotal,
    resources,
  };
  fs.writeFileSync(cachePath(id, site), JSON.stringify(slim));
  return { ...slim, fromCache: false };
}

// ---------- worker pool ----------
async function pool(items, worker) {
  const results = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, run));
  return results;
}

// ---------- helpers ----------
const pad6 = (n) => String(n).padStart(6, "0");
const iso = (ms) => (typeof ms === "number" ? new Date(ms).toISOString().slice(0, 10) : null);
const daysBetween = (a, b) => Math.round(((b - a) / DAY) * 10) / 10;

function ageAt(birthDate, nowMs) {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  const n = new Date(nowMs);
  let age = n.getUTCFullYear() - b.getUTCFullYear();
  const beforeBirthday =
    n.getUTCMonth() < b.getUTCMonth() || (n.getUTCMonth() === b.getUTCMonth() && n.getUTCDate() < b.getUTCDate());
  return beforeBirthday ? age - 1 : age;
}

function analyteFlag(a) {
  if (typeof a.value !== "number") return null;
  if (typeof a.referenceLow === "number" && a.value < a.referenceLow) return "low";
  if (typeof a.referenceHigh === "number" && a.value > a.referenceHigh) return "high";
  return null;
}
function isClearlyAbnormal(a, flag) {
  if (!flag) return false;
  if (KEY_ANALYTES.has(a.id)) return true;
  const width = a.referenceHigh - a.referenceLow;
  if (!(width > 0)) return false;
  return flag === "high" ? a.value > a.referenceHigh + CLEAR_MARGIN * width : a.value < a.referenceLow - CLEAR_MARGIN * width;
}

function describeAnalyte(a, flag) {
  return {
    code: a.id,
    name: a.name,
    value: a.value,
    unit: a.unit,
    referenceLow: a.referenceLow,
    referenceHigh: a.referenceHigh,
    flag,
  };
}

// Every "action" the sim can hold that counts as follow-up, with a timestamp.
function collectActions(resources) {
  const out = [];
  for (const r of resources) {
    if (r.kind === "task") out.push({ kind: "task", id: r.id, at: r.createdAt, title: r.title });
    else if (r.kind === "encounter") out.push({ kind: "encounter", id: r.id, at: r.createdAt, title: r.title });
    else if (r.kind === "test") out.push({ kind: "test-order", id: r.id, at: r.createdAt, title: r.title });
    else if (r.kind === "appointment") {
      const at = typeof r.data?.startsAt === "number" ? r.data.startsAt : r.createdAt;
      out.push({ kind: "appointment", id: r.id, at, title: r.title, status: r.status });
    } else if (r.kind === "conversation") {
      for (const e of r.data?.entries ?? []) {
        if (e.direction === "outgoing" && typeof e.at === "number")
          out.push({ kind: "message-to-patient", id: e.id ?? r.id, conversationId: r.id, at: e.at, title: r.title });
      }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}
function actionsAfter(actions, t0, windowEnd) {
  return actions.filter((a) => a.at > t0 && (windowEnd === undefined || a.at <= windowEnd));
}

// Results = report or test resources with analytes (seeded history + ordered tests).
function collectResults(resources) {
  return resources
    .filter((r) => (r.kind === "report" || r.kind === "test") && Array.isArray(r.data?.analytes))
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      panel: r.data.panel?.id ?? null,
      panelName: r.data.panel?.name ?? r.title,
      collectedAt: typeof r.data.collectedAt === "number" ? r.data.collectedAt : r.createdAt,
      createdAt: r.createdAt,
      analytes: r.data.analytes,
    }))
    .sort((a, b) => a.createdAt - b.createdAt);
}

// ---------- rules ----------
function ruleA(results, actions, now) {
  const triggers = [];
  let pending = 0;
  for (const res of results) {
    const abnormal = res.analytes.map((a) => [a, analyteFlag(a)]).filter(([, f]) => f);
    if (abnormal.length === 0) continue;
    const t0 = res.createdAt;
    if (now - t0 < ACTION_WINDOW_MS) {
      pending++;
      continue;
    }
    const followUp = actionsAfter(actions, t0, t0 + ACTION_WINDOW_MS);
    if (followUp.length > 0) continue;
    triggers.push({
      rule: "A",
      resourceId: res.id,
      resourceKind: res.kind,
      status: res.status,
      panel: res.panel,
      panelName: res.panelName,
      collectedAt: iso(res.collectedAt),
      createdAt: res.createdAt,
      ageDays: daysBetween(t0, now),
      clearlyAbnormal: abnormal.some(([a, f]) => isClearlyAbnormal(a, f)),
      analytes: abnormal.map(([a, f]) => ({ ...describeAnalyte(a, f), clearlyAbnormal: isClearlyAbnormal(a, f) })),
      followUpInWindow: [],
    });
  }
  return { triggers, pending };
}

function worse(code, prev, cur) {
  if (RISING.has(code)) return cur > prev;
  if (FALLING.has(code)) return cur < prev;
  return false;
}

function ruleB(results, actions, now) {
  const byCode = new Map();
  for (const res of results) {
    for (const a of res.analytes) {
      if (!RISING.has(a.id) && !FALLING.has(a.id)) continue;
      const flag = analyteFlag(a);
      if (!flag) continue;
      if (!byCode.has(a.id)) byCode.set(a.id, []);
      byCode.get(a.id).push({ res, a, flag });
    }
  }
  const triggers = [];
  for (const [code, obs] of byCode) {
    obs.sort((x, y) => x.res.createdAt - y.res.createdAt);
    // Longest strictly-worsening run of consecutive abnormal observations.
    let best = null;
    let run = [obs[0]];
    for (let i = 1; i <= obs.length; i++) {
      const cont = i < obs.length && worse(code, run[run.length - 1].a.value, obs[i].a.value);
      if (cont) {
        run.push(obs[i]);
      } else {
        if (run.length >= 2 && (!best || run.length > best.length)) best = run;
        if (i < obs.length) run = [obs[i]];
      }
    }
    if (!best) continue;
    const span = best[best.length - 1].res.createdAt - best[0].res.createdAt;
    if (span < TREND_SPAN_MS) continue;
    const latest = best[best.length - 1];
    const after = actionsAfter(actions, latest.res.createdAt);
    if (after.length > 0) continue;
    triggers.push({
      rule: "B",
      code,
      name: latest.a.name,
      unit: latest.a.unit,
      direction: RISING.has(code) ? "rising" : "falling",
      spanDays: daysBetween(best[0].res.createdAt, latest.res.createdAt),
      latestAgeDays: daysBetween(latest.res.createdAt, now),
      latestOlderThan30Days: now - latest.res.createdAt >= ACTION_WINDOW_MS,
      referenceLow: latest.a.referenceLow,
      referenceHigh: latest.a.referenceHigh,
      series: best.map(({ res, a, flag }) => ({
        resourceId: res.id,
        resourceKind: res.kind,
        panel: res.panel,
        collectedAt: iso(res.collectedAt),
        value: a.value,
        unit: a.unit,
        flag,
      })),
      actionsAfterLatest: [],
    });
  }
  return triggers;
}

function ruleC(resources) {
  const appts = resources.filter((r) => r.kind === "appointment");
  const statuses = appts.map((r) => String(r.status ?? "").toLowerCase());
  const triggers = [];
  for (const ap of appts) {
    const st = String(ap.status ?? "").toLowerCase();
    if (!MISSED_STATUSES.has(st)) continue;
    const at = typeof ap.data?.startsAt === "number" ? ap.data.startsAt : ap.createdAt;
    const rebooked = appts.some((o) => {
      if (o.id === ap.id) return false;
      const oat = typeof o.data?.startsAt === "number" ? o.data.startsAt : o.createdAt;
      return oat > at && (o.title ?? "") === (ap.title ?? "");
    });
    if (rebooked) continue;
    triggers.push({ rule: "C", resourceId: ap.id, status: ap.status, title: ap.title, startsAt: iso(at) });
  }
  return { triggers, statuses };
}

function scorePatient(patient, gp, hospital, now) {
  const resources = [...(gp?.resources ?? []), ...(hospital?.resources ?? [])];
  // De-duplicate resources visible on both sites.
  const seen = new Set();
  const uniq = resources.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  const actions = collectActions(uniq);
  const results = collectResults(uniq);
  const a = ruleA(results, actions, now);
  const b = ruleB(results, actions, now);
  const c = ruleC(uniq);
  const age = ageAt(patient.birthDate, now);
  const rules = [];
  if (b.length) rules.push("B");
  if (a.triggers.length) rules.push("A");
  if (c.triggers.length) rules.push("C");
  let score = 0;
  if (b.length) score += 3;
  if (a.triggers.length) score += 2;
  if (c.triggers.length) score += 1;
  if (age !== null && age >= 75) score += 1;
  return {
    id: patient.id,
    name: patient.name,
    age,
    score,
    rules,
    ruleA: a.triggers,
    ruleAClearlyAbnormal: a.triggers.some((t) => t.clearlyAbnormal),
    ruleAPending: a.pending,
    ruleB: b,
    ruleC: c.triggers,
    appointmentStatuses: c.statuses,
    resultCount: results.length,
    actionCount: actions.length,
  };
}

// ---------- main ----------
async function main() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const clock = await sim.clock();
  const now = clock.now;
  console.log(`sim clock now=${now} (${new Date(now).toISOString()}) paused=${clock.paused}; sample n=${SAMPLE_N}; fetch deadline ${DEADLINE_MIN} min`);

  // Step 1: enumerate patients via the documented listing (30 per page, offset only).
  const pages = Math.ceil(SAMPLE_N / PAGE_SIZE);
  let total = null;
  const roster = new Map();
  await pool(
    Array.from({ length: pages }, (_, i) => i * PAGE_SIZE),
    async (offset) => {
      const page = await sim.listPatients(offset);
      total = page.total ?? total;
      for (const p of page.items ?? []) roster.set(p.id, p);
    },
  );
  console.log(`roster: ${roster.size} patients listed (directory total ${total})`);

  // Ids are sequential; use the roster where present, else synthesise the id.
  const ids = Array.from({ length: SAMPLE_N }, (_, i) => `SIM-${pad6(i + 1)}`);
  const patients = ids.map((id) => roster.get(id) ?? { id, name: null, birthDate: null });

  // Step 2: fetch views (gp, then hospital) with cache, concurrency 5, retries.
  const fetched = [];
  let done = 0;
  let cacheHits = 0;
  let stoppedEarly = false;
  const fetchErrors = [];
  await pool(patients, async (p) => {
    if (Date.now() > FETCH_DEADLINE) {
      stoppedEarly = true;
      return;
    }
    if (CACHE_ONLY && !readCache(p.id, "gp")) return;
    try {
      const gp = await fetchView(p.id, "gp");
      if (gp.fromCache) cacheHits++;
      let hospital = null;
      if (!SKIP_HOSPITAL) hospital = await fetchView(p.id, "hospital");
      fetched.push({ patient: p, gp, hospital });
    } catch (e) {
      fetchErrors.push({ id: p.id, error: String(e.message ?? e) });
    }
    done++;
    if (done % 100 === 0) {
      const el = ((Date.now() - RUN_START) / 1000).toFixed(0);
      console.log(`progress: ${done}/${patients.length} patients fetched (${cacheHits} from cache, ${fetchErrors.length} errors, ${requestCount} requests, ${retryCount} retries) ${el}s`);
    }
  });
  if (stoppedEarly) console.log(`fetch deadline reached after ${fetched.length} patients; continuing with partial sample`);

  // Step 3: rules.
  fetched.sort((x, y) => x.patient.id.localeCompare(y.patient.id));
  const scored = fetched.map(({ patient, gp, hospital }) => scorePatient(patient, gp, hospital, now));

  const count = (pred) => scored.filter(pred).length;
  const sampleSize = scored.length;
  const scale = (n) => (sampleSize ? Math.round((n / sampleSize) * POPULATION) : null);
  const apptStatuses = {};
  for (const s of scored) for (const st of s.appointmentStatuses) apptStatuses[st] = (apptStatuses[st] ?? 0) + 1;
  const ruleCApplicable = Object.keys(apptStatuses).some((s) => MISSED_STATUSES.has(s));

  const nA = count((s) => s.ruleA.length > 0);
  const nAClear = count((s) => s.ruleAClearlyAbnormal);
  const nB = count((s) => s.ruleB.length > 0);
  const nBSettled = count((s) => s.ruleB.some((t) => t.latestOlderThan30Days));
  const nC = count((s) => s.ruleC.length > 0);
  const nScore2 = count((s) => s.score >= 2);
  const nAnyRule = count((s) => s.rules.length > 0);
  const pendingResults = scored.reduce((acc, s) => acc + s.ruleAPending, 0);

  const summary = {
    runAt: new Date().toISOString(),
    wallSeconds: Math.round((Date.now() - RUN_START) / 1000),
    simClock: { now, iso: new Date(now).toISOString(), paused: clock.paused, speed: clock.speed },
    baseUrl: BASE,
    requestedSample: SAMPLE_N,
    patientsScanned: sampleSize,
    sampleNote: `sample of ${sampleSize}, scaled to ${POPULATION}`,
    stoppedEarlyAtDeadline: stoppedEarly,
    fetchErrors,
    cacheHits,
    requests: requestCount,
    retries: retryCount,
    hospitalViewIncluded: !SKIP_HOSPITAL,
    directoryTotal: total,
    counts: {
      ruleA_abnormalUnactioned_raw: nA,
      ruleA_abnormalUnactioned_clearlyAbnormal: nAClear,
      ruleB_worseningTrend: nB,
      ruleB_worseningTrend_latestResultOver30DaysOld: nBSettled,
      ruleC_missedNotRebooked: ruleCApplicable ? nC : null,
      anyRule: nAnyRule,
      scoreAtLeast2: nScore2,
      pendingResultsExcludedFromHeadline: pendingResults,
    },
    scaledTo50000: {
      ruleA_raw: scale(nA),
      ruleA_clearlyAbnormal: scale(nAClear),
      ruleB: scale(nB),
      ruleC: ruleCApplicable ? scale(nC) : null,
      anyRule: scale(nAnyRule),
      scoreAtLeast2: scale(nScore2),
    },
    ruleC: {
      applicable: ruleCApplicable,
      appointmentStatusesSeen: apptStatuses,
      note: ruleCApplicable
        ? "Missed/cancelled appointment statuses were present."
        : "Rule C could not be applied: the simulator exposes no noshow/cancelled/dna appointment status in this sample, so missed appointments are not observable.",
    },
    definitions: {
      abnormal: "value < referenceLow or value > referenceHigh (the API does not flag abnormality).",
      clearlyAbnormal: `out of range AND (analyte in ${[...KEY_ANALYTES].join(", ")} OR value beyond the bound by more than ${CLEAR_MARGIN} x the reference width).`,
      action: "task, outgoing conversation entry (message to patient), appointment startsAt, encounter, or test order with time after the result's createdAt.",
      ruleA: "abnormal result >= 30 sim days old with no action in the 30 days after it; results < 30 days old are 'pending' and excluded.",
      ruleB: `>= 2 consecutive abnormal observations of the same analyte (rising: ${[...RISING].join(", ")}; falling: ${[...FALLING].join(", ")}), each worse than the last, first-to-last span >= 90 days, no action after the latest.`,
      ruleC: "appointment status in noshow/cancelled/dna with no later appointment carrying the same title.",
      score: "B=3, A=2, C=1, +1 if age >= 75.",
    },
    step5Narratives: "skipped: OPENAI_API_KEY returned 401 / was empty at run time",
  };

  const ranked = [...scored].sort((x, y) => y.score - x.score || x.id.localeCompare(y.id));
  const cases = ranked.slice(0, TOP_CASES).map((s) => ({
    id: s.id,
    name: s.name,
    age: s.age,
    score: s.score,
    rules: s.rules,
    triggers: [...s.ruleB, ...s.ruleA, ...s.ruleC],
    resultCount: s.resultCount,
    actionCount: s.actionCount,
    pendingAbnormalResults: s.ruleAPending,
  }));

  fs.writeFileSync(path.join(OUT_DIR, "sweep-summary.json"), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "sweep-cases.json"), JSON.stringify({ generatedAt: summary.runAt, sampleNote: summary.sampleNote, cases }, null, 2));

  // Step 4: plain summary paragraph.
  const fmt = (n) => n.toLocaleString("en-GB");
  const cSentence = ruleCApplicable
    ? `${fmt(nC)} missed an appointment and were never rebooked.`
    : `Rule C (missed appointment, never rebooked) could not be applied because the simulator does not expose missed or cancelled appointments in this sample.`;
  const para =
    `Scanned ${fmt(sampleSize)} of the neighbourhood (sample of ${fmt(sampleSize)}, scaled to ${fmt(POPULATION)}). ` +
    `${fmt(nA)} patients have an abnormal result with no follow-up action (${fmt(nAClear)} using the stricter clearly-abnormal definition); ` +
    `${fmt(nB)} have a worsening trend across three or more months; ${cSentence} ` +
    `Scaled to ${fmt(POPULATION)} that is roughly ${fmt(scale(nAClear))} people on Eleanor's path (clearly abnormal, unactioned), ` +
    `or ${fmt(scale(nA))} using the raw out-of-range rule.`;
  console.log("\n" + para + "\n");

  // Step 6: Eleanor.
  const el = scored.find((s) => s.id === ELEANOR);
  if (el) {
    console.log(`Eleanor Chen (${ELEANOR}): age ${el.age}, score ${el.score}, rules [${el.rules.join(", ") || "none"}]`);
    console.log(`  Rule A triggers: ${el.ruleA.length} (clearly abnormal: ${el.ruleAClearlyAbnormal}), pending results: ${el.ruleAPending}`);
    for (const t of el.ruleA) console.log(`    ${t.resourceId} ${t.panel} ${t.collectedAt}: ${t.analytes.map((a) => `${a.code}=${a.value}${a.unit} (${a.referenceLow}-${a.referenceHigh}, ${a.flag})`).join("; ")}`);
    console.log(`  Rule B triggers: ${el.ruleB.length}`);
    for (const t of el.ruleB) console.log(`    ${t.code} ${t.direction}: ${t.series.map((s) => `${s.resourceId}@${s.collectedAt}=${s.value}`).join(" -> ")}`);
    console.log(`  Rule C triggers: ${el.ruleC.length} (appointment statuses seen: ${[...new Set(el.appointmentStatuses)].join(", ") || "none"})`);
    console.log(`  Rank in sample: ${ranked.findIndex((s) => s.id === ELEANOR) + 1} of ${sampleSize}`);
  } else {
    console.log(`Eleanor Chen (${ELEANOR}) was not in the scanned sample.`);
  }
  console.log(`\nwrote ${path.join(OUT_DIR, "sweep-summary.json")} and ${path.join(OUT_DIR, "sweep-cases.json")} in ${summary.wallSeconds}s (${requestCount} requests, ${retryCount} retries)`);
}

main().catch((e) => {
  console.error("sweep failed:", e);
  process.exit(1);
});
