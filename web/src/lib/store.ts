// Local mode keeps process state; database mode restores and commits an isolated
// patient snapshot for each request. Clinical data and consent come from the sim.

import { loadStateFromSim } from "./sim/mapper";
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { withRuntimeSnapshot, runtimeSnapshot, restoreRuntimeSnapshot } from './runtime-store';
import { simConfigured, sim } from './sim/client';
import { applyConsentSnapshot, consentRequest, getConsentSnapshot, toStoredCategory, type ConsentMember } from "./consent-store";
import { DEMO_PATIENTS, DEFAULT_PATIENT_SIM_ID, circleFor } from "./data/circle";
import type { AgentMode, AppState, AuditEntry, AuditKind, Category, ConsentCheck, Message } from "./types";
import { canAccess, personById, CATEGORIES } from "./types";
import { DEFAULT_LEVELS, LEVELS, categoryLabels, levelFor } from "./levels";
import type { SharingLevel } from "./types";

type Listener = (snapshot: AppState) => void;

interface StoreShape {
  state: AppState;
  loading: Promise<AppState> | null;
  listeners: Set<Listener>;
  broadcastTimer: NodeJS.Timeout | null;
  consentRefresh?: Promise<void>;
  consentCheckedAt?: number;
  consentQueue?: Promise<unknown>;
  /** Currently loaded patient SIM id (survives HMR; switchable at demo time). */
  activePatientSimId?: string;
}

const requestStore = new AsyncLocalStorage<StoreShape>();
const runtimeBases = new Map<string, { state: AppState; expires: number }>();
const runtimeLoads = new Map<string, Promise<AppState>>();

async function loadRuntimeBase(patientId: string): Promise<AppState> {
  const cached = runtimeBases.get(patientId);
  if (cached && cached.expires > Date.now()) return structuredClone(cached.state);
  if (!runtimeLoads.has(patientId)) runtimeLoads.set(patientId,
    loadStateFromSim(agentMode(), agentModel(), patientId).then(state => {
      if (runtimeBases.size >= 20) runtimeBases.delete(runtimeBases.keys().next().value!);
      runtimeBases.set(patientId, { state, expires: Date.now() + 15000 });
      return state;
    }).finally(() => { runtimeLoads.delete(patientId); }));
  return structuredClone(await runtimeLoads.get(patientId)!);
}

export async function withRuntimeState<T>(work: () => Promise<T>, write = true, selectedPatientId?: string): Promise<T> {
  if (!process.env.DATABASE_URL || requestStore.getStore()) return work();
  const patientId = selectedPatientId || (await cookies()).get('kindred_patient')?.value || DEFAULT_PATIENT_SIM_ID;
  if (!/^SIM-\d+$/.test(patientId)) throw new Error('Invalid patient selection.');
  return withRuntimeSnapshot(patientId, write, async saved => {
    const scope: StoreShape = { state: await loadRuntimeBase(patientId), activePatientSimId: patientId, loading: null, listeners: new Set(), broadcastTimer: null };
    return requestStore.run(scope, async () => {
      if (selectedPatientId) await ensureSyntheticCircle(scope.state);
      await refreshConsent(true);
      if (scope.state.ehr.syncError) throw new Error("Sharing preferences are unavailable. Please try again.");
      scope.state = restoreRuntimeSnapshot(scope.state, saved);
      try {
        const value = await work();
        const success = !(value instanceof Response) || value.ok;
        return { value, ...(write && success && scope.state.loaded ? { snapshot: runtimeSnapshot(scope.state) } : {}) };
      } finally { if (scope.broadcastTimer) clearTimeout(scope.broadcastTimer); }
    });
  });
}

declare global {
  var __kindredStore: StoreShape | undefined;
}

export function agentMode(): AgentMode {
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return "claude";
  return "scripted";
}

export function agentModel(): string {
  const mode = agentMode();
  if (mode === "openai") return process.env.AGENT_MODEL ?? "gpt-5.6-sol";
  if (mode === "claude") return process.env.AGENT_MODEL ?? "claude-opus-5";
  return "scripted";
}

