// CareCircle server: plain Node http, port 4180. Serves app/ at / and twin/ at /twin/, plus /api/*.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as anima from "./lib/anima.mjs";
import * as gate from "./lib/gate.mjs";
import * as llm from "./lib/llm.mjs";
import { buildInsights } from "./lib/insights.mjs";
import { httpError, sendJson, readBody, serveStatic, sendCors } from "./lib/http.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4180;
const INSIGHTS_TTL_MS = 60_000;

function loadEnv(file = path.join(ROOT, ".env")) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
loadEnv();

// ---------- state ----------
let lastSimNow = null;
let state = gate.initialState(null);
let insightsCache = null; // { fetchedAt, gp, wearables, asOf, error? }
const nowIso = () => new Date().toISOString();

function noteClock(res) {
  const iso = anima.simMsToIso(res?.now);
  if (iso) lastSimNow = iso;
  return iso;
}

function trail(type, detail, extra = {}) {
  state = gate.addTrail(state, { at: nowIso(), source: "carecircle", type, detail, ...extra });
}

function animaTrail(type, detail, resourceId, at = nowIso()) {
  state = gate.addTrail(state, { at, source: "anima", type, detail, resourceId });
}

// ---------- release to the circle (used by confirm-disclosure and share) ----------
async function releaseToCircle(at) {
  for (const item of gate.releasePlan(state)) {
    const msg = await buildReleaseMessage(item);
    state = gate.addMessage(state, item.thread, msg);
  }
  const task = await anima.createTask(
    state.patient.id,
    gate.TEXT.taskTitle,
    `CareCircle: patient told of LFT result on ${at}. Family messages released per consent. Please arrange follow-up.`,
  );
  animaTrail("create_task", gate.TEXT.taskTitle, task.id, nowIso());
  state = gate.markReleased(state, nowIso());
  return task;
}

async function buildReleaseMessage(item) {
  const at = nowIso();
  if (item.kind !== "explain") return { at, from: "agent", text: item.text, kind: item.kind };
  const ctx = gate.visibleContextFor(item.thread, state);
  let { text, simulated } = await llm.explainResult(ctx);
  if (!ctx.consent.results && gate.containsAnalyteValues(text, state.gate.analytes || [])) {
    ({ text, simulated } = llm.explainTemplate({ ...ctx, analytes: null, abnormal: null }));
  }
  return { at, from: "agent", text, kind: "explain", ...(simulated ? { simulated } : {}) };
}

// Views are cached for 60s; on Anima failure the last good views are reused. Audience is recomputed per call.
async function loadInsightViews() {
  const fresh = insightsCache && Date.now() - insightsCache.fetchedAt < INSIGHTS_TTL_MS;
  if (fresh) return { ...insightsCache, source: "cache" };
  try {
    const [gp, community] = await Promise.all([anima.patientView(state.patient.id), anima.communityView(state.patient.id)]);
    const asOf = noteClock(gp) || noteClock(community) || lastSimNow || nowIso();
    state = gate.withSimNow(state, asOf);
    insightsCache = { fetchedAt: Date.now(), gp: gp.resources || [], wearables: community.resources || [], asOf };
    return { ...insightsCache, source: "live" };
  } catch (e) {
    if (!insightsCache) throw httpError(502, `Anima view unavailable: ${e.message}`);
    console.log(`insights: using cached views (${e.message})`);
    return { ...insightsCache, source: "stale", error: e.message };
  }
}

