// Deterministic fallback runtime (no API key). Intent → same tools → prose
// composed from the live record. Nothing here is patient-specific.

import { getState, updateMessage } from "../store";
import { CATEGORIES, personById, type Category, type LabResult, type ToolTrace } from "../types";
import { runTool, toolsForActor, type ToolResult } from "./tools";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function typeOut(messageId: string, text: string, traces: ToolTrace[]) {
  const words = text.split(" ");
  let acc = "";
  for (let i = 0; i < words.length; i++) {
    acc += (i ? " " : "") + words[i];
    if (i % 3 === 0 || i === words.length - 1) {
      updateMessage(messageId, { text: acc, trace: [...traces] });
      await sleep(22);
    }
  }
}

function matchCategory(text: string): Category | null {
  const t = text.toLowerCase();
  if (/(blood test|test result|results|lab|egfr|creatinine|hba1c|potassium|haemoglobin|cholesterol|liver|kidney)/.test(t)) return "lab_results";
  if (/(mood|mental|wellbeing|depress|sleep|anxious|anxiety)/.test(t)) return "mental_health";
  if (/(medic|pill|tablet|prescri|dose)/.test(t)) return "medications";
  if (/(appointment|clinic|coming up|next week|this week|calendar|when is|what.*next)/.test(t)) return "appointments";
  if (/(condition|diagnos|problem list|health problems)/.test(t)) return "conditions";
  if (/(care note|notes|consultation|what did the (doctor|gp|nurse) say)/.test(t)) return "care_notes";
  return null;
}

function matchPerson(text: string): string | null {
  const t = text.toLowerCase();
  for (const p of getState().people) {
    if (p.role === "patient" || p.role === "agent") continue;
    if (t.includes(p.shortName.toLowerCase()) || t.includes(p.name.toLowerCase())) return p.id;
  }
  return null;
}

