const $ = (id) => document.getElementById(id);
const LEVELS = [["everything", "Everything", "results, follow-up, appointments, updates"], ["practical", "Practical", "follow-up, appointments, updates. Never the numbers."], ["updates", "Just updates", "whether the family needs to do anything"]];
const LEVEL_TOPICS = { everything: ["results", "followup", "appointments", "updates"], practical: ["followup", "appointments", "updates"], updates: ["updates"] };
const STEPS = [["idle", "Waiting", "No test in flight"], ["ordered", "Ordered", "LFT in Anima"], ["result_detected", "Held", "Practice only"], ["disclosed", "Told", "Eleanor knows"], ["awaiting_patient", "Her call", "Share or keep"], ["released", "Released", "Circle told"]];
const ARROW = { improving: "↗", stable: "→", watch: "!", worsening: "↘" };
const TREND_WORD = { improving: "Improving", stable: "Steady", watch: "Keeping an eye", worsening: "Needs attention" };

let state = null, insights = null, busy = false; const openCards = new Set();
const seen = { eleanor: 0, sarah: 0, family: 0 };
const fmtT = (iso) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const fmtD = (iso) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const toast = (m, ms = 3000) => { const t = $("toast"); t.textContent = m; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), ms); };

async function api(path, body) {
  const res = await fetch(path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || res.statusText);
  if (json.state) { state = json.state; render(); }
  return json;
}
async function loadInsights() {
  try { const j = await fetch("/api/insights").then((r) => r.json()); insights = j.cards ? j : j.insights || j; renderCards(); } catch { /* keep last */ }
}

/* ---------- levels derived from consent (source of truth) ---------- */
function levelOf(person) {
  const c = state.consent[person] || {};
  if (c.results) return "everything";
  if (c.followup || c.appointments) return "practical";
  return "updates";
}

/* ---------- render ---------- */
function render() {
  if (!state) return;
  const now = state.simNow ? fmtT(state.simNow) : "";
  $("sim-now").textContent = now || "…"; $("e-time").textContent = now; $("s-time").textContent = now;
  renderPrompt(); renderPeople(); renderThread("e-thread", "eleanor", "e-unread", "Ask me anything about your results, or tell me who should see what.");
  renderThread("s-thread", "sarah", "s-unread", "Once Mum shares a result, it lands here in plain English.");
  renderThread("g-thread", "family", "g-unread", "The family group only hears once Mum has been told and has said yes.");
  renderCards(); renderDirector();
}

function renderPrompt() {
  const el = $("share-prompt"); const g = state.gate;
  if (!state.pending?.shareDecision) { el.hidden = true; return; }
  const who = state.people.filter((p) => p.role !== "patient" && state.consent[p.id]?.results).map((p) => p.name);
  const flagged = (g.abnormal || []).join(", ");
  el.hidden = false;
  el.innerHTML = `<b>Your liver test is back</b><p>Your practice has talked you through it.${flagged ? ` ${flagged} ${g.abnormal.length > 1 ? "are" : "is"} flagged.` : ""} Do you want your circle to know?</p>
    <div class="row"><button class="primary" data-share="share">Yes, share</button><button data-share="hold">Not yet</button></div>
    <p class="who">${who.length ? `Would go to ${who.join(" and ")} with the numbers, and to everyone else as an update.` : "Nobody has results access right now, so only updates would go out."}</p>`;
  el.querySelectorAll("[data-share]").forEach((b) => b.addEventListener("click", () => act(null, "/api/share", { decision: b.dataset.share })));
}

function renderPeople() {
  const people = state.people.filter((p) => p.role !== "patient");
  $("people").innerHTML = people.map((p) => {
    const lv = levelOf(p.id);
    return `<div class="person"><div class="head"><span class="avatar">${p.name[0]}</span><span><b>${p.name}</b><small>${p.role}</small></span></div>
      <div class="seg">${LEVELS.map(([id, label]) => `<button data-p="${p.id}" data-l="${id}" class="${lv === id ? "is-on" : ""}">${label}</button>`).join("")}</div>
      <p class="sees">${p.name} sees ${LEVELS.find((l) => l[0] === lv)[2]}</p></div>`;
  }).join("");
  $("people").querySelectorAll("[data-l]").forEach((b) => b.addEventListener("click", async () => {
    try { await api("/api/consent/level", { person: b.dataset.p, level: b.dataset.l }); }
    catch { // fallback: set topics one by one if the level route is not there yet
      const want = LEVEL_TOPICS[b.dataset.l];
      for (const t of ["results", "followup", "appointments", "updates"]) await api("/api/consent", { person: b.dataset.p, topic: t, allowed: want.includes(t) }).catch(() => {});
    }
  }));
  $("askfirst").setAttribute("aria-checked", String(state.settings?.askFirst !== false));
}

