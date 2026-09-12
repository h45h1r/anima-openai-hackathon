import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { MeshSurfaceSampler } from "three/addons/math/MeshSurfaceSampler.js";
import { PATIENT } from "./data.js";

/* ---------- systems: where on the body, which data ---------- */
const SYSTEMS = [
  { id: "sleep", name: "Sleep", organ: "Brain", pos: [0, 1.50, 0.02], wear: "sleep",
    note: "Seven hours a night is within the usual range for her age." },
  { id: "heart", name: "Heart", organ: "Resting heart rate", pos: [0.04, 1.24, 0.08], wear: "heart-rate",
    note: "Resting rate has stayed in the high sixties through the week of decline." },
  { id: "immune", name: "Blood & immune", organ: "Bone marrow", pos: [0.0, 1.16, 0.1], panel: "fbc", pick: ["white-cell-count", "neutrophils", "haemoglobin", "platelets"],
    note: "Low neutrophils reduce the ability to fight infection. Four consecutive low panels and nobody has reviewed or messaged about them." },
  { id: "liver", name: "Liver", organ: "Liver", pos: [0.11, 1.05, 0.08], panel: "lft", pick: ["bilirubin", "albumin", "alt", "alp"],
    note: "Mildly raised bilirubin and low albumin on most panels. Albumin is also a marker of nutrition and frailty." },
  { id: "metabolic", name: "Metabolic", organ: "Pancreas", pos: [-0.04, 0.95, 0.06], panel: "hba1c", pick: ["hba1c"], extraPanel: "lipids", extraPick: ["triglycerides"],
    note: "HbA1c has been in the diabetes range on every panel for a year. There is no diabetes on the problem list and no medication recorded." },
  { id: "kidney", name: "Kidneys", organ: "Left kidney", pos: [-0.075, 0.96, -0.06], panel: "ue", pick: ["potassium", "creatinine", "egfr", "sodium"],
    note: "Potassium sat below range from January to August. Very low creatinine fits low muscle mass in a frail 83 year old." },
  { id: "inflammation", name: "Inflammation", organ: "Blood", pos: [-0.27, 1.0, 0.06], panel: "crp", pick: ["crp"],
    note: "Low-grade raised CRP on five panels, now back in range." },
  { id: "mobility", name: "Mobility", organ: "Legs", pos: [0.09, 0.44, 0.04], wear: "steps",
    note: "Daily steps fell 61% in one week, then she was admitted with reduced mobility. The watch saw it first." },
];

/* ---------- date helpers ---------- */
const DAY = 86400000;
const T0 = Date.parse("2025-09-01T00:00Z");
const NOW = Date.parse(PATIENT.simNow + "Z");
const dayToDate = (d) => new Date(T0 + d * DAY);
const dateToDay = (ms) => Math.round((ms - T0) / DAY);
const fmt = (d) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fmtT = (d) => new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const parse = (s) => Date.parse(s.length > 10 ? s + "Z" : s + "T00:00Z");

/* ---------- state derivation ---------- */
const panelById = Object.fromEntries(PATIENT.labs.map((l) => [l.id, l]));
function latestPanel(id, asOf) {
  const s = panelById[id].series.filter((x) => parse(x.date) <= asOf);
  return s.length ? s[s.length - 1] : null;
}
function latestWear(metric, asOf) {
  const w = PATIENT.wearables.filter((x) => x.metric === metric && parse(x.date) <= asOf);
  return w.length ? w[w.length - 1] : null;
}
const outOf = (a) => (a.v < a.lo ? "low" : a.v > a.hi ? "high" : null);

