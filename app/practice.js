const $ = (id) => document.getElementById(id);
const TOPICS = [["results", "Results"], ["followup", "Follow-up"], ["appointments", "Appointments"], ["updates", "Updates"]];
const STEPS = [
  ["idle", "Waiting", "No test in flight"],
  ["ordered", "Ordered", "LFT requested in Anima"],
  ["result_detected", "Held", "Result in. Eleanor not yet told"],
  ["disclosed", "Told", "Clinician confirmed"],
  ["released", "Released", "Family versions sent"],
];
const ORDER = STEPS.map((s) => s[0]);
let state = null, tab = "sarah", busy = false;
const seen = {};

const fmtT = (iso) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const toast = (msg, ms = 2600) => { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), ms); };

async function api(path, body) {
  const res = await fetch(path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || res.statusText);
  if (json.state) { state = json.state; render(); }
  return json;
}

/* ---------- render ---------- */
function render() {
  if (!state) return;
  $("sim-now").textContent = state.simNow ? fmtT(state.simNow) : "…";
  renderConsent(); renderTabs(); renderThread(); renderGate(); renderResult(); renderTrail();
}

function renderConsent() {
  const people = state.people.filter((p) => p.role !== "patient");
  $("consent").innerHTML = `<tr><th>Who</th>${TOPICS.map((t) => `<th>${t[1]}</th>`).join("")}</tr>` +
    people.map((p) => `<tr><td class="p">${p.name}<small>${p.role}</small></td>${TOPICS.map(([k]) => {
      const on = !!state.consent[p.id]?.[k];
      return `<td class="t"><button class="sw" role="switch" aria-checked="${on}" aria-label="${p.name} ${k}" data-p="${p.id}" data-t="${k}"></button></td>`;
    }).join("")}</tr>`).join("");
  $("consent").querySelectorAll(".sw").forEach((b) => b.addEventListener("click", async () => {
    b.setAttribute("aria-checked", String(b.getAttribute("aria-checked") !== "true"));
    await api("/api/consent", { person: b.dataset.p, topic: b.dataset.t, allowed: b.getAttribute("aria-checked") === "true" }).catch((e) => toast(e.message));
  }));
}

function renderTabs() {
  const order = ["sarah", "john", "tom", "family", "eleanor"];
  const names = { family: "Family group", eleanor: "Eleanor" };
  $("tabs").innerHTML = order.map((id) => {
    const p = state.people.find((x) => x.id === id);
    const n = (state.threads[id] || []).length, unread = n - (seen[id] ?? 0);
    return `<button data-tab="${id}" class="${tab === id ? "is-on" : ""}">${names[id] || p.name}${unread > 0 && tab !== id ? `<span class="n">${unread}</span>` : ""}</button>`;
  }).join("");
  $("tabs").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { tab = b.dataset.tab; render(); }));
  const p = state.people.find((x) => x.id === tab);
  $("ask-text").placeholder = tab === "family" ? "Family group is read-only in the demo" : `Ask as ${p ? p.name : tab}…`;
  $("ask-text").disabled = tab === "family";
}

function renderThread() {
  const msgs = state.threads[tab] || [];
  seen[tab] = msgs.length;
  const el = $("thread");
  if (!msgs.length) {
    const hint = { sarah: "Nothing yet. Once Eleanor's result is released, Sarah's version lands here.", john: "John gets logistics and warning signs, never the numbers.", tom: "Tom only hears whether the family needs to do anything.", family: "The group only hears once Eleanor has been told.", eleanor: "Eleanor's own thread. She is on a landline, so this is what the practice reads to her." };
    el.innerHTML = `<p class="empty">${hint[tab] || ""}</p>`; return;
  }
  el.innerHTML = msgs.map((m) => {
    const me = m.from !== "agent";
    const kind = m.kind && m.kind !== "info" ? m.kind : "";
    return `<div class="b ${me ? "me" : ""} ${kind}">${!me && kind ? `<span class="k">${kind}${m.simulated ? " · templated" : ""}</span>` : ""}${escape(m.text)}<time>${fmtT(m.at)}</time></div>`;
  }).join("");
  el.scrollTop = el.scrollHeight;
}