function emptyState(err?: string): AppState {
  return {
    loaded: false,
    loadError: err,
    source: { kind: "nhs-sim", baseUrl: process.env.SIM_BASE_URL ?? "https://sim.animahealth.com", fetchedAt: new Date().toISOString() },
    patientId: "patient",
    agentId: "kindred",
    patient: { simId: "", name: "", birthDate: "", age: 0, practice: "", needs: [], goals: [] },
    now: new Date().toISOString(),
    agentMode: agentMode(),
    agentModel: agentModel(),
    people: [
      { id: "patient", name: "Loading…", shortName: "…", role: "patient", relation: "", color: "#2F6B4F", initials: "…" },
      { id: "kindred", name: "Kindred", shortName: "Kindred", role: "agent", relation: "Care companion", color: "#6D2E5B", initials: "K" },
    ],
    appointments: [],
    labs: [],
    medications: [],
    conditions: [],
    careNotes: [],
    mentalHealth: [],
    nextActions: [],
    consent: {},
    levels: { ...DEFAULT_LEVELS },
    consentRequests: [],
    threads: {},
    messages: [],
    audit: [],
    ehr: { consentVersion: 0, lastSyncedAt: null },
    busyThreads: [],
  };
}

function getStore(): StoreShape {
  const scoped = requestStore.getStore();
  if (scoped) return scoped;
  if (!globalThis.__kindredStore) {
    globalThis.__kindredStore = { state: emptyState(), loading: null, listeners: new Set(), broadcastTimer: null, activePatientSimId: DEFAULT_PATIENT_SIM_ID };
  }
  const s = globalThis.__kindredStore;
  // State created by an older module version (HMR) may predate newer fields.
  if (!s.state.levels) s.state = { ...s.state, levels: { ...DEFAULT_LEVELS } };
  if (!s.activePatientSimId) s.activePatientSimId = DEFAULT_PATIENT_SIM_ID;
  return s;
}

export function getActivePatientSimId(): string {
  return getStore().activePatientSimId || DEFAULT_PATIENT_SIM_ID;
}

/**
 * Ensure Kindred's synthetic circle exists in the companion consent DB for this
 * patient (members + default sharing categories). Idempotent via externalId.
 */
export async function ensureSyntheticCircle(state: AppState): Promise<{ seeded: string[] }> {
  const circle = circleFor(state.patient.simId);
  const familyPeople = state.people.filter((p) => p.role === "family" || p.role === "carer");
  if (!familyPeople.length) return { seeded: [] };
  const seeded: string[] = [];
  try {
    const snapshot = await getConsentSnapshot(state.patient.simId);
    const byExternal = new Set(snapshot.members.map((m) => m.externalId).filter(Boolean));
    const byName = new Set(snapshot.members.filter((m) => m.status === "active").map((m) => m.name.toLowerCase()));
    for (const person of familyPeople) {
      if (byExternal.has(person.id) || byName.has(person.name.toLowerCase())) continue;
      const categories = CATEGORIES.filter((c) => state.consent[person.id]?.[c.id]).map((c) => toStoredCategory(c.id));
      await consentRequest(state.patient.simId, "/members", "POST", {
        name: person.name,
        relationship: person.relation,
        email: "",
        externalId: person.id,
        role: person.role,
        categories,
      });
      seeded.push(person.name);
    }
  } catch {
    // Companion optional: in-memory circle from mapper still works for the demo shell.
  }
  return { seeded };
}