// ---------- route handlers ----------
const routes = {
  "GET /api/state": async () => ({}),

  "POST /api/reset": async () => {
    state = gate.initialState(lastSimNow);
    trail("reset", "Fresh CareCircle state");
    return {};
  },

  "POST /api/consent": async ({ person, topic, allowed }) => {
    state = gate.setConsent(state, person, topic, allowed);
    trail("consent", `${person}.${topic} = ${Boolean(allowed)}`);
    return { applied: [{ person, topic, allowed: Boolean(allowed) }] };
  },

  "POST /api/consent/level": async ({ person, level }) => {
    if (!person || !level) throw httpError(400, "person and level required");
    state = gate.setLevel(state, person, level);
    trail("consent", `${person} level = ${level}`);
    return { applied: { person, level, consent: state.consent[person] } };
  },

  "POST /api/consent/agent": async ({ text }) => {
    if (!text) throw httpError(400, "text required");
    const { applied, reply, simulated } = await llm.consentAgent(text, state.consent);
    for (const a of applied) {
      state = gate.setConsent(state, a.person, a.topic, a.allowed);
      trail("consent", `${a.person}.${a.topic} = ${a.allowed} (via agent)`);
    }
    return { applied, reply, simulated };
  },

  "POST /api/settings": async (body) => {
    if (typeof body.askFirst !== "boolean") throw httpError(400, "askFirst boolean required");
    state = gate.setSettings(state, body);
    trail("settings", `askFirst = ${state.settings.askFirst}`);
    return { settings: state.settings };
  },

  "POST /api/order-lft": async () => {
    const r = await anima.orderLft(state.patient.id);
    const at = nowIso();
    state = gate.markOrdered(state, r.id, at);
    animaTrail("order_test", `LFT ordered for ${state.patient.id}`, r.id, at);
    trail("gate", "idle -> ordered");
    return { resourceId: r.id };
  },

  "POST /api/advance": async ({ minutes }) => {
    const clock = await anima.advance(minutes);
    const simNow = noteClock(clock);
    state = gate.withSimNow(state, simNow);
    animaTrail("clock.changed", `Clock advanced ${minutes} min to ${simNow}`, undefined, nowIso());
    let detected = false;
    if (state.gate.step === "ordered") {
      const view = await anima.patientView(state.patient.id);
      noteClock(view);
      const result = gate.findResult(view.resources, state.gate.testResourceId);
      if (result) {
        const at = nowIso();
        const previous = gate.previousPanel(view.resources, "lft", result.id);
        state = gate.markResultDetected(state, result, at, previous);
        animaTrail("result.available", `LFT result available (${state.gate.abnormal.length} outside range or changed >25% vs last LFT)`, result.id, at);
        trail("gate", "ordered -> result_detected; family release HELD, patient notified");
        detected = true;
      }
    }
    return { detected, simNow };
  },

  "POST /api/confirm-disclosure": async () => {
    if (!["result_detected", "escalated"].includes(state.gate.step)) throw httpError(409, "No undisclosed result to confirm");
    const at = nowIso();
    state = gate.markDisclosed(state, at);
    trail("gate", "result_detected -> disclosed (clinician confirmed, simulated)");
    if (gate.shouldAskPatient(state)) {
      state = gate.markAwaitingPatient(state, nowIso());
      trail("gate", "disclosed -> awaiting_patient (askFirst on, result flagged); release HELD until Eleanor decides");
      return { awaitingPatient: true };
    }
    const task = await releaseToCircle(at);
    trail("gate", "disclosed -> released");
    return { taskId: task.id };
  },

  "POST /api/share": async ({ decision }) => {
    if (!gate.canShare(state)) throw httpError(409, "No share decision pending");
    if (!["share", "hold"].includes(decision)) throw httpError(400, "decision must be share or hold");
    const at = nowIso();
    if (decision === "hold") {
      state = gate.markHeld(state, at);
      trail("gate", "awaiting_patient: Eleanor kept the result private");
      return { decision };
    }
    state = gate.markShared(state, at);
    const task = await releaseToCircle(state.gate.disclosedAt || at);
    trail("gate", "awaiting_patient -> released (Eleanor chose to share)");
    return { decision, taskId: task.id };
  },

  "POST /api/ask": async ({ person, question }) => {
    if (!person || !question) throw httpError(400, "person and question required");
    const ctx = gate.visibleContextFor(person, state);
    let { text, simulated } = await llm.answerQuestion(ctx, question);
    if (!ctx.consent.results && gate.containsAnalyteValues(text, state.gate.analytes || [])) {
      ({ text, simulated } = llm.askTemplate(ctx, "results"));
      trail("guard", `Blocked analyte leak in answer to ${person}`);
    }
    const at = nowIso();
    state = gate.addMessage(state, person, { at, from: person, text: question, kind: "question" });
    state = gate.addMessage(state, person, { at, from: "agent", text, kind: "answer", ...(simulated ? { simulated } : {}) });
    return { answer: text, simulated };
  },

  "POST /api/escalate": async ({ days }) => {
    if (!gate.canEscalate(state)) return { applied: false, reason: "Escalation requires an undisclosed abnormal result" };
    const n = Number(days) || 0;
    const title = gate.TEXT.escalationTaskTitle(n);
    const task = await anima.createTask(state.patient.id, title, "CareCircle: no evidence the patient has been told. Please phone the patient today.");
    const at = nowIso();
    animaTrail("create_task", title, task.id, at);
    state = gate.markEscalated(state, at);
    trail("gate", "result_detected -> escalated");
    return { applied: true, taskId: task.id };
  },

  "GET /api/insights": async () => {
    const views = await loadInsightViews();
    const insights = buildInsights({ gp: views.gp, wearables: views.wearables }, views.asOf, state.consent);
    return { ...insights, source: views.source, ...(views.error ? { warning: views.error } : {}) };
  },

  "GET /api/trail": async () => {
    let events = [];
    try {
      const clock = await anima.clockEvents();
      noteClock(clock);
      events = (clock.events || []).map((e) => ({
        at: anima.simMsToIso(e.time),
        source: "anima",
        type: e.type,
        actor: e.actor,
        detail: e.detail,
        resourceId: e.resourceId,
        patientId: e.patientId,
      }));
    } catch (e) {
      events = [{ at: nowIso(), source: "carecircle", type: "error", detail: `Anima clock unavailable: ${e.message}` }];
    }
    const merged = [...events, ...state.trail].sort((a, b) => (a.at || "").localeCompare(b.at || ""));
    return { trail: merged };
  },
};

