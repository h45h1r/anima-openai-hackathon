"use client";

// A stippled, scan-line point-cloud figure built procedurally (no external
// assets). Each system has an anchor on the figure; status colours form a
// local heat layer and the camera glides to the selected area.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshSurfaceSampler } from "three/examples/jsm/math/MeshSurfaceSampler.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SYSTEMS, type SystemId } from "@/lib/body/systems";
import { BODY_HEIGHT, ORGAN_FRAME, loadManifest, manifestSystem } from "@/lib/body/assets";

export interface BodySceneProps {
  focus: SystemId | null;
  tint: Partial<Record<SystemId, string>>; // hex per system for the focused tint
  onPick?: (id: SystemId) => void;
  reducedMotion?: boolean;
  allowZoom?: boolean; // false when embedded in a scrolling page
}

interface Section {
  cx: number;
  cz: number;
  rx: number;
  rz: number;
}

const ROW = 0.0115; // vertical spacing between scan lines
const DOT = 0.0115; // spacing along each line

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function piecewise(y: number, pts: [number, number][]) {
  // pts sorted by y ascending; returns interpolated value or null outside range
  if (y < pts[0][0] || y > pts[pts.length - 1][0]) return null;
  for (let i = 0; i < pts.length - 1; i++) {
    const [y0, v0] = pts[i];
    const [y1, v1] = pts[i + 1];
    if (y >= y0 && y <= y1) return lerp(v0, v1, (y - y0) / (y1 - y0 || 1));
  }
  return pts[pts.length - 1][1];
}
function capsuleSection(y: number, a: [number, number, number, number], b: [number, number, number, number]): Section | null {
  // a,b = [x,y,z,r]; y-monotonic segment
  const [ax, ay, az, ar] = a;
  const [bx, by, bz, br] = b;
  const lo = Math.min(ay, by);
  const hi = Math.max(ay, by);
  if (y < lo || y > hi) return null;
  const t = (y - ay) / (by - ay || 1);
  const r = lerp(ar, br, t);
  return { cx: lerp(ax, bx, t), cz: lerp(az, bz, t), rx: r, rz: r };
}

function sectionsAt(y: number): Section[] {
  const out: Section[] = [];
  // head (slightly egg-shaped)
  const hy = 1.62;
  const hr = 0.115;
  if (Math.abs(y - hy) < hr) {
    const r = Math.sqrt(hr * hr - (y - hy) ** 2);
    out.push({ cx: 0, cz: 0.01, rx: r * (y > hy ? 0.98 : 0.92), rz: r * 1.02 });
  }
  // neck
  if (y >= 1.47 && y <= 1.52) out.push({ cx: 0, cz: 0, rx: 0.05, rz: 0.045 });
  // torso
  const trx = piecewise(y, [[0.88, 0.165], [0.95, 0.175], [1.05, 0.145], [1.2, 0.165], [1.36, 0.19], [1.44, 0.15], [1.47, 0.1]]);
  const trz = piecewise(y, [[0.88, 0.11], [0.95, 0.12], [1.05, 0.1], [1.2, 0.11], [1.36, 0.12], [1.44, 0.095], [1.47, 0.07]]);
  if (trx !== null && trz !== null) out.push({ cx: 0, cz: 0, rx: trx, rz: trz });
  // arms
  for (const s of [-1, 1]) {
    const up = capsuleSection(y, [s * 0.235, 1.41, 0, 0.055], [s * 0.29, 1.12, 0.02, 0.042]);
    const lo = capsuleSection(y, [s * 0.29, 1.12, 0.02, 0.042], [s * 0.315, 0.86, 0.07, 0.034]);
    const hand = capsuleSection(y, [s * 0.315, 0.86, 0.07, 0.034], [s * 0.32, 0.7, 0.1, 0.018]);
    for (const c of [up, lo, hand]) if (c) out.push(c);
  }
  // legs
  for (const s of [-1, 1]) {
    const thigh = capsuleSection(y, [s * 0.1, 0.9, 0, 0.085], [s * 0.11, 0.5, 0.005, 0.06]);
    const shin = capsuleSection(y, [s * 0.11, 0.5, 0.005, 0.06], [s * 0.11, 0.08, -0.01, 0.045]);
    for (const c of [thigh, shin]) if (c) out.push(c);
    if (y >= 0.0 && y < 0.075) out.push({ cx: s * 0.11, cz: 0.07, rx: 0.05, rz: 0.115 });
  }
  return out;
}

