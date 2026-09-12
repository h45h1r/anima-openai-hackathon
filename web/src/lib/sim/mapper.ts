import { normaliseChatIds } from '../chat-ids';
// Builds the app state from live NHS-SIM data for one patient. Everything
// clinical (problems, medicines, blood results, appointments, notes) comes
// from the sim's GP workspace; the circle (who is family) comes from circle.ts
// and each member's identity is looked up in the sim directory.

import { AGENT, CLINICIAN_DEFAULTS, circleFor } from "../data/circle";
import type { AgentMode, AppState, Appointment, CareNote, Category, Condition, ConsentMap, LabResult, Medication, MentalHealthEntry, NextAction, Person, Thread } from "../types";
import { CATEGORIES, ageAt, firstName, initialsOf } from "../types";
import { sim, type SimPatient, type SimResource } from "./client";
import { DEFAULT_LEVELS } from "../levels";

const iso = (ms: number) => new Date(ms).toISOString();
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const MENTAL_HEALTH_TERMS = /sleep|mood|anxiet|depress|mental|stress|bereave|dementia|memory|wellbeing|loneli/i;

function scope(on: Category[]): Record<Category, boolean> {
  const s = Object.fromEntries(CATEGORIES.map((c) => [c.id, false])) as Record<Category, boolean>;
  for (const c of on) s[c] = true;
  return s;
}

function needToPrep(need: string): string | null {
  const n = need.toLowerCase();
  if (n.includes("step-free")) return "Step-free access is on record — ask for a ground-floor room on arrival";
  if (n.includes("transport")) return "Transport is a recorded need — arrange a lift";
  if (n.includes("interpreter")) return "An interpreter is on record — confirm one is booked";
  if (n.includes("carer")) return "Carer involvement is on record — a family member is welcome to attend";
  if (n.includes("sms") || n.includes("offline")) return `Contact preference on record: ${need}`;
  return null;
}

function uniquePersonId(base: string, used: Set<string>): string {
  let id = base || "member";
  if (!used.has(id)) {
    used.add(id);
    return id;
  }
  let n = 2;
  while (used.has(`${id}-${n}`)) n += 1;
  const next = `${id}-${n}`;
  used.add(next);
  return next;
}