export async function scriptedTurn(messageId: string, threadId: string, actorId: string, text: string) {
  const state = getState();
  const actor = personById(state, actorId);
  const patient = personById(state, state.patientId);
  const isPatient = actorId === state.patientId;
  const defs = toolsForActor(actorId);
  const traces: ToolTrace[] = [];
  const call = async (name: string, input: Record<string, unknown> = {}): Promise<ToolResult> => {
    const def = defs.find((d) => d.name === name);
    if (!def) return { ok: false, error: "not permitted", summary: "not permitted" };
    const r = await runTool(def, { actorId, threadId }, input);
    traces.push(r.trace);
    updateMessage(messageId, { trace: [...traces] });
    await sleep(300);
    return r.result;
  };
  const her = isPatient ? "your" : `${patient.shortName}'s`;
  const denied = (category: Category) => `${patient.shortName} hasn't shared her ${CATEGORIES.find((c) => c.id === category)!.label.toLowerCase()} with you, ${actor.shortName}, so I can't see them on your behalf — and I won't guess. If it would help, I can ask her: just say "please ask her".`;

  await sleep(300);
  const t = text.toLowerCase();
  const category = matchCategory(text);
  const person = matchPerson(text);
  let reply = "";

  const levelMatch = /(everything|practical|important (updates?|stuff|things)|only the big|just the important)/.exec(t);
  if (isPatient && person && levelMatch) {
    const level = /everything/.test(levelMatch[0]) ? "everything" : /practical/.test(levelMatch[0]) ? "practical" : "updates";
    const res = await call("set_sharing_level", { person: personById(state, person).shortName, level });
    const who = personById(state, person).shortName;
    const d = res.data as { level?: string; nowSees?: string[] } | undefined;
    reply = res.ok
      ? `Done, ${patient.shortName}. ${who} is now on “${d?.level}” and can see ${d?.nowSees?.length ? d.nowSees.join(", ").toLowerCase() : "nothing yet"}. ${state.patient.practice}'s record is updated too.`
      : `I couldn't make that change: ${res.error}`;
  } else if (isPatient && person && category && /(let|allow|share|give|show|can see|access|stop|don.?t|hide|remove|revoke|no longer)/.test(t)) {
    const allowed = !/(stop|don.?t|hide|remove|revoke|no longer|not)/.test(t);
    const res = await call("update_consent", { person: personById(state, person).shortName, category, allowed });
    const cat = CATEGORIES.find((c) => c.id === category)!.label.toLowerCase();
    const who = personById(state, person).shortName;
    reply = res.ok
      ? allowed
        ? `Done, ${patient.shortName}. ${who} can now see your ${cat}. I've written that to ${state.patient.practice}'s record too, so nobody there needs to ask you again. You can change it any time from your Circle.`
        : `Of course. ${who} can no longer see your ${cat}. That's updated at ${state.patient.practice} as well. Nothing else about what ${who} can see has changed.`
      : `I couldn't make that change: ${res.error}`;
  } else if (isPatient && /(who can see|who has access|what.*shar|my circle|consent)/.test(t)) {
    const res = await call("get_consent");
    const rows = (res.data as { person: string; canSee: string[] }[]) ?? [];
    reply = `Here's who can see what right now:\n\n${rows.map((r) => `• ${r.person}: ${r.canSee.length ? r.canSee.join(", ") : "nothing yet"}`).join("\n")}\n\nTell me if you'd like to change any of these.`;
  } else if (!isPatient && /(ask her|please ask|send.*request|request access)/.test(t)) {
    const lastDenied = state.audit.find((a) => a.kind === "consent.check" && a.actorId === actorId && a.ok === false);
    const cat = (lastDenied?.detail as { category?: Category } | undefined)?.category ?? "lab_results";
    const res = await call("request_access", { category: cat, reason: `${actor.shortName} would like to understand ${patient.shortName}'s ${CATEGORIES.find((c) => c.id === cat)!.label.toLowerCase()}.` });
    reply = res.ok ? `I've asked ${patient.shortName} to share her ${CATEGORIES.find((c) => c.id === cat)!.label.toLowerCase()} with you. She'll see it on her home screen and can approve it with one tap. Nothing is shared until she says yes.` : `I couldn't send that request: ${res.error}`;
  } else if (category === "appointments") {
    const res = await call("get_appointments");
    if (!res.ok) reply = denied("appointments");
    else {
      const appts = res.data as { title: string; when: string; location: string; with: string; purpose: string; prep: string[] }[];
      reply = appts.length
        ? appts.map((a) => `**${a.title}** — ${a.when}, ${a.location}, with ${a.with}.${a.purpose ? ` ${a.purpose}.` : ""}${a.prep.length ? `\nOn record: ${a.prep.join("; ")}.` : ""}`).join("\n\n")
        : `There's nothing booked for ${isPatient ? "you" : patient.shortName} in the record right now.`;
    }
  } else if (category === "lab_results") {
    const res = await call("get_lab_results");
    if (!res.ok) reply = denied("lab_results");
    else {
      const labs = res.data as LabResult[];
      const abnormal = labs.filter((l) => l.flag !== "normal");
      const latestDate = labs.map((l) => l.date).sort().pop();
      reply = `${her.charAt(0).toUpperCase() + her.slice(1)} most recent blood tests are from ${latestDate ? new Date(latestDate).toLocaleDateString("en-GB", { day: "numeric", month: "long" }) : "the record"}: ${labs.length} measurements across ${new Set(labs.map((l) => l.panel)).size} panels.\n\n` +
        (abnormal.length
          ? `Outside the reference range:\n${abnormal.map((l) => `• **${l.name} ${l.value} ${l.unit}** (range ${l.refRange}${l.previous ? `, was ${l.previous.value} in ${new Date(l.previous.date).toLocaleDateString("en-GB", { month: "short" })}` : ""}) — ${l.flag}`).join("\n")}\n\nEverything else is within range.`
          : `Everything is within its reference range.`) +
        `\n\nA result outside the range isn't a diagnosis on its own; the practice looks at the trend and the whole picture. Worth asking at the next appointment what, if anything, they'd like to do about the ones above.`;
    }
  } else if (category) {
    const res = await call("get_record_section", { section: category });
    if (!res.ok) reply = denied(category);
    else {
      const label = CATEGORIES.find((c) => c.id === category)!.label.toLowerCase();
      const items = res.data as Record<string, unknown>[];
      reply = items.length
        ? `${her.charAt(0).toUpperCase() + her.slice(1)} ${label} on record:\n\n${items.map((i) => `• ${[i.name ?? i.title, i.since ? `since ${i.since}` : null, i.purpose, i.text ?? i.detail].filter(Boolean).join(" — ")}`).join("\n")}`
        : `There are no ${label} recorded for ${isPatient ? "you" : patient.shortName} at the moment.`;
    }
  } else {
    reply = isPatient
      ? `Hello ${patient.shortName}. I can tell you what's coming up, explain your results, or change who in your circle can see what — for example "Who can see what?" or "Let ${state.people.find((p) => p.role === "family")?.shortName ?? "my daughter"} see my test results".`
      : `Hello ${actor.shortName}. I can help you keep up with ${patient.shortName}'s care — appointments, what's on record, and explaining anything she has chosen to share with you.`;
  }

  await typeOut(messageId, reply, traces);
  updateMessage(messageId, { text: reply, streaming: false, trace: traces });
}