/** Load (once) from the sim. Safe to call from every route handler. */
export async function ensureLoaded(): Promise<AppState> {
  const s = getStore();
  if (s.state.loaded) { await refreshConsent(); return s.state; }
  if (!s.loading) {
    s.loading = (async () => {
      if (!simConfigured()) {
        s.state = emptyState("SIM_API_KEY is not set. Add it to web/.env.local (POST https://sim.animahealth.com/api/keys {teamName}).");
        scheduleBroadcast();
        return s.state;
      }
      try {
        const patientSimId = getActivePatientSimId();
        s.state = await loadStateFromSim(agentMode(), agentModel(), patientSimId);
        const { seeded } = await ensureSyntheticCircle(s.state);
        if (seeded.length) {
          s.state = {
            ...s.state,
            audit: [
              {
                id: `a-circle-${Date.now()}`,
                ts: new Date().toISOString(),
                kind: "system",
                actorId: s.state.agentId,
                summary: `Seeded Kindred synthetic circle for ${s.state.patient.name}: ${seeded.join(", ")}.`,
                ok: true,
              },
              ...s.state.audit,
            ],
          };
        }
        await refreshConsent(true);
      } catch (e) {
        s.state = emptyState(`Could not load from NHS-SIM: ${e instanceof Error ? e.message : String(e)}`);
      }
      scheduleBroadcast();
      return s.state;
    })().finally(() => {
      s.loading = null;
    });
  }
  return s.loading;
}

export function getState(): AppState {
  return getStore().state;
}

export function subscribe(fn: Listener): () => void {
  const s = getStore();
  s.listeners.add(fn);
  return () => s.listeners.delete(fn);
}