export async function loadStateFromSim(agentMode: AgentMode, agentModel: string, patientSimId: string): Promise<AppState> {
  const circle = circleFor(patientSimId);
  const [team, view, patientSearch] = await Promise.all([
    sim.team().catch(() => undefined),
    sim.view("gp", patientSimId),
    sim.searchPatients(patientSimId),
  ]);
  const simPatient = patientSearch.items.find((p) => p.id === patientSimId);
  if (!simPatient) throw new Error(`Patient ${patientSimId} not found in sim directory`);

  // Family identities from the sim directory (one search per surname is enough).
  const surname = simPatient.name.split(" ").pop() ?? simPatient.name;
  const relatives = await sim.searchPatients(surname).then((r) => r.items).catch(() => [] as SimPatient[]);
  const practiceId = simPatient.localIds?.gp ? `SIM-${simPatient.localIds.gp.split("-")[0] === "RIV" ? "RIVERSIDE" : simPatient.localIds.gp.split("-")[0]}` : undefined;
  let org = practiceId ? await sim.organization(practiceId).catch(() => undefined) : undefined;
  if (!org && practiceId) {
    // The local sim-app serves the ODS search but not the single-organisation read.
    const list = await sim.organizations().catch(() => undefined);
    org = list?.entry?.map((e) => e.resource).find((r) => r?.id === practiceId) ?? undefined;
  }
  const practice = org?.name ?? "GP practice";

  const rs = view.resources.filter((r) => !r.patientId || r.patientId === patientSimId);
  const nowMs = view.now;
  const now = iso(nowMs);
  const patientId = slug(firstName(simPatient.name));
  const agentId = AGENT.id;
  const usedIds = new Set<string>([patientId, agentId]);

  // ---- People ----
  const people: Person[] = [
    { id: patientId, name: simPatient.name, shortName: firstName(simPatient.name), role: "patient", relation: `Patient, ${ageAt(simPatient.birthDate, now)}`, color: "#2F6B4F", initials: initialsOf(simPatient.name), simId: simPatient.id, birthDate: simPatient.birthDate },
    { id: agentId, name: AGENT.name, shortName: AGENT.name, role: "agent", relation: "Care companion", color: AGENT.color, initials: "K" },
  ];
  const consent: ConsentMap = {};
  for (const m of circle.family) {
    if (m.simId) {
      const sp =
        relatives.find((p) => p.id === m.simId) ??
        (await sim.searchPatients(m.simId).then((r) => r.items.find((p) => p.id === m.simId)).catch(() => undefined));
      if (sp) {
        const id = uniquePersonId(slug(firstName(sp.name)), usedIds);
        people.push({
          id,
          name: sp.name,
          shortName: firstName(sp.name),
          role: m.role,
          relation: m.relation,
          color: m.color,
          initials: initialsOf(sp.name),
          simId: sp.id,
          birthDate: sp.birthDate,
        });
        consent[id] = scope(m.consent);
        continue;
      }
    }
    // Synthetic Kindred-owned relative (not an EHR fact).
    const displayName = m.name ?? m.relation;
    const id = uniquePersonId(slug(firstName(displayName)), usedIds);
    people.push({
      id,
      name: displayName,
      shortName: firstName(displayName),
      role: m.role,
      relation: m.relation,
      color: m.color,
      initials: initialsOf(displayName),
    });
    consent[id] = scope(m.consent);
  }

  // Clinicians are whoever appears in the record.
  const clinicianNames = new Map<string, { org: string; kind: "practice" | "hospital"; role: string }>();
  const addClin = (name: unknown, org: string, kind: "practice" | "hospital", role: string) => {
    if (typeof name !== "string" || !name.trim() || /team|reception|coordinator/i.test(name)) return;
    if (!clinicianNames.has(name)) clinicianNames.set(name, { org, kind, role });
  };
  for (const r of rs) {
    if (r.kind === "appointment") addClin(r.data?.clinician, practice, "practice", /^nurse/i.test(r.data?.clinician ?? "") ? "Practice nurse" : "GP");
    if (r.kind === "encounter") addClin(r.data?.author, practice, "practice", "GP");
    if (r.kind === "discharge-summary") addClin(r.data?.sentBy, r.title.split("·")[0]?.trim() ? `${r.title.split("·")[0].trim()} clinic` : "Hospital", "hospital", "Hospital consultant");
  }
  const clinicianColors = ["#3C5A7A", "#4C6A5A", "#5A4C7A", "#7A5A3C"];
  let ci = 0;
  const clinicianIdByName = new Map<string, string>();
  for (const [name, meta] of clinicianNames) {
    const id = uniquePersonId(slug(name), usedIds);
    clinicianIdByName.set(name, id);
    people.push({ id, name, shortName: /^(dr|nurse)/i.test(name) ? `${name.split(" ")[0]} ${name.split(" ").pop()}` : firstName(name), role: "clinician", relation: meta.role, color: clinicianColors[ci++ % clinicianColors.length], initials: initialsOf(name), org: meta.org });
    consent[id] = scope(CLINICIAN_DEFAULTS[meta.kind]);
  }
  const defaultClinicianId = people.find((p) => p.role === "clinician")?.id ?? patientId;

  // ---- Record sections ----
  const ehr = rs.find((r) => r.kind === "ehr-record");
  const problems: { term: string; code?: string; date: string; status: string }[] = ehr?.data?.problems ?? [];
  const activeByTerm = new Map<string, { term: string; code?: string; date: string; status: string }>();
  for (const p of [...problems].sort((a, b) => a.date.localeCompare(b.date))) {
    if (p.status === "active") activeByTerm.set(p.term, p);
    else if (activeByTerm.get(p.term)?.date && activeByTerm.get(p.term)!.date < p.date) activeByTerm.delete(p.term);
  }
  const conditions: Condition[] = [...activeByTerm.values()].map((p) => ({ id: slug(`cond-${p.term}`), name: p.term, since: p.date.slice(0, 4), status: "Active", code: p.code }));
  for (const c of simPatient.conditions ?? []) if (!conditions.some((x) => x.name === c)) conditions.push({ id: slug(`cond-${c}`), name: c, since: "", status: "Recorded" });

  const medications: Medication[] = ((ehr?.data?.medications ?? []) as { term: string; isCurrent?: boolean; indication?: string; route?: string; prescriptionType?: string }[])
    .filter((m) => m.isCurrent !== false)
    .map((m, i) => ({ id: `med-${i}`, name: m.term, dose: "", schedule: m.prescriptionType ?? "", purpose: m.indication ?? "" }));

  const mentalHealth: MentalHealthEntry[] = conditions
    .filter((c) => MENTAL_HEALTH_TERMS.test(c.name))
    .map((c) => ({ id: `mh-${c.id}`, date: activeByTerm.get(c.name)?.date ?? "", title: c.name, detail: `Active on the GP problem list since ${activeByTerm.get(c.name)?.date ?? "—"}.` }));
  for (const r of rs) {
    if (r.kind === "encounter" && MENTAL_HEALTH_TERMS.test(`${r.data?.reason ?? ""} ${r.data?.text ?? ""}`)) {
      mentalHealth.push({ id: `mh-${r.id}`, date: day(r.createdAt), title: r.title, detail: r.data?.text ?? "" });
    }
  }

  // ---- Labs: latest value per analyte, with history ----
  const reports = rs.filter((r) => r.kind === "report" && r.data?.kind === "blood-result" && r.status === "available").sort((a, b) => (a.data.collectedAt ?? a.createdAt) - (b.data.collectedAt ?? b.createdAt));
  const byAnalyte = new Map<string, { name: string; unit: string; panel: string; low?: number; high?: number; series: { value: number; date: string }[] }>();
  for (const r of reports) {
    for (const a of r.data.analytes as { id: string; name: string; unit: string; value: number; referenceLow?: number; referenceHigh?: number }[]) {
      const e = byAnalyte.get(a.id) ?? { name: a.name, unit: a.unit, panel: r.data.panel?.name ?? r.title, low: a.referenceLow, high: a.referenceHigh, series: [] as { value: number; date: string }[] };
      e.series.push({ value: a.value, date: day(r.data.collectedAt ?? r.createdAt) });
      byAnalyte.set(a.id, e);
    }
  }
  const labs: LabResult[] = [...byAnalyte.entries()].map(([code, e]) => {
    const latest = e.series[e.series.length - 1];
    const prev = e.series[e.series.length - 2];
    const flag: LabResult["flag"] = e.low !== undefined && latest.value < e.low ? "low" : e.high !== undefined && latest.value > e.high ? "high" : "normal";
    return { id: `lab-${code}`, code, name: e.name, panel: e.panel, value: latest.value, unit: e.unit, date: latest.date, refLow: e.low, refHigh: e.high, refRange: e.low !== undefined && e.high !== undefined ? `${e.low}–${e.high}` : "", flag, previous: prev, history: e.series };
  });
  // Abnormal first, then by panel.
  labs.sort((a, b) => (a.flag === "normal" ? 1 : 0) - (b.flag === "normal" ? 1 : 0) || a.panel.localeCompare(b.panel));

  // ---- Appointments ----
  const sessions = rs.filter((r) => r.kind === "appointment-session");
  const prepFromNeeds = (simPatient.needs ?? []).map(needToPrep).filter((x): x is string => Boolean(x));
  const appointments: Appointment[] = rs
    .filter((r) => r.kind === "appointment" && !["cancelled", "completed"].includes(r.status) && (r.data?.startsAt ?? r.dueAt ?? 0) >= nowMs - 3600_000)
    .map((r) => {
      const startsAt: number = r.data?.startsAt ?? r.dueAt ?? nowMs;
      const session = sessions.find((s) => s.id === r.data?.sessionId);
      const clinicianName: string | undefined = r.data?.clinician;
      return {
        id: r.id,
        title: r.title,
        specialty: r.data?.reason ?? r.title,
        clinicianId: (clinicianName && clinicianIdByName.get(clinicianName)) ?? defaultClinicianId,
        location: session?.data?.location ? `${practice}, ${session.data.location}` : r.data?.location ?? practice,
        start: iso(startsAt),
        durationMin: r.data?.durationMinutes ?? 15,
        purpose: r.data?.reason ?? "",
        prep: prepFromNeeds,
        mode: r.data?.mode,
        announcedToFamily: false,
        simVersion: r.version,
      };
    })
    .sort((a, b) => a.start.localeCompare(b.start));

  // ---- Care notes: consultations + personal context ----
  const careNotes: CareNote[] = [];
  let context: string | undefined;
  for (const r of rs) {
    if (r.kind === "encounter" && r.data?.text) {
      careNotes.push({ id: r.id, date: day(r.createdAt), authorId: (r.data?.author && clinicianIdByName.get(r.data.author)) ?? defaultClinicianId, title: `${r.title}${r.data?.reason ? ` — ${r.data.reason}` : ""}`, text: r.data.text });
    }
    if (r.kind === "discharge-summary" && r.data?.sections) {
      const sec = r.data.sections as NonNullable<CareNote["sections"]>;
      const clinic = r.title.split("·")[0]?.trim();
      careNotes.push({
        id: r.id,
        kind: "letter",
        date: day((r.data?.sentAt as number | undefined) ?? r.createdAt),
        authorId: (r.data?.sentBy && clinicianIdByName.get(r.data.sentBy as string)) ?? defaultClinicianId,
        title: clinic ? `${clinic} clinic letter` : "Hospital letter",
        text: [sec.reason, sec.course, sec.results, sec.diagnoses, sec.followUp].filter(Boolean).join(" "),
        sections: sec,
      });
    }
    if (r.kind === "observation" && typeof r.data?.text === "string" && r.data.text.length > 20) {
      careNotes.push({ id: r.id, date: day(r.createdAt), authorId: defaultClinicianId, title: r.title, text: r.data.text });
      if (/what matters|lives with|context/i.test(r.title + r.data.text)) context = r.data.text;
    }
  }
  careNotes.sort((a, b) => b.date.localeCompare(a.date));

  // ---- Next actions: open tasks, messages asking the patient to do something, letter follow-ups ----
  const nextActions: NextAction[] = [];
  for (const r of rs) {
    if (r.kind === "task" && r.status === "open") nextActions.push({ id: r.id, text: r.title, due: r.dueAt ? day(r.dueAt) : undefined, owner: "clinic", done: false, source: "GP task" });
    if (r.kind === "conversation" && r.status === "open") {
      for (const e of (r.data?.entries ?? []) as { id: string; body: string; direction?: string; actor?: { kind?: string } }[]) {
        if (e.direction === "incoming") continue;
        nextActions.push({ id: `${r.id}-${e.id}`, text: e.body, owner: "patient", done: false, source: `Message from the practice: ${r.title}` });
      }
    }
    if (r.kind === "discharge-summary" && r.data?.sections?.followUp) nextActions.push({ id: `${r.id}-followup`, text: r.data.sections.followUp, owner: "clinic", done: false, source: r.title });
  }

  // ---- Threads ----
  const family = people.filter((p) => p.role === "family" || p.role === "carer");
  const threads: Record<string, Thread> = {
    "family-group": { id: "family-group", title: `${surname} family`, memberIds: [patientId, ...family.map((f) => f.id), agentId], kind: "group" },
    [`${patientId}-kindred`]: { id: `${patientId}-kindred`, title: "Kindred", memberIds: [patientId, agentId], kind: "direct" },
  };
  for (const f of family) threads[`${f.id}-kindred`] = { id: `${f.id}-kindred`, title: "Kindred", memberIds: [f.id, agentId], kind: "direct" };

  return normaliseChatIds<AppState>({
    loaded: true,
    source: { kind: "nhs-sim", baseUrl: sim.base, world: team?.world ?? view.id, fetchedAt: new Date().toISOString() },
    patientId,
    agentId,
    patient: { simId: simPatient.id, name: simPatient.name, birthDate: simPatient.birthDate, age: ageAt(simPatient.birthDate, now), practice, practiceId, localId: simPatient.localIds?.gp, needs: simPatient.needs ?? [], goals: simPatient.goals ?? [], context },
    now,
    agentMode,
    agentModel,
    people,
    appointments,
    labs,
    medications,
    conditions,
    careNotes,
    mentalHealth,
    nextActions,
    consent,
    levels: { ...DEFAULT_LEVELS },
    consentRequests: [],
    threads,
    messages: [],
    audit: [
      { id: "a-load", ts: new Date().toISOString(), kind: "system", actorId: agentId, summary: `Loaded ${simPatient.name} (${simPatient.id}) from NHS-SIM world ${team?.world ?? view.id}: ${rs.length} records, ${labs.length} analytes, ${appointments.length} upcoming appointment(s). Consent v1 on file.`, ok: true, detail: { resourceKinds: countBy(rs.map((r) => r.kind)) } },
    ],
    ehr: { consentVersion: 1, lastSyncedAt: new Date().toISOString() },
    busyThreads: [],
  });
}

function countBy(xs: string[]) {
  const out: Record<string, number> = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return out;
}

export type { SimResource };