function systemState(sys, asOf) {
  const out = { analytes: [], wear: null, status: "none", says: [] };
  const collect = (panelId, pick) => {
    const p = latestPanel(panelId, asOf);
    if (!p) return;
    for (const id of pick) {
      const a = p.analytes.find((x) => x.id === id);
      if (a) out.analytes.push({ ...a, date: p.date, dir: outOf(a) });
    }
  };
  if (sys.panel) collect(sys.panel, sys.pick);
  if (sys.extraPanel) collect(sys.extraPanel, sys.extraPick);
  if (sys.wear) {
    out.wear = latestWear(sys.wear, asOf);
    if (out.wear && out.wear.baseline && out.wear.v < out.wear.baseline * 0.6) out.says.push(`Steps ${out.wear.v}/day, well below her baseline of ${out.wear.baseline}.`);
  }
  for (const a of out.analytes) if (a.dir) out.says.push(`${a.name} ${a.v} ${a.unit}, ${a.dir} (range ${a.lo} to ${a.hi}).`);
  if (out.analytes.length || out.wear) out.status = out.says.length ? "flag" : "ok";
  return out;
}

/* ---------- three.js figure ---------- */
const canvas = document.getElementById("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.06; controls.enablePan = false;
controls.minDistance = 1.4; controls.maxDistance = 6; controls.target.set(0, 0.8, 0);
controls.autoRotate = !matchMedia("(prefers-reduced-motion: reduce)").matches; controls.autoRotateSpeed = 0.7;
camera.position.set(0, 0.9, 4.0);

const VIEWS = { front: [0, 0.9, 4.0], side: [4.0, 0.9, 0.2], back: [0, 0.9, -4.0], top: [0.01, 4.4, 0.5] };

function capsule(r, len, x, y, z, rx = 0, rz = 0, sz = 1) {
  const g = new THREE.CapsuleGeometry(r, len, 6, 16);
  const m = new THREE.Mesh(g);
  m.position.set(x, y, z); m.rotation.set(rx, 0, rz); m.scale.set(1, 1, sz);
  m.updateMatrixWorld(); return m;
}
function lathe(profile, y0, sz) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 28));
  m.position.y = y0; m.scale.set(1, 1, sz); m.rotation.x = 0.05; m.updateMatrixWorld(); return m;
}
function buildBody() {
  const torso = lathe([[0.03, 0], [0.16, 0.02], [0.175, 0.08], [0.165, 0.2], [0.15, 0.3], [0.158, 0.4], [0.185, 0.5], [0.19, 0.55], [0.14, 0.6], [0.06, 0.62], [0.0, 0.63]], 0.78, 0.6);
  const parts = [
    ["head", new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 20)), [0, 1.5, 0.03], [0.1, 0, 0], [0.92, 1.12, 1]],
    ["neck", capsule(0.036, 0.07, 0, 1.37, 0.02)],
    ["torso", torso],
    ["shoL", new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10)), [-0.2, 1.3, 0.01]],
    ["shoR", new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10)), [0.2, 1.3, 0.01]],
    ["armL", capsule(0.042, 0.26, -0.235, 1.14, 0.0, 0.05, 0.1)],
    ["armR", capsule(0.042, 0.26, 0.235, 1.14, 0.0, 0.05, -0.1)],
    ["foreL", capsule(0.035, 0.24, -0.27, 0.9, 0.07, -0.3, 0.04)],
    ["foreR", capsule(0.035, 0.24, 0.27, 0.9, 0.07, -0.3, -0.04)],
    ["handL", new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 10)), [-0.275, 0.73, 0.12], [0, 0, 0], [0.8, 1.3, 0.5]],
    ["handR", new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 10)), [0.275, 0.73, 0.12], [0, 0, 0], [0.8, 1.3, 0.5]],
    ["thighL", capsule(0.075, 0.33, -0.095, 0.6, 0.0, 0, 0.03)],
    ["thighR", capsule(0.075, 0.33, 0.095, 0.6, 0.0, 0, -0.03)],
    ["shinL", capsule(0.05, 0.33, -0.1, 0.23, -0.01)],
    ["shinR", capsule(0.05, 0.33, 0.1, 0.23, -0.01)],
    ["footL", new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.045, 0.2)), [-0.1, 0.025, 0.06]],
    ["footR", new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.045, 0.2)), [0.1, 0.025, 0.06]],
  ];
  const pts = [], seed = [];
  const tmp = new THREE.Vector3();
  for (const p of parts) {
    const m = p[1];
    if (p[2]) m.position.set(...p[2]);
    if (p[3]) m.rotation.set(...p[3]);
    if (p[4]) m.scale.set(...p[4]);
    m.updateMatrixWorld();
    const sampler = new MeshSurfaceSampler(m).build();
    const area = p[0] === "torso" ? 6500 : p[0] === "head" ? 1800 : p[0].startsWith("hand") ? 200 : p[0].startsWith("sho") ? 220 : p[0].startsWith("thigh") ? 1100 : p[0].startsWith("shin") ? 800 : p[0].startsWith("foot") ? 250 : 500;
    for (let i = 0; i < area; i++) {
      sampler.sample(tmp); tmp.applyMatrix4(m.matrixWorld);
      pts.push(tmp.x, tmp.y, tmp.z); seed.push(Math.random());
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  g.setAttribute("seed", new THREE.Float32BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uScan: { value: 0 }, uPx: { value: renderer.getPixelRatio() } },
    vertexShader: `attribute float seed; uniform float uTime; uniform float uScan; uniform float uPx; varying float vA; varying float vS;
      void main(){ vec3 p = position; p.x += sin(uTime*0.8 + seed*6.28)*0.0025; p.z += cos(uTime*0.6 + seed*6.28)*0.0025;
        vec4 mv = modelViewMatrix * vec4(p,1.0); gl_Position = projectionMatrix * mv;
        float d = 1.0 - smoothstep(0.0, 0.05, abs(p.y - uScan)); vS = d;
        gl_PointSize = (2.2 + seed*1.6 + d*3.0) * uPx * (2.6 / -mv.z);
        vA = 0.45 + seed*0.35; }`,
    fragmentShader: `varying float vA; varying float vS;
      void main(){ vec2 c = gl_PointCoord - 0.5; float r = dot(c,c); if (r > 0.25) discard;
        vec3 ink = vec3(0.16,0.14,0.13); vec3 amber = vec3(0.86,0.55,0.18);
        vec3 col = mix(ink, amber, vS*0.9); float a = vA * (1.0 - smoothstep(0.12, 0.25, r)) + vS*0.4;
        gl_FragColor = vec4(col, a); }`,
  });
  const cloud = new THREE.Points(g, mat);
  scene.add(cloud);
  return mat;
}
const cloudMat = buildBody();