let counter = 0;
export function newId(prefix: string): string {
  if (process.env.DATABASE_URL) return `${prefix}-${randomUUID()}`;
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/** Sim date, real time-of-day — so entries order naturally during a demo. */
export function nowIso(): string {
  const real = new Date();
  const demo = new Date(getState().now);
  if (Number.isNaN(demo.getTime())) return real.toISOString();
  demo.setUTCHours(real.getUTCHours(), real.getUTCMinutes(), real.getUTCSeconds(), real.getUTCMilliseconds());
  return demo.toISOString();
}

function scheduleBroadcast() {
  const s = getStore();
  if (s.broadcastTimer) return;
  s.broadcastTimer = setTimeout(() => {
    s.broadcastTimer = null;
    const snap = s.state;
    for (const l of s.listeners) {
      try {
        l(snap);
      } catch {
        s.listeners.delete(l);
      }
    }
  }, 60);
}

export function mutate(fn: (draft: AppState) => void): AppState {
  const s = getStore();
  fn(s.state);
  s.state = { ...s.state };
  scheduleBroadcast();
  return s.state;
}

/** Re-fetch everything from the sim (keeps nothing local). */
export async function resetState(): Promise<AppState> {
  if (process.env.DATABASE_URL) runtimeBases.delete(getActivePatientSimId());
  const s = getStore();
  s.state = { ...emptyState(), loaded: false };
  scheduleBroadcast();
  return ensureLoaded();
}

/** Switch the active Kindred patient record and rebuild their synthetic circle. */
export async function switchPatient(patientSimId: string): Promise<AppState> {
  const id = patientSimId.trim();
  if (!/^SIM-\d+$/i.test(id)) {
    throw Object.assign(new Error("Patient id must look like SIM-000001."), { status: 400 });
  }
  const s = getStore();
  if (s.state.loaded && s.state.patient.simId === id) return s.state;
  s.activePatientSimId = id.toUpperCase().replace(/^sim-/i, "SIM-");
  // Abort any in-flight load for the previous patient.
  s.loading = null;
  s.state = { ...emptyState(), loaded: false };
  scheduleBroadcast();
  return ensureLoaded();
}

export function listDemoPatients(activeSimId?: string) {
  const active = activeSimId || getActivePatientSimId();
  return DEMO_PATIENTS.map((p) => ({
    simId: p.simId,
    name: p.name,
    blurb: p.blurb,
    familyCount: p.family.length,
    active: p.simId === active,
    demo: true as const,
  }));
}

/** Search live sim directory for the patient picker (demo + live judging). */
export async function searchPatientsForPicker(q: string) {
  const query = q.trim();
  if (!query && !process.env.DATABASE_URL) {
    return { total: DEMO_PATIENTS.length, items: listDemoPatients() };
  }
  if (!simConfigured()) {
    const lowered = query.toLowerCase();
    const items = listDemoPatients().filter(
      (p) => p.name.toLowerCase().includes(lowered) || p.simId.toLowerCase().includes(lowered),
    );
    return { total: items.length, items };
  }
  const res = await sim.searchPatients(query);
  const demoById = new Map(DEMO_PATIENTS.map((p) => [p.simId, p]));
  const active = getActivePatientSimId();
  const items = (res.items || []).slice(0, 30).map((p) => {
    const demo = demoById.get(p.id);
    return {
      simId: p.id,
      name: p.name,
      blurb: demo?.blurb ?? (p.conditions?.slice(0, 2).join(" · ") || "Live sim patient"),
      familyCount: demo?.family.length ?? circleFor(p.id).family.length,
      active: p.id === active,
      birthDate: p.birthDate,
      demo: Boolean(demo),
    };
  });
  return { total: res.total ?? items.length, items };
}

// ---------- Audit ----------

export function addAudit(entry: Omit<AuditEntry, "id" | "ts">): AuditEntry {
  const full: AuditEntry = { id: newId("a"), ts: nowIso(), ...entry };
  mutate((d) => {
    d.audit = [full, ...d.audit].slice(0, 300);
  });
  return full;
}

export function audit(kind: AuditKind, actorId: string, summary: string, detail?: unknown, ok = true) {
  return addAudit({ kind, actorId, summary, detail, ok });
}

// ---------- Consent ----------

export function checkConsent(viewerId: string, category: Category): ConsentCheck {
  const state = getState();
  const allowed = canAccess(state, viewerId, category);
  const who = personById(state, viewerId);
  const cat = CATEGORIES.find((c) => c.id === category)!;
  addAudit({
    kind: "consent.check",
    actorId: viewerId,
    summary: `${who.shortName} → ${cat.label}: ${allowed ? "allowed" : "not shared"}`,
    detail: { granteeId: viewerId, category, allowed, basis: viewerId === state.patientId ? "patient" : viewerId === state.agentId ? "agent acting for patient" : `consent v${state.ehr.consentVersion}` },
    ok: allowed,
  });
  return { granteeId: viewerId, category, allowed };
}

export async function refreshConsent(force = false): Promise<void> {
  const s = getStore();
  if (!s.state.loaded || (!force && Date.now() - (s.consentCheckedAt || 0) < 2000)) return;
  if (s.consentRefresh) return s.consentRefresh;
  s.consentRefresh = (async () => {
    try {
      const snapshot = await getConsentSnapshot(s.state.patient.simId);
      if (!s.state.ehr.persistent || snapshot.revision !== s.state.ehr.consentVersion || s.state.ehr.syncError) {
        s.state = applyConsentSnapshot(s.state, snapshot);
        scheduleBroadcast();
      }
    } catch (error) {
      s.state = { ...s.state, ehr: { ...s.state.ehr, syncError: error instanceof Error ? error.message : 'Consent connection failed.' } };
      scheduleBroadcast();
    } finally { s.consentCheckedAt = Date.now(); s.consentRefresh = undefined; }
  })();
  return s.consentRefresh;
}

function consentWrite<T>(fn: () => Promise<T>): Promise<T> {
  const s = getStore();
  const result = (s.consentQueue || Promise.resolve()).then(fn);
  s.consentQueue = result.catch(() => {});
  return result;
}

export function setConsent(opts: { granteeId: string; category: Category; allowed: boolean; actorId: string; via: "app" | "agent" | "request"; expectedVersion?: number }) {
  return consentWrite(async () => {
    const s = getStore();
    if (opts.actorId !== s.state.patientId) throw Object.assign(new Error('Only the patient can change consent.'), { status: 403 });
    if (!CATEGORIES.some(c => c.id === opts.category) || typeof opts.allowed !== 'boolean') throw Object.assign(new Error('Invalid consent choice.'), { status: 400 });
    const who = personById(s.state, opts.granteeId);
    const snapshot = await getConsentSnapshot(s.state.patient.simId);
    const member = snapshot.members.find(m => m.id === who.consentMemberId);
    if (!member || member.status !== 'active') throw Object.assign(new Error('This circle member has no active access.'), { status: 409 });
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== member.version) { await refreshConsent(true); throw Object.assign(new Error('These preferences changed. Try again with the refreshed choices.'), { status: 409 }); }
    const category = toStoredCategory(opts.category);
    if (member.categories.includes(category) === opts.allowed) { await refreshConsent(true); return { changed: false, version: snapshot.revision }; }
    const categories = opts.allowed ? [...member.categories, category] : member.categories.filter(c => c !== category);
    await consentRequest(s.state.patient.simId, `/members/${member.id}`, 'PUT', { name: member.name, relationship: member.relationship, email: member.email, categories, expectedVersion: member.version });
    const saved = await getConsentSnapshot(s.state.patient.simId);
    s.state = applyConsentSnapshot(s.state, saved);
    scheduleBroadcast();
    return { changed: true, version: saved.revision };
  });
}