function buildBody(): Float32Array {
  const pts: number[] = [];
  let k = 0;
  for (let y = 0.0; y <= 1.74; y += ROW) {
    for (const s of sectionsAt(y)) {
      const perim = Math.PI * (3 * (s.rx + s.rz) - Math.sqrt((3 * s.rx + s.rz) * (s.rx + 3 * s.rz)));
      const n = Math.max(6, Math.round(perim / DOT));
      const phase = (k++ % 7) * 0.13;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + phase;
        const jitter = (Math.sin(a * 13.7 + y * 91.3) + Math.cos(a * 7.1 + y * 37.7)) * 0.0016;
        pts.push(s.cx + Math.cos(a) * (s.rx + jitter), y, s.cz + Math.sin(a) * (s.rz + jitter));
      }
    }
  }
  return new Float32Array(pts);
}

/** Merge every mesh in a glTF scene into one world-space geometry. */
function mergedGeometry(root: THREE.Object3D): THREE.BufferGeometry | null {
  root.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const g = m.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (name !== "position") g.deleteAttribute(name);
    g.morphAttributes = {};
    g.applyMatrix4(m.matrixWorld);
    parts.push(g.index ? g.toNonIndexed() : g);
  });
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
}

/** Normalise a geometry: Y-up, centred on x/z, feet at y=0, given height. */
function normaliseBody(geo: THREE.BufferGeometry, height: number, rotationDeg?: [number, number, number]) {
  if (rotationDeg) geo.rotateX(THREE.MathUtils.degToRad(rotationDeg[0])).rotateY(THREE.MathUtils.degToRad(rotationDeg[1])).rotateZ(THREE.MathUtils.degToRad(rotationDeg[2]));
  geo.computeBoundingBox();
  let bb = geo.boundingBox!;
  const size = new THREE.Vector3();
  bb.getSize(size);
  // If the model is Z-up (depth much taller than height), stand it up.
  if (size.z > size.y * 1.5) {
    geo.rotateX(-Math.PI / 2);
    geo.computeBoundingBox();
    bb = geo.boundingBox!;
    bb.getSize(size);
  }
  const s = height / (size.y || 1);
  geo.scale(s, s, s);
  geo.computeBoundingBox();
  bb = geo.boundingBox!;
  const c = new THREE.Vector3();
  bb.getCenter(c);
  geo.translate(-c.x, -bb.min.y, -c.z);
  return geo;
}

/** Stippled scan-line sampling of a mesh surface (keeps the hologram look). */
function sampleScanlines(geo: THREE.BufferGeometry, target = 30000): Float32Array {
  const mesh = new THREE.Mesh(geo);
  const sampler = new MeshSurfaceSampler(mesh).build();
  const out: number[] = [];
  const p = new THREE.Vector3();
  const band = ROW * 0.38;
  let tries = 0;
  while (out.length / 3 < target && tries < target * 12) {
    sampler.sample(p);
    tries++;
    const frac = ((p.y % ROW) + ROW) % ROW;
    if (frac > band) continue;
    out.push(p.x, Math.round(p.y / ROW) * ROW, p.z);
  }
  return new Float32Array(out);
}

function dotTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.55, "rgba(255,255,255,0.9)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const BASE = new THREE.Color("#6fa6cf");
const BASE_DIM = new THREE.Color("#a9c8dd");
const ORGAN_NEUTRAL = new THREE.Color("#8fb6d3");