function renderThread(elId, thread, unreadId, hint) {
  const msgs = state.threads[thread] || []; const el = $(elId);
  const visible = el.closest(".page").classList.contains("is-on");
  if (visible) seen[thread] = msgs.length;
  const un = msgs.length - seen[thread]; const u = $(unreadId); u.hidden = un <= 0; u.textContent = un;
  if (!msgs.length) { el.innerHTML = `<p class="empty">${hint}</p>`; return; }
  el.innerHTML = msgs.map((m) => {
    const me = m.from !== "agent"; const kind = m.kind && m.kind !== "info" ? m.kind : "";
    return `<div class="b ${me ? "me" : ""} ${kind}">${!me && kind ? `<span class="k">${kind}${m.simulated ? " · templated" : ""}</span>` : ""}${esc(m.text)}<time>${fmtT(m.at)}</time></div>`;
  }).join("");
  if (visible) el.scrollTop = el.scrollHeight;
}

function spark(c) {
  if (!c.series?.length) return "";
  const W = 240, H = 54, pts = c.series;
  const vals = pts.map((p) => p.v).concat(c.lo != null ? [c.lo, c.hi] : []);
  const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.15 || 1;
  const y = (v) => H - 4 - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * (H - 8);
  const x = (i) => 4 + (i / Math.max(1, pts.length - 1)) * (W - 8);
  const band = c.lo != null ? `<rect x="4" y="${y(c.hi).toFixed(1)}" width="${W - 8}" height="${Math.max(1, y(c.lo) - y(c.hi)).toFixed(1)}" fill="oklch(93% 0.035 165)"/>` : "";
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const dots = pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="${i === pts.length - 1 ? 3.2 : 2.2}" fill="${c.lo != null && (p.v < c.lo || p.v > c.hi) ? "oklch(66% 0.17 55)" : "oklch(23% 0.018 60)"}"/>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${band}<path d="${d}" fill="none" stroke="oklch(23% 0.018 60)" stroke-width="1.4" stroke-opacity="0.75"/>${dots}</svg>
    <p class="ref">${c.analyteName || c.system}${c.unit ? " · " + c.unit : ""}${c.lo != null ? ` · usual range ${c.lo} to ${c.hi}` : ""} · ${pts[0].date} to ${pts[pts.length - 1].date}</p>`;
}

const forSarah = (t) => String(t).replace(/^Your\b/, "Mum's").replace(/^You are\b/, "Mum is").replace(/\byour usual\b/g, "her usual").replace(/\bYou\b/g, "Mum").replace(/\byour\b/g, "her");
function cardHtml(c, sarah = false) {
  return `<div class="card ${c.trend} ${openCards.has(c.id) ? "open" : ""}" data-id="${c.id}" data-sys="${c.system}"><div class="top"><span class="arrow">${ARROW[c.trend] || "→"}</span><span><b>${esc(sarah ? forSarah(c.headline) : c.headline)}</b><p>${TREND_WORD[c.trend] || ""} · ${esc(sarah ? forSarah(c.detail) : c.detail)}</p></span></div><div class="more">${spark(c)}</div></div>`;
}

function renderCards() {
  if (!insights) return;
  const cards = insights.cards || [];
  $("cards").innerHTML = cards.length ? cards.map((c) => cardHtml(c)).join("") : `<p class="fine">Nothing to report yet.</p>`;
  const sarahCards = cards.filter((c) => (c.audience || []).includes("sarah") || (!c.lo && state?.consent?.sarah?.updates));
  $("s-cards").innerHTML = sarahCards.length ? sarahCards.map((c) => cardHtml(c, true)).join("") : `<p class="fine">Mum hasn't shared her results with you. You'll still hear about appointments and anything you can help with.</p>`;
  document.querySelectorAll(".card").forEach((el) => el.addEventListener("click", () => { const id = el.dataset.id; openCards.has(id) ? openCards.delete(id) : openCards.add(id); el.classList.toggle("open"); focusTwin(el.dataset.sys); }));
  const up = insights.upcoming || [];
  const upHtml = up.length ? up.map((u) => `<li><time>${fmtD(u.at)}<small>${new Date(u.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}</small></time><span><b>${esc(u.title)}</b><span>${esc(u.who || "")}${u.detail ? " · " + esc(u.detail) : ""}</span></span></li>`).join("") : `<li><span></span><span class="fine">Nothing booked.</span></li>`;
  $("upcoming").innerHTML = upHtml; $("s-upcoming").innerHTML = state?.consent?.sarah?.appointments ? upHtml : `<li><span></span><span class="fine">Mum hasn't shared appointments with you.</span></li>`;
  $("body-cards").innerHTML = cards.map((c) => `<button class="${c.trend}" data-sys="${c.system}">${ARROW[c.trend]} ${esc(c.headline.length > 34 ? c.headline.slice(0, 32) + "…" : c.headline)}</button>`).join("");
  $("body-cards").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => focusTwin(b.dataset.sys)));
}
function focusTwin(sys) { const f = $("twin"); f.contentWindow && f.contentWindow.postMessage({ focus: sys }, "*"); }