export function addFamilyMember(input: { name: string; relationship: string; email?: string }) {
  return consentWrite(async () => {
    const s = getStore();
    const externalId = newId('family');
    await consentRequest<{ member: ConsentMember }>(s.state.patient.simId, '/members', 'POST', { ...input, email: input.email || '', externalId, role: input.relationship === 'Carer' ? 'carer' : 'family', categories: [] });
    s.state = applyConsentSnapshot(s.state, await getConsentSnapshot(s.state.patient.simId));
    scheduleBroadcast();
    return { id: externalId };
  });
}

export function removeFamilyMember(granteeId: string) {
  return consentWrite(async () => {
    const s = getStore();
    const person = personById(s.state, granteeId);
    if (!['family', 'carer'].includes(person.role)) throw Object.assign(new Error('Only family members and carers can be removed here.'), { status: 400 });
    const snapshot = await getConsentSnapshot(s.state.patient.simId);
    const member = snapshot.members.find(m => m.id === person.consentMemberId);
    if (!member) throw Object.assign(new Error('Family member not found.'), { status: 404 });
    await consentRequest(s.state.patient.simId, `/members/${member.id}/revoke`, 'POST', { expectedVersion: member.version });
    s.state = applyConsentSnapshot(s.state, await getConsentSnapshot(s.state.patient.simId));
    scheduleBroadcast();
    return { ok: true };
  });
}

// ---------- Sharing levels ----------

/** Put a person on a sharing level: writes the level's full category set for that member. */
export function setSharingLevel(opts: { granteeId: string; level: SharingLevel; actorId: string; via: "app" | "agent" }) {
  return consentWrite(async () => {
    const s = getStore();
    if (opts.actorId !== s.state.patientId) throw Object.assign(new Error("Only the patient can change sharing."), { status: 403 });
    if (!LEVELS.some((l) => l.id === opts.level)) throw Object.assign(new Error("Unknown sharing level."), { status: 400 });
    const who = personById(s.state, opts.granteeId);
    const snapshot = await getConsentSnapshot(s.state.patient.simId);
    const member = snapshot.members.find((m) => m.id === who.consentMemberId);
    if (!member || member.status !== "active") throw Object.assign(new Error("This circle member has no active access."), { status: 409 });
    const target = s.state.levels[opts.level].map(toStoredCategory);
    const unchanged = target.length === member.categories.length && target.every((c) => member.categories.includes(c));
    if (unchanged) return { changed: false, level: opts.level, version: snapshot.revision };
    await consentRequest(s.state.patient.simId, `/members/${member.id}`, "PUT", { name: member.name, relationship: member.relationship, email: member.email, categories: target, expectedVersion: member.version });
    const saved = await getConsentSnapshot(s.state.patient.simId);
    s.state = applyConsentSnapshot(s.state, saved);
    scheduleBroadcast();
    const label = LEVELS.find((l) => l.id === opts.level)!.label;
    addAudit({
      kind: "consent.update",
      actorId: opts.actorId,
      summary: `${who.shortName} moved to “${label}” — ${categoryLabels(s.state.levels[opts.level]).join(", ")} (${opts.via === "agent" ? "via Kindred" : "in app"})`,
      detail: { granteeId: opts.granteeId, level: opts.level, categories: s.state.levels[opts.level], via: opts.via },
      ok: true,
    });
    return { changed: true, level: opts.level, version: saved.revision };
  });
}