export default function BodyScene({ focus, tint, onPick, reducedMotion = false, allowZoom = true }: BodySceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ setFocus: (id: SystemId | null, tintHex?: string) => void; setTints: (t: Partial<Record<SystemId, string>>) => void } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = "none";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    camera.position.set(0.2, 1.05, 3.4);

    let positions = buildBody();
    let count = positions.length / 3;
    let colors = new Float32Array(count * 3);
    let geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({ size: 0.0135, map: dotTexture(), vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true, alphaTest: 0.05 });
    const points = new THREE.Points(geo, mat);
    scene.add(points);

    // Lights only matter for organ meshes; points are unlit.
    scene.add(new THREE.HemisphereLight(0xffffff, 0xcfdbe3, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(1.5, 3, 2.5);
    scene.add(key);


    const swapPoints = (next: Float32Array) => {
      positions = next;
      count = next.length / 3;
      colors = new Float32Array(count * 3);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      points.geometry.dispose();
      points.geometry = g;
      geo = g;
    };

    const loader = new GLTFLoader();
    void loadManifest().then(async (manifest) => {
      if (disposed || manifest.length === 0) return;
      const body = manifest.find((m) => m.kind === "body");
      if (body) {
        try {
          const gltf = await loader.loadAsync(`/models/${body.file}`);
          const merged = mergedGeometry(gltf.scene);
          if (merged && !disposed) {
            normaliseBody(merged, body.height ?? BODY_HEIGHT, body.rotation);
            swapPoints(sampleScanlines(merged));
            merged.dispose();
            paint(currentFocus, currentTint);
          }
        } catch (e) {
          console.warn("body model failed, keeping procedural figure", e);
        }
      }
      const frameScale = (BODY_HEIGHT / ORGAN_FRAME.height);
      for (const entry of manifest.filter((m) => m.kind === "organ" && m.system)) {
        const sysId = manifestSystem(entry) as SystemId | undefined;
        const def = SYSTEMS.find((d) => d.id === sysId);
        if (!def) continue;
        try {
          const gltf = await loader.loadAsync(`/models/${entry.file}`);
          const g = mergedGeometry(gltf.scene);
          if (!g || disposed) continue;
          g.computeVertexNormals();
          if (entry.rotation) g.rotateX(THREE.MathUtils.degToRad(entry.rotation[0])).rotateY(THREE.MathUtils.degToRad(entry.rotation[1])).rotateZ(THREE.MathUtils.degToRad(entry.rotation[2]));
          const off = entry.offset ?? [0, 0, 0];
          const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: ORGAN_NEUTRAL, emissive: ORGAN_NEUTRAL, emissiveIntensity: 0.15, transparent: true, opacity: 0.22, roughness: 0.55, metalness: 0, depthWrite: false }));
          if (entry.bboxMin && entry.bboxMax) {
            // Anatomical frame → normalised figure: feet to 0, one scale for every organ.
            const sc = frameScale * (entry.scale ?? 1);
            g.translate(0, -ORGAN_FRAME.feetY, 0);
            g.scale(sc, sc, sc);
            m.position.set(off[0], off[1], off[2]);
            g.computeBoundingBox();
            const c = new THREE.Vector3();
            g.boundingBox!.getCenter(c);
            c.add(m.position);
            // Several organs can share a system (kidneys + bladder); keep the first as the focus anchor.
            if (!anchorOverride.has(def.id)) anchorOverride.set(def.id, c);
          } else {
            g.computeBoundingBox();
            const size = new THREE.Vector3();
            g.boundingBox!.getSize(size);
            const targetSize = def.radius * 1.5 * (entry.scale ?? 1);
            const sc = targetSize / (Math.max(size.x, size.y, size.z) || 1);
            g.scale(sc, sc, sc);
            g.computeBoundingBox();
            const c = new THREE.Vector3();
            g.boundingBox!.getCenter(c);
            g.translate(-c.x, -c.y, -c.z);
            m.position.set(def.anchor[0] + off[0], def.anchor[1] + off[1], def.anchor[2] + off[2]);
          }
          m.userData.system = def.id;
          organs.add(m);
          organsBySystem.set(def.id, [...(organsBySystem.get(def.id) ?? []), m]);
        } catch (e) {
          console.warn(`organ model ${entry.file} failed`, e);
        }
      }
      if (!disposed) paint(currentFocus, currentTint);
    });

    const organs = new THREE.Group();
    scene.add(organs);
    const organsBySystem = new Map<SystemId, THREE.Mesh[]>();
    const anchorOverride = new Map<SystemId, THREE.Vector3>();
    const anchorOf = (id: SystemId): [number, number, number] => {
      const o = anchorOverride.get(id);
      if (o) return [o.x, o.y, o.z];
      return SYSTEMS.find((s) => s.id === id)!.anchor;
    };
    let disposed = false;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableZoom = allowZoom;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.4;
    controls.maxDistance = 5;
    controls.minPolarAngle = Math.PI * 0.2;
    controls.maxPolarAngle = Math.PI * 0.8;
    controls.target.set(0, 0.95, 0);
    controls.autoRotate = !reducedMotion;
    controls.autoRotateSpeed = 0.5;

    const targetLook = new THREE.Vector3(0, 0.95, 0);
    let targetDist = 3.4;
    let currentFocus: SystemId | null = null;
    let currentTint: string | undefined;

    let tintMap: Partial<Record<SystemId, string>> = {};
    const heatWeight = (hex: string | undefined) => {
      if (hex === "#c2572f") return 1;
      if (hex === "#c98a1e") return 0.74;
      if (hex === "#2f6b4f") return 0.45;
      return 0;
    };

    const paint = (id: SystemId | null, tintHex?: string) => {
      currentTint = tintHex;
      for (const [sys, meshes] of organsBySystem) {
        for (const mesh of meshes) {
          const mm = mesh.material as THREE.MeshStandardMaterial;
          const on = sys === id;
          // Organs stay deliberately neutral until the person selects one.
          const col = new THREE.Color(on ? (tintHex ?? "#6d2e5b") : ORGAN_NEUTRAL);
          mm.color.copy(col);
          mm.emissive.copy(col);
          mm.emissiveIntensity = on ? 0.55 : 0.12;
          mm.opacity = on ? 0.92 : id ? 0.08 : 0.22;
          mm.needsUpdate = true;
        }
      }
      const c = new THREE.Color();
      const t = new THREE.Color(tintHex ?? "#6d2e5b");
      const def = id ? SYSTEMS.find((s) => s.id === id) : undefined;
      for (let i = 0; i < count; i++) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];
        // A local colour wash communicates severity without colouring organs.
        c.copy(BASE).lerp(BASE_DIM, 0.35 + 0.3 * Math.sin(y * 9));
        let strongest = 0;
        let heat = t;
        for (const system of SYSTEMS) {
          const severity = heatWeight(tintMap[system.id]);
          if (!severity) continue;
          const [ax, ay, az] = anchorOf(system.id);
          const d = Math.hypot(x - ax, y - ay, z - az);
          const spread = system.radius * 1.65;
          const strength = Math.pow(Math.max(0, 1 - d / spread), 0.7) * severity;
          if (strength > strongest) {
            strongest = strength;
            heat = new THREE.Color(tintMap[system.id] ?? "#6d2e5b");
          }
        }
        if (def) {
          const [ax, ay, az] = anchorOf(def.id);
          const d = Math.hypot(x - ax, y - ay, z - az);
          const selectedStrength = Math.pow(Math.max(0, 1 - d / def.radius), 0.6);
          if (selectedStrength > strongest) {
            strongest = selectedStrength;
            heat = t;
          }
        }
        c.lerp(heat, Math.min(0.82, strongest * 0.88));
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }
      geo.attributes.color.needsUpdate = true;
      if (def) {
        const [ax, ay] = anchorOf(def.id);
        targetLook.set(ax * 0.5, ay, 0);
        targetDist = organsBySystem.has(def.id) ? 1.7 : 2.1;
      } else {
        targetLook.set(0, 0.95, 0);
        targetDist = 3.4;
      }
      currentFocus = id;
      controls.autoRotate = !reducedMotion && !id;
    };
    api.current = { setFocus: paint, setTints: (t) => { tintMap = t; paint(currentFocus, currentTint); } };
    paint(null);

    // Picking: nearest projected anchor within 44px, only for a click (no drag)
    let downAt: [number, number] | null = null;
    const onDown = (e: PointerEvent) => {
      downAt = [e.clientX, e.clientY];
    };
    const onUp = (e: PointerEvent) => {
      if (!downAt || !onPick) return;
      const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
      downAt = null;
      if (moved > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      {
        const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
        const ray = new THREE.Raycaster();
        ray.setFromCamera(ndc, camera);
        const hit = ray.intersectObjects([...organs.children], false)[0];
        if (hit && hit.object.userData.system) {
          onPick(hit.object.userData.system as SystemId);
          return;
        }
      }
      let best: { id: SystemId; d: number } | null = null;
      const v = new THREE.Vector3();
      for (const s of SYSTEMS) {
        const [ax, ay, az] = anchorOf(s.id);
        v.set(ax, ay, az).project(camera);
        const px = ((v.x + 1) / 2) * rect.width + rect.left;
        const py = ((1 - v.y) / 2) * rect.height + rect.top;
        const d = Math.hypot(px - e.clientX, py - e.clientY);
        if (d < 44 && (!best || d < best.d)) best = { id: s.id, d };
      }
      if (best) onPick(best.id);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, true);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      renderer.domElement.style.display = "block";
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    let raf = 0;
    let lastFrame = performance.now();
    const dir = new THREE.Vector3();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min((now - lastFrame) / 1000, 0.05);
      lastFrame = now;
      // glide the orbit target and distance toward the focus
      controls.target.lerp(targetLook, 1 - Math.pow(0.001, dt));
      dir.copy(camera.position).sub(controls.target);
      const dist = dir.length();
      const nd = lerp(dist, targetDist, 1 - Math.pow(0.001, dt));
      camera.position.copy(controls.target).add(dir.normalize().multiplyScalar(nd));
      controls.update();
      renderer.render(scene, camera);
    };
    tick(lastFrame);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      for (const meshes of organsBySystem.values()) {
        for (const m of meshes) {
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
      }
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      controls.dispose();
      geo.dispose();
      mat.map?.dispose();
      mat.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      api.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion, allowZoom]);

  useEffect(() => {
    api.current?.setTints(tint);
    api.current?.setFocus(focus, focus ? tint[focus] : undefined);
  }, [focus, tint]);

  return <div ref={host} className="absolute inset-0" aria-hidden />;
}