// soft floor shadow
{
  const cv = document.createElement("canvas"); cv.width = cv.height = 256;
  const ctx = cv.getContext("2d");
  const grd = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
  grd.addColorStop(0, "rgba(60,50,40,0.28)"); grd.addColorStop(1, "rgba(60,50,40,0)");
  ctx.fillStyle = grd; ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(cv);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.002; scene.add(m);
}

// organ markers
const markerGroup = new THREE.Group(); scene.add(markerGroup);
const markers = SYSTEMS.map((s) => {
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 12), new THREE.MeshBasicMaterial({ color: 0x3f8f73, transparent: true, opacity: 0.95 }));
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.036, 32), new THREE.MeshBasicMaterial({ color: 0x3f8f73, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
  core.position.set(...s.pos); ring.position.copy(core.position);
  core.userData.id = s.id; ring.userData.id = s.id;
  markerGroup.add(core, ring);
  return { id: s.id, core, ring };
});
const COL = { ok: 0x3f8f73, flag: 0xd9822b, none: 0xc9c1b6 };

/* ---------- labels (HTML, projected) ---------- */
const labelsEl = document.getElementById("labels");
const labelEls = SYSTEMS.map((s) => {
  const el = document.createElement("button");
  el.className = "lab" + (s.pos[0] < -0.02 ? " lhs" : ""); el.dataset.side = s.pos[0] < -0.02 ? "l" : "r"; el.innerHTML = `<span class="pin"></span><span class="txt">${s.name}</span>`;
  el.addEventListener("click", () => select(s.id));
  labelsEl.appendChild(el); return el;
});

