import { chatId } from '../chat-ids';
// Agent tools. Defined provider-neutrally (name + description + JSON schema +
// handler) so the same definitions can be registered with the Anthropic SDK
// today and with the mycontinuum ADK / an MCP server later.
//
// CONSENT IS ENFORCED HERE, not in the prompt. A tool called on behalf of a
// family member returns "not shared" if the patient hasn't consented, and the
// check is written to the audit trail.

import type Anthropic from "@anthropic-ai/sdk";
import { CATEGORIES, personById, type Category, type ConsentCheck, type ToolTrace } from "../types";
import { addAudit, addMessage, checkConsent, getState, mutate, newId, nowIso, setConsent, setSharingLevel } from "../store";
import { LEVELS, allowedCategories, levelFor, levelLabel } from "../levels";
import type { SharingLevel } from "../types";

export interface ToolContext {
  actorId: string; // who the agent is acting on behalf of
  threadId: string;
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  summary: string;
  consentCheck?: ConsentCheck;
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Anthropic.Tool.InputSchema;
  /** Which actors may call this tool at all (role-based). */
  allowedRoles: Array<"patient" | "family" | "carer" | "clinician" | "agent">;
  handler: (ctx: ToolContext, input: Record<string, unknown>) => Promise<ToolResult>;
}

const CATEGORY_ENUM = CATEGORIES.map((c) => c.id);

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}

function denied(check: ConsentCheck, actorId: string): ToolResult {
  const state = getState();
  const actor = personById(state, actorId);
  const cat = CATEGORIES.find((c) => c.id === check.category)!;
  return {
    ok: false,
    consentCheck: check,
    error: `NOT_SHARED: ${personById(state, state.patientId).shortName} has not shared "${cat.label}" with ${actor.shortName}. Do not reveal or guess this information. You may offer to send ${personById(state, state.patientId).shortName} a request using request_access.`,
    summary: `${cat.label}: not shared with ${actor.shortName}`,
  };
}

function resolvePerson(nameOrId: string): string | null {
  const state = getState();
  const q = nameOrId.trim().toLowerCase();
  const hit = state.people.find(
    (p) => p.id === q || p.name.toLowerCase() === q || p.shortName.toLowerCase() === q || p.name.toLowerCase().split(" ")[0] === q,
  );
  return hit?.id ?? null;
}