// ---------- http ----------
async function handleApi(req, res, pathname) {
  const key = `${req.method} ${pathname}`;
  const handler = routes[key];
  if (!handler) return sendJson(res, 404, { error: `No route ${key}`, state: gate.withLevels(state) });
  try {
    const body = req.method === "POST" ? await readBody(req) : {};
    const result = await handler(body);
    sendJson(res, 200, { ok: true, ...result, state: gate.withLevels(state) });
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 502;
    console.log(`api ${key} failed: ${e.message}`);
    sendJson(res, status, { ok: false, error: e.message, state: gate.withLevels(state) });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = decodeURIComponent(url.pathname);
  if (req.method === "OPTIONS") return sendCors(res);
  if (p.startsWith("/api/")) return handleApi(req, res, p);
  if (p === "/twin") {
    res.writeHead(302, { Location: "/twin/" });
    return res.end();
  }
  if (p.startsWith("/twin/")) return serveStatic(res, ROOT, "twin", p.slice("/twin/".length) || "index.html");
  if (p === "/pitch") { res.writeHead(302, { Location: "/pitch/" }); return res.end(); }
  if (p.startsWith("/pitch/")) return serveStatic(res, ROOT, "pitch", p.slice("/pitch/".length) || "index.html");
  return serveStatic(res, ROOT, "app", p === "/" ? "index.html" : p.slice(1));
});

async function seedClock() {
  try {
    const clock = await anima.clockEvents();
    state = gate.withSimNow(state, noteClock(clock));
  } catch (e) {
    console.log(`anima clock seed failed: ${e.message}`);
  }
}

server.listen(PORT, async () => {
  console.log(`CareCircle listening on http://localhost:${PORT} (openai: ${process.env.OPENAI_API_KEY ? "live" : "templates"})`);
  await seedClock();
});