/* ---------- UI state ---------- */
let asOf = NOW, selected = null, states = {};
const $ = (id) => document.getElementById(id);

function recompute() {
  states = Object.fromEntries(SYSTEMS.map((s) => [s.id, systemState(s, asOf)]));
  for (const m of markers) {
    const c = COL[states[m.id].status]; m.core.material.color.setHex(c); m.ring.material.color.setHex(c);
  }
  renderSystems(); renderDetail(); renderRecent();
  $("asof").textContent = fmt(asOf);
  const flagged = SYSTEMS.filter((s) => states[s.id].status === "flag").length;
  $("asof-sub").textContent = flagged ? `${flagged} system${flagged > 1 ? "s" : ""} out of range` : "Nothing out of range";
}

function renderSystems() {
  $("systems").innerHTML = SYSTEMS.map((s, i) => {
    const st = states[s.id];
    const label = st.status === "flag" ? st.says.length + " flag" + (st.says.length > 1 ? "s" : "") : st.status === "ok" ? "In range" : "No data";
    return `<li><button data-id="${s.id}" class="${selected === s.id ? "is-on" : ""}"><span class="num">${String(i + 1).padStart(2, "0")}</span><span>${s.name}</span><span class="st ${st.status}">${label}</span></button></li>`;
  }).join("");
  $("systems").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => select(b.dataset.id)));
}