export const TOOLS: ToolDef[] = [
  {
    name: "get_appointments",
    description: "List the patient's upcoming appointments with date, time, place, purpose and what to bring or prepare.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    allowedRoles: ["patient", "family", "carer", "clinician", "agent"],
    async handler(ctx) {
      const check = checkConsent(ctx.actorId, "appointments");
      if (!check.allowed) return denied(check, ctx.actorId);
      const state = getState();
      const data = state.appointments
        .filter((a) => new Date(a.start) >= new Date(state.now))
        .sort((a, b) => a.start.localeCompare(b.start))
        .map((a) => ({
          id: a.id,
          title: a.title,
          when: fmtDate(a.start),
          start: a.start,
          location: a.location,
          with: personById(state, a.clinicianId).name,
          purpose: a.purpose,
          prep: a.prep,
        }));
      return { ok: true, data, consentCheck: check, summary: `${data.length} upcoming appointment(s)` };
    },
  },
  {
    name: "get_lab_results",
    description: "Get the patient's recent blood and urine test results, with reference ranges, previous values and a plain-language note for each.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    allowedRoles: ["patient", "family", "carer", "clinician", "agent"],
    async handler(ctx) {
      const check = checkConsent(ctx.actorId, "lab_results");
      if (!check.allowed) return denied(check, ctx.actorId);
      const state = getState();
      return { ok: true, data: state.labs, consentCheck: check, summary: `${state.labs.length} results from ${state.labs[0]?.date}` };
    },
  },
  {
    name: "get_record_section",
    description: "Read one section of the patient's health record: medications, conditions, care_notes or mental_health.",
    input_schema: {
      type: "object",
      properties: {
        section: { type: "string", enum: ["medications", "conditions", "care_notes", "mental_health"] },
      },
      required: ["section"],
      additionalProperties: false,
    },
    allowedRoles: ["patient", "family", "carer", "clinician", "agent"],
    async handler(ctx, input) {
      const section = input.section as Category;
      const check = checkConsent(ctx.actorId, section);
      if (!check.allowed) return denied(check, ctx.actorId);
      const state = getState();
      const data =
        section === "medications"
          ? state.medications
          : section === "conditions"
            ? state.conditions
            : section === "care_notes"
              ? state.careNotes.map((n) => ({ ...n, author: state.people.find((p) => p.id === n.authorId)?.name ?? "Practice" }))
              : state.mentalHealth;
      return { ok: true, data, consentCheck: check, summary: `${section}: ${Array.isArray(data) ? data.length : 1} item(s)` };
    },
  },
  {
    name: "get_next_actions",
    description: "List the outstanding next actions on the patient's care plan (things to do before appointments, tests to book).",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    allowedRoles: ["patient", "family", "carer", "clinician", "agent"],
    async handler(ctx) {
      const check = checkConsent(ctx.actorId, "appointments");
      if (!check.allowed) return denied(check, ctx.actorId);
      const data = getState().nextActions.filter((a) => !a.done);
      return { ok: true, data, consentCheck: check, summary: `${data.length} open action(s)` };
    },
  },
  {
    name: "get_consent",
    description: "Show who currently has access to which parts of the patient's record. Patient only.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    allowedRoles: ["patient"],
    async handler() {
      const state = getState();
      const data = {
        levels: LEVELS.map((l) => ({ level: l.id, label: l.label, means: CATEGORIES.filter((c) => state.levels[l.id].includes(c.id)).map((c) => c.label) })),
        people: Object.entries(state.consent)
          .filter(([id]) => personById(state, id).accessStatus !== "revoked")
          .map(([id, scopes]) => ({
            person: personById(state, id).name,
            relation: personById(state, id).relation,
            level: levelLabel(levelFor(state.levels, scopes)),
            canSee: CATEGORIES.filter((c) => scopes[c.id]).map((c) => c.label),
            cannotSee: CATEGORIES.filter((c) => !scopes[c.id]).map((c) => c.label),
          })),
      };
      return { ok: true, data, summary: `consent v${state.ehr.consentVersion}` };
    },
  },
  {
    name: "set_sharing_level",
    description:
      "Put a family member, carer or clinician on one of the patient's three sharing levels: everything, practical (only practical, day-to-day help) or updates (important updates only). Patient only. Prefer this when the patient talks in terms of how much to share; use update_consent for a single category. Synced to the EHR immediately.",
    input_schema: {
      type: "object",
      properties: {
        person: { type: "string", description: "Name of the family member, carer or clinician" },
        level: { type: "string", enum: ["everything", "practical", "updates"] },
      },
      required: ["person", "level"],
      additionalProperties: false,
    },
    allowedRoles: ["patient"],
    async handler(ctx, input) {
      const granteeId = resolvePerson(String(input.person));
      if (!granteeId) return { ok: false, error: `Unknown person "${input.person}"`, summary: "unknown person" };
      const state = getState();
      if (granteeId === state.patientId) return { ok: false, error: "Cannot change sharing for the patient themself", summary: "invalid" };
      const level = input.level as SharingLevel;
      const res = await setSharingLevel({ granteeId, level, actorId: ctx.actorId, via: "agent" });
      const after = getState();
      const grantee = personById(after, granteeId);
      const label = LEVELS.find((l) => l.id === level)!.label;
      return {
        ok: true,
        data: { person: grantee.name, level: label, nowSees: CATEGORIES.filter((c) => allowedCategories(after.consent[granteeId]).includes(c.id)).map((c) => c.label), changed: res.changed, consentVersion: after.ehr.consentVersion, ehrSynced: true },
        summary: `${grantee.shortName} → ${label}${res.changed ? "" : " (no change)"}`,
      };
    },
  },
  {
    name: "update_consent",
    description:
      "Change who can see a part of the patient's record. Patient only. Changes take effect immediately and are synced to the EHR. Use the person's first name (Sarah, Tom, Priya, Dr Patel...) and a category.",
    input_schema: {
      type: "object",
      properties: {
        person: { type: "string", description: "Name of the family member, carer or clinician" },
        category: { type: "string", enum: CATEGORY_ENUM },
        allowed: { type: "boolean", description: "true to share, false to stop sharing" },
      },
      required: ["person", "category", "allowed"],
      additionalProperties: false,
    },
    allowedRoles: ["patient"],
    async handler(ctx, input) {
      const granteeId = resolvePerson(String(input.person));
      if (!granteeId) return { ok: false, error: `Unknown person "${input.person}"`, summary: "unknown person" };
      const state = getState();
      if (granteeId === state.patientId) return { ok: false, error: "Cannot change consent for the patient themself", summary: "invalid" };
      const category = input.category as Category;
      const allowed = Boolean(input.allowed);
      const res = await setConsent({ granteeId, category, allowed, actorId: ctx.actorId, via: "agent" });
      const grantee = personById(getState(), granteeId);
      const cat = CATEGORIES.find((c) => c.id === category)!;
      return {
        ok: true,
        data: { person: grantee.name, category: cat.label, allowed, changed: res.changed, consentVersion: getState().ehr.consentVersion, ehrSynced: true },
        summary: `${allowed ? "share" : "stop sharing"} ${cat.label} → ${grantee.shortName}${res.changed ? "" : " (no change)"}`,
      };
    },
  },
  {
    name: "request_access",
    description:
      "On behalf of a family member or carer, ask the patient to share a category they cannot currently see. The patient gets a card to approve or decline. Use only after a NOT_SHARED result and only if the user wants to ask.",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", enum: CATEGORY_ENUM },
        reason: { type: "string", description: "One short sentence the patient will see" },
      },
      required: ["category", "reason"],
      additionalProperties: false,
    },
    allowedRoles: ["family", "carer"],
    async handler(ctx, input) {
      const category = input.category as Category;
      const state = getState();
      const existing = state.consentRequests.find((r) => r.requesterId === ctx.actorId && r.category === category && r.status === "pending");
      if (existing) return { ok: true, data: existing, summary: "request already pending" };
      const req = { id: newId("req"), requesterId: ctx.actorId, category, reason: String(input.reason), status: "pending" as const, createdAt: nowIso() };
      mutate((d) => {
        d.consentRequests = [...d.consentRequests, req];
      });
      const requester = personById(state, ctx.actorId);
      const cat = CATEGORIES.find((c) => c.id === category)!;
      addAudit({ kind: "consent.request", actorId: ctx.actorId, summary: `${requester.shortName} asked to see ${cat.label}`, detail: req, ok: true });
      addMessage({
        threadId: chatId(state.patient.simId, `${state.patientId}-kindred`),
        senderId: state.agentId,
        kind: "notification",
        text: `${requester.shortName} has asked to see your ${cat.label.toLowerCase()}. Reason: "${req.reason}". You can approve or decline from your home screen — nothing is shared until you do.`,
      });
      return { ok: true, data: req, summary: `asked ${personById(state, state.patientId).shortName} to share ${cat.label}` };
    },
  },
  {
    name: "post_to_family_group",
    description:
      "Post a message from Kindred into the family group. Only members who have consent to the relevant category will see it. Used for proactive reminders.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string" },
        category: { type: "string", enum: CATEGORY_ENUM, description: "Which category the message reveals; determines who can see it" },
      },
      required: ["text", "category"],
      additionalProperties: false,
    },
    allowedRoles: ["agent"],
    async handler(ctx, input) {
      const state = getState();
      const category = input.category as Category;
      const group = state.threads[chatId(state.patient.simId, 'family-group')];
      const audience = group.memberIds.filter((id) => id !== state.agentId && (id === state.patientId || state.consent[id]?.[category]));
      const excluded = group.memberIds.filter((id) => id !== state.agentId && !audience.includes(id));
      for (const id of group.memberIds) {
        if (id !== state.agentId && id !== state.patientId) checkConsent(id, category);
      }
      const msg = addMessage({ threadId: group.id, senderId: state.agentId, kind: "notification", text: String(input.text), audience });
      addAudit({
        kind: "notification.sent",
        actorId: state.agentId,
        summary: `Family group: delivered to ${audience.map((id) => personById(state, id).shortName).join(", ")}${excluded.length ? ` · withheld from ${excluded.map((id) => personById(state, id).shortName).join(", ")}` : ""}`,
        detail: { messageId: msg.id, audience, excluded, category },
        ok: true,
      });
      return { ok: true, data: { delivered: audience, withheld: excluded }, summary: `posted to ${audience.length} member(s)` };
    },
  },
];

export function toolsForActor(actorId: string): ToolDef[] {
  const state = getState();
  const role = personById(state, actorId).role;
  return TOOLS.filter((t) => t.allowedRoles.includes(role));
}

export function toAnthropicTools(defs: ToolDef[]): Anthropic.Tool[] {
  return defs.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
}

/** Execute a tool, audit it, and return both the result and a UI trace entry. */
export async function runTool(def: ToolDef, ctx: ToolContext, input: Record<string, unknown>): Promise<{ result: ToolResult; trace: ToolTrace }> {
  const t0 = Date.now();
  let result: ToolResult;
  try {
    result = await def.handler(ctx, input);
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e), summary: "error" };
  }
  const trace: ToolTrace = { name: def.name, input, summary: result.summary, ok: result.ok, consentCheck: result.consentCheck, ms: Date.now() - t0 };
  addAudit({
    kind: "tool.call",
    actorId: ctx.actorId,
    summary: `${def.name} · ${result.summary}`,
    detail: { input, ok: result.ok, error: result.error, consentCheck: result.consentCheck },
    ok: result.ok,
  });
  return { result, trace };
}