/** Redefine what a level means and re-apply it to everyone currently on that level. */
export function setLevelDefinition(opts: { level: SharingLevel; categories: Category[]; actorId: string }) {
  return consentWrite(async () => {
    const s = getStore();
    if (opts.actorId !== s.state.patientId) throw Object.assign(new Error("Only the patient can change what a level means."), { status: 403 });
    if (opts.level === "everything") throw Object.assign(new Error("“Everything” always means the whole record."), { status: 400 });
    const categories = CATEGORIES.map((c) => c.id).filter((c) => opts.categories.includes(c));
    if (categories.length === 0) throw Object.assign(new Error("A level must include at least one part of the record."), { status: 400 });
    const before = s.state.levels[opts.level];
    const onLevel = Object.keys(s.state.consent).filter((id) => levelFor(s.state.levels, s.state.consent[id]) === opts.level);
    s.state = { ...s.state, levels: { ...s.state.levels, [opts.level]: categories } };
    scheduleBroadcast();
    const snapshot = await getConsentSnapshot(s.state.patient.simId);
    const reapplied: string[] = [];
    for (const id of onLevel) {
      const who = personById(s.state, id);
      const member = snapshot.members.find((m) => m.id === who.consentMemberId);
      if (!member || member.status !== "active") continue;
      await consentRequest(s.state.patient.simId, `/members/${member.id}`, "PUT", { name: member.name, relationship: member.relationship, email: member.email, categories: categories.map(toStoredCategory), expectedVersion: member.version });
      reapplied.push(who.shortName);
    }
    if (onLevel.length) {
      s.state = applyConsentSnapshot(s.state, await getConsentSnapshot(s.state.patient.simId));
      scheduleBroadcast();
    }
    const label = LEVELS.find((l) => l.id === opts.level)!.label;
    addAudit({
      kind: "consent.update",
      actorId: opts.actorId,
      summary: `“${label}” now means ${categoryLabels(categories).join(", ")}${reapplied.length ? ` · re-applied to ${reapplied.join(", ")}` : ""}`,
      detail: { level: opts.level, before, after: categories, reapplied },
      ok: true,
    });
    return { ok: true, reapplied };
  });
}

// ---------- Messages ----------

export function addMessage(msg: Omit<Message, "id" | "ts"> & { ts?: string }): Message {
  const full: Message = { id: newId("m"), ts: msg.ts ?? nowIso(), ...msg };
  mutate((d) => {
    d.messages = [...d.messages, full];
  });
  return full;
}

export function updateMessage(id: string, patch: Partial<Message>) {
  mutate((d) => {
    d.messages = d.messages.map((m) => (m.id === id ? { ...m, ...patch } : m));
  });
}

export function clearDirectChat(threadId: string, actorId: string) {
  const state = getState();
  const thread = state.threads[threadId];
  if (!thread || thread.kind !== 'direct' || !thread.memberIds.includes(actorId) || !thread.memberIds.includes(state.agentId)) throw new Error('Choose your direct Kindred conversation.');
  if (state.busyThreads.includes(threadId)) throw new Error('Wait for the current reply to finish.');
  mutate(d => { d.messages = d.messages.filter(message => message.threadId !== threadId || message.kind !== 'chat'); });
}

export function setThreadBusy(threadId: string, busy: boolean) {
  mutate((d) => {
    d.busyThreads = busy ? Array.from(new Set([...d.busyThreads, threadId])) : d.busyThreads.filter((t) => t !== threadId);
  });
}

export function threadForPair(a: string, b: string) {
  return Object.values(getState().threads).find((t) => t.kind === "direct" && t.memberIds.includes(a) && t.memberIds.includes(b));
}