function chart(sys, a) {
  const series = panelById[sys.panel === undefined || !panelById[sys.panel].series.some((p) => p.analytes.some((x) => x.id === a.id)) ? sys.extraPanel : sys.panel].series;
  const pts = series.map((p) => ({ t: parse(p.date), v: p.analytes.find((x) => x.id === a.id).v }));
  const W = 260, H = 64, L = 6, R = 6;
  const vals = pts.map((p) => p.v).concat([a.lo, a.hi]);
  const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.15 || 1;
  const y = (v) => H - 4 - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * (H - 8);
  const x = (t) => L + ((t - T0) / (NOW - T0)) * (W - L - R);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const dots = pts.map((p) => `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="${p.t <= asOf ? 3 : 2.2}" fill="${p.t <= asOf ? (p.v < a.lo || p.v > a.hi ? "oklch(66% 0.17 55)" : "oklch(23% 0.018 60)") : "none"}" stroke="oklch(23% 0.018 60)" stroke-opacity="${p.t <= asOf ? 1 : 0.35}"/>`).join("");
  const cur = x(Math.min(asOf, NOW));
  return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">
    <rect x="${L}" y="${y(a.hi).toFixed(1)}" width="${W - L - R}" height="${Math.max(1, y(a.lo) - y(a.hi)).toFixed(1)}" fill="oklch(93% 0.035 165)"/>
    <path d="${path}" fill="none" stroke="oklch(23% 0.018 60)" stroke-width="1.4" stroke-opacity="0.75"/>
    <line x1="${cur.toFixed(1)}" x2="${cur.toFixed(1)}" y1="2" y2="${H - 2}" stroke="oklch(66% 0.17 55)" stroke-dasharray="2 3"/>
    ${dots}</svg>`;
}

function renderDetail() {
  const el = $("detail");
  if (!selected) return;
  const sys = SYSTEMS.find((s) => s.id === selected), st = states[selected];
  let html = `<h2>${sys.name}</h2><p class="sys-sub">${sys.organ} · as of ${fmt(asOf)}</p>`;
  if (st.status === "none") { el.innerHTML = html + `<p class="empty">No readings for this system before ${fmt(asOf)}.</p>`; return; }
  html += `<div class="says ${st.status}">${st.says.length ? st.says.join(" ") : "Everything in range on the latest panel."}${st.status === "flag" ? `<small>${sys.note}</small>` : ""}<small>Computed from reference ranges in the record. Not a clinical opinion.</small></div>`;
  if (st.wear) {
    const w = st.wear;
    const hist = PATIENT.wearables.filter((x) => x.metric === sys.wear && parse(x.date) <= asOf);
    html += `<div class="wear-row"><div><span>Latest · ${fmt(parse(w.date))}</span><strong>${w.v} <small>${w.unit}</small></strong></div>` +
      (w.baseline ? `<div><span>Personal baseline</span><strong>${w.baseline}</strong></div>` : "") +
      `<div><span>Week range</span><strong>${Math.min(...hist.map((h) => h.v))}–${Math.max(...hist.map((h) => h.v))}</strong></div></div>`;
    html += `<div class="an"><svg viewBox="0 0 260 64">${hist.map((h, i) => { const n = hist.length; const x = 6 + (i / Math.max(1, n - 1)) * 248; const mx = Math.max(...hist.map((q) => q.v)) * 1.1; const y = 60 - (h.v / mx) * 54; return `<rect x="${x - 6}" y="${y}" width="12" height="${60 - y}" fill="${w.baseline && h.v < w.baseline * 0.6 ? "oklch(66% 0.17 55)" : "oklch(23% 0.018 60)"}" opacity="0.8"/>`; }).join("")}${w.baseline ? `<line x1="0" x2="260" y1="${60 - (w.baseline / (Math.max(...hist.map((q) => q.v)) * 1.1)) * 54}" y2="${60 - (w.baseline / (Math.max(...hist.map((q) => q.v)) * 1.1)) * 54}" stroke="oklch(58% 0.09 165)" stroke-dasharray="3 3"/>` : ""}</svg><p class="ref">${hist.length} days from the home activity watch</p></div>`;
  }
  for (const a of st.analytes) {
    html += `<div class="an"><div class="an-h"><span class="an-n">${a.name}</span><span class="v ${a.dir ? "flag" : ""}">${a.v}</span><span class="u">${a.unit}${a.dir ? " · " + a.dir : ""}</span></div>${chart(sys, a)}<p class="ref">Reference ${a.lo} to ${a.hi} · sampled ${fmt(parse(a.date))}</p></div>`;
  }
  el.innerHTML = html;
}

function renderRecent() {
  const ev = PATIENT.events.filter((e) => parse(e.date) <= asOf).slice(-5).reverse();
  $("recent").innerHTML = ev.length ? ev.map((e) => `<li class="${asOf - parse(e.date) < 3 * DAY ? "hot" : ""}"><i>${e.kind} · ${fmtT(parse(e.date))}</i><b>${e.title}</b>${e.detail}</li>`).join("") : `<li>No events recorded before this date.</li>`;
}

function select(id) {
  selected = id;
  labelEls.forEach((el, i) => el.classList.toggle("is-on", SYSTEMS[i].id === id));
  renderSystems(); renderDetail();
}

/* ---------- static UI ---------- */
$("meta").textContent = `${PATIENT.id} · ${PATIENT.age}, born ${fmt(parse(PATIENT.born))} · ${PATIENT.address} · ${PATIENT.gp}`;
$("sim-now").textContent = fmtT(NOW);
$("social").textContent = PATIENT.social; $("contact").textContent = PATIENT.contact; $("goal").textContent = PATIENT.goal;
$("problems").innerHTML = PATIENT.problems.map((p) => `<li class="${p.status}"><span>${p.term}</span><span>${fmt(parse(p.date))}</span></li>`).join("");
$("ehr-empty").textContent = "No allergies and no medications recorded in the GP record.";
$("ticks").innerHTML = PATIENT.labs[0].series.map((s) => `<i class="tick lab" style="left:${(dateToDay(parse(s.date)) / 376) * 100}%" title="Bloods ${s.date}"></i>`).join("") +
  PATIENT.events.map((e) => `<i class="tick ${e.kind === "admission" ? "admission" : ""}" style="left:${(dateToDay(parse(e.date)) / 376) * 100}%" title="${e.title}"></i>`).join("") +
  [...new Set(PATIENT.wearables.map((w) => w.date))].map((d) => `<i class="tick wear" style="left:${(dateToDay(parse(d)) / 376) * 100}%"></i>`).join("");

$("scrub").addEventListener("input", (e) => { asOf = Math.min(NOW, dayToDate(+e.target.value).getTime() + 12 * 3600000); recompute(); });
$("today").addEventListener("click", () => { $("scrub").value = 376; asOf = NOW; recompute(); });
document.querySelectorAll(".views [data-view]").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".views [data-view]").forEach((x) => x.classList.remove("is-on")); b.classList.add("is-on");
  flyTo(VIEWS[b.dataset.view]);
}));
$("spin").addEventListener("click", (e) => { controls.autoRotate = !controls.autoRotate; e.currentTarget.setAttribute("aria-pressed", String(controls.autoRotate)); });

let fly = null;
function flyTo(p) { fly = { from: camera.position.clone(), to: new THREE.Vector3(...p), t: 0 }; }

// click on markers
const ray = new THREE.Raycaster(); const ptr = new THREE.Vector2();
canvas.addEventListener("pointerup", (e) => {
  if (e.button !== 0) return;
  const r = canvas.getBoundingClientRect();
  ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, camera); ray.params.Points.threshold = 0.02;
  const hit = ray.intersectObjects(markerGroup.children, false)[0];
  if (hit) select(hit.object.userData.id);
});

/* ---------- loop ---------- */
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * renderer.getPixelRatio() || canvas.height !== h * renderer.getPixelRatio()) {
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
}
const clock = new THREE.Clock(); const v = new THREE.Vector3();
function frame() {
  requestAnimationFrame(frame); resize();
  const t = clock.getElapsedTime();
  cloudMat.uniforms.uTime.value = t;
  cloudMat.uniforms.uScan.value = 1.62 - ((t * 0.28) % 1.75);
  if (fly) { fly.t = Math.min(1, fly.t + 0.03); const k = 1 - Math.pow(1 - fly.t, 4); camera.position.lerpVectors(fly.from, fly.to, k); if (fly.t >= 1) fly = null; }
  controls.update();
  const w = canvas.clientWidth, h = canvas.clientHeight;
  markers.forEach((m, i) => {
    m.ring.lookAt(camera.position);
    const st = states[m.id]?.status;
    const s = st === "flag" ? 1 + Math.sin(t * 3 + i) * 0.18 : 1; m.ring.scale.setScalar(s);
    v.copy(m.core.position).project(camera);
    const el = labelEls[i];
    const lx = ((v.x + 1) / 2) * w, ly = ((-v.y + 1) / 2) * h;
    el.style.left = Math.max(70, Math.min(w - 70, lx)) + "px"; el.style.top = Math.max(14, Math.min(h - 14, ly)) + "px";
    el.className = `lab ${el.dataset.side === "l" ? "lhs" : ""} ${st || "none"} ${SYSTEMS[i].id === selected ? "is-on" : ""}`;
    // fade labels whose marker is on the far side of the body
    const toCam = camera.position.clone().sub(controls.target).normalize();
    const n = m.core.position.clone().sub(new THREE.Vector3(0, m.core.position.y, 0)).normalize();
    if (n.dot(toCam) < -0.35) el.classList.add("behind");
  });
  renderer.render(scene, camera);
}
const EMBED = new URLSearchParams(location.search);
if (EMBED.has("embed")) { document.body.classList.add("embed"); controls.autoRotateSpeed = 0.4; }
recompute(); select(EMBED.get("focus") || "immune"); frame();
addEventListener("message", (e) => { if (e.data && e.data.focus) select(e.data.focus); });