function renderGate() {
  const g = state.gate; const idx = g.step === "escalated" ? 2 : ORDER.indexOf(g.step);
  $("gate").innerHTML = STEPS.map(([id, b, t], i) => {
    let cls = i < idx ? "done" : i === idx ? "now" : "";
    if (id === "result_detected") cls += " held";
    if (g.step === "escalated" && i === 2) cls = "esc";
    return `<li class="${cls}"><b>${g.step === "escalated" && i === 2 ? "Escalated" : b}</b>${g.step === "escalated" && i === 2 ? "GP task raised, Eleanor phoned" : t}</li>`;
  }).join("");
  const s = g.step;
  $("b-order").disabled = s !== "idle";
  $("b-advance").disabled = s !== "ordered";
  $("b-confirm").disabled = s !== "result_detected";
  $("b-escalate").disabled = s !== "result_detected";
}

function renderResult() {
  const g = state.gate, el = $("result");
  if (!g.analytes) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<h4>LFT result in the record${g.resultAt ? " · " + fmtT(g.resultAt) : ""}</h4><table>${g.analytes.map((a) => {
    const f = a.v < a.lo ? "low" : a.v > a.hi ? "high" : "";
    return `<tr><td>${a.name}</td><td class="v ${f ? "flag" : ""}">${a.v}</td><td class="r">${a.unit} · ${a.lo}–${a.hi}${f ? " · " + f : ""}</td></tr>`;
  }).join("")}</table><p class="fine">${g.step === "result_detected" ? "Visible to the practice only. Nothing has gone to the family." : g.step === "released" ? "Released under Eleanor's consent. Each person got their own version." : g.step === "escalated" ? "Undisclosed for 3 days. Safety net fired." : ""}</p>`;
}

function renderTrail() {
  const t = [...(state.trail || [])].reverse();
  $("trail").innerHTML = t.length ? t.map((e) => `<li><time>${fmtT(e.at)}</time><span class="src ${e.source}">${e.source}</span><span>${escape(e.type)}${e.detail ? " · " + escape(e.detail) : ""}${e.resourceId ? ` <code>${escape(e.resourceId)}</code>` : ""}</span></li>`).join("") : `<li><span class="fine">Nothing yet. Order the LFT to start.</span></li>`;
}

const escape = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- actions ---------- */
async function act(btnId, path, body, msg) {
  if (busy) return; busy = true;
  const b = $(btnId); b.classList.add("busy"); const label = b.innerHTML; b.innerHTML = msg || "Working…";
  try { await api(path, body || {}); }
  catch (e) { toast("Anima said: " + e.message, 5000); }
  finally { b.innerHTML = label; b.classList.remove("busy"); busy = false; render(); }
}
$("b-order").addEventListener("click", () => act("b-order", "/api/order-lft", {}, "Ordering in Anima…"));
$("b-advance").addEventListener("click", () => act("b-advance", "/api/advance", { minutes: 121 }, "Advancing the world…"));
$("b-confirm").addEventListener("click", () => act("b-confirm", "/api/confirm-disclosure", {}, "Releasing under consent…"));
$("b-escalate").addEventListener("click", () => act("b-escalate", "/api/escalate", { days: 3 }, "Three days pass…"));
$("b-reset").addEventListener("click", () => act("b-reset", "/api/reset", {}, "Resetting…"));

$("ask-form").addEventListener("submit", async (e) => {
  e.preventDefault(); const q = $("ask-text").value.trim(); if (!q || tab === "family") return;
  $("ask-text").value = "";
  state.threads[tab] = [...(state.threads[tab] || []), { at: new Date().toISOString(), from: tab, text: q, kind: "question" }]; renderThread();
  try { await api("/api/ask", { person: tab, question: q }); } catch (err) { toast(err.message); }
});

$("agent-form").addEventListener("submit", async (e) => {
  e.preventDefault(); const text = $("agent-text").value.trim(); if (!text) return;
  const r = $("agent-reply"); r.hidden = false; r.textContent = "Listening…";
  try {
    const out = await api("/api/consent/agent", { text });
    r.textContent = out.reply || "Done.";
    (out.applied || []).forEach((a) => { const sw = document.querySelector(`.sw[data-p="${a.person}"][data-t="${a.topic}"]`); sw && sw.classList.add("flash"); });
    $("agent-text").value = "";
  } catch (err) { r.textContent = err.message; }
});
document.querySelectorAll(".quick [data-say]").forEach((b) => b.addEventListener("click", () => { $("agent-text").value = b.dataset.say; $("agent-form").requestSubmit(); }));

/* ---------- boot + poll ---------- */
api("/api/state").catch((e) => toast("Server not reachable: " + e.message, 6000));
setInterval(() => { if (!busy) api("/api/state").catch(() => {}); }, 4000);