function renderDirector() {
  const g = state.gate; const order = STEPS.map((s) => s[0]); const idx = g.step === "escalated" ? 2 : order.indexOf(g.step);
  $("gate").innerHTML = STEPS.map(([id, b, t], i) => {
    let cls = i < idx ? "done" : i === idx ? "now" : "";
    if (id === "result_detected") cls += " held"; if (id === "awaiting_patient") cls += " ask";
    if (g.step === "escalated" && i === 2) cls = "esc";
    return `<li class="${cls}"><b>${g.step === "escalated" && i === 2 ? "Escalated" : b}</b>${g.step === "escalated" && i === 2 ? "GP task, phone call" : t}</li>`;
  }).join("");
  const pill = $("gate-pill"); pill.textContent = (STEPS.find((s) => s[0] === g.step) || ["", g.step])[1] + (g.abnormal?.length ? ` · ${g.abnormal.length} flagged` : ""); pill.className = "pill " + g.step;
  $("b-order").disabled = g.step !== "idle"; $("b-advance").disabled = g.step !== "ordered";
  $("b-confirm").disabled = g.step !== "result_detected"; $("b-escalate").disabled = g.step !== "result_detected";
  const t = [...(state.trail || [])].reverse().slice(0, 40);
  $("trail").innerHTML = t.length ? t.map((e) => `<li><time>${fmtT(e.at)}</time><span class="src ${e.source}">${e.source}</span><span>${esc(e.type)}${e.detail ? " · " + esc(e.detail) : ""}${e.resourceId ? ` <code>${esc(e.resourceId)}</code>` : ""}</span></li>`).join("") : `<li><span class="fine">Nothing yet.</span></li>`;
}

/* ---------- actions ---------- */
async function act(btnId, path, body, msg) {
  if (busy) return; busy = true;
  const b = btnId && $(btnId); let label; if (b) { b.classList.add("busy"); label = b.innerHTML; b.innerHTML = msg || "Working…"; }
  try { await api(path, body || {}); if (path === "/api/reset" || path === "/api/share") loadInsights(); }
  catch (e) { toast("Anima said: " + e.message, 5000); }
  finally { if (b) { b.innerHTML = label; b.classList.remove("busy"); } busy = false; render(); }
}
$("b-order").addEventListener("click", () => act("b-order", "/api/order-lft", {}, "Ordering in Anima…"));
$("b-advance").addEventListener("click", () => act("b-advance", "/api/advance", { minutes: 121 }, "Advancing the world…"));
$("b-confirm").addEventListener("click", () => act("b-confirm", "/api/confirm-disclosure", {}, "Telling Eleanor…"));
$("b-escalate").addEventListener("click", () => act("b-escalate", "/api/escalate", { days: 3 }, "Three days pass…"));
$("b-reset").addEventListener("click", () => act("b-reset", "/api/reset", {}, "Resetting…"));
$("askfirst").addEventListener("click", async () => { const on = $("askfirst").getAttribute("aria-checked") !== "true"; $("askfirst").setAttribute("aria-checked", String(on)); await api("/api/settings", { askFirst: on }).catch((e) => toast(e.message)); });
$("dir-toggle").addEventListener("click", () => { const open = $("dir-body").hidden; $("dir-body").hidden = !open; $("dir-toggle").setAttribute("aria-expanded", String(open)); document.body.classList.toggle("dir-open", open); if (open) window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); });

const CONSENT_RE = /\b(sarah|john|tom|share|see|let|stop|hide|show|allow|circle|results?|appointments?)\b/i;
$("e-form").addEventListener("submit", async (e) => {
  e.preventDefault(); const q = $("e-text").value.trim(); if (!q) return; $("e-text").value = "";
  state.threads.eleanor = [...(state.threads.eleanor || []), { at: new Date().toISOString(), from: "eleanor", text: q, kind: "question" }]; render();
  try {
    if (CONSENT_RE.test(q) && /\b(sarah|john|tom)\b/i.test(q)) {
      const out = await api("/api/consent/agent", { text: q });
      state.threads.eleanor = [...state.threads.eleanor, { at: new Date().toISOString(), from: "agent", text: out.reply || "Done.", kind: "info" }]; render();
    } else await api("/api/ask", { person: "eleanor", question: q });
  } catch (err) { toast(err.message); }
});
$("s-form").addEventListener("submit", async (e) => {
  e.preventDefault(); const q = $("s-text").value.trim(); if (!q) return; $("s-text").value = "";
  state.threads.sarah = [...(state.threads.sarah || []), { at: new Date().toISOString(), from: "sarah", text: q, kind: "question" }]; render();
  try { await api("/api/ask", { person: "sarah", question: q }); } catch (err) { toast(err.message); }
});

/* ---------- tabs ---------- */
function tabs(navId) {
  const nav = $(navId), phone = nav.closest(".screen");
  nav.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    nav.querySelectorAll("button").forEach((x) => x.classList.toggle("is-on", x === b));
    phone.querySelectorAll(".page").forEach((p) => p.classList.toggle("is-on", p.dataset.page === b.dataset.page));
    render();
  }));
}
tabs("e-tabs"); tabs("s-tabs");

/* ---------- boot ---------- */
api("/api/state").catch((e) => toast("Server not reachable: " + e.message, 6000));
loadInsights();
setInterval(() => { if (!busy) api("/api/state").catch(() => {}); }, 4000);
setInterval(loadInsights, 30000);
