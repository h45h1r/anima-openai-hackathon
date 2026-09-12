// Scheduled "morning check": runs without any user message. Reads upcoming
// appointments from the live record and posts a consent-scoped reminder to
// the family group through the same tools the chat agent uses.

import Anthropic from "@anthropic-ai/sdk";
import { addAudit, getState, mutate } from "../store";
import { personById } from "../types";
import { proactivePrompt } from "./prompts";
import { openaiRun } from "./openai";
import { runTool, toAnthropicTools, TOOLS } from "./tools";

const WEEK_MS = 7 * 24 * 3600 * 1000;
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", timeZone: "Europe/London" });

export async function runProactiveCheck(): Promise<{ posted: number }> {
  const state = getState();
  const agentId = state.agentId;
  const nowMs = new Date(state.now).getTime();
  const due = state.appointments.filter((a) => {
    const t = new Date(a.start).getTime();
    return !a.announcedToFamily && t >= nowMs - 3600_000 && t - nowMs <= WEEK_MS;
  });
  addAudit({ kind: "agent.turn", actorId: agentId, summary: `Scheduled check: ${due.length} appointment(s) in the next 7 days not yet shared with family`, detail: { model: state.agentModel } });
  if (due.length === 0) return { posted: 0 };

  const agentTools = TOOLS.filter((t) => t.allowedRoles.includes("agent"));
  const ctx = { actorId: agentId, threadId: "family-group" };
  let posted = 0;

  if (state.agentMode === "openai") {
    const r = await openaiRun(proactivePrompt(state), "Run the scheduled check now.", agentTools, ctx);
    posted = r.toolCalls.filter((n) => n === "post_to_family_group").length;
  } else if (state.agentMode === "claude") {
    const client = new Anthropic();
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: "Run the scheduled check now." }];
    for (let i = 0; i < 6; i++) {
      const res = await client.messages.create({ model: state.agentModel, max_tokens: 4000, system: proactivePrompt(state), tools: toAnthropicTools(agentTools), messages, thinking: { type: "adaptive" }, output_config: { effort: "medium" } });
      const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (res.stop_reason !== "tool_use" || uses.length === 0) break;
      messages.push({ role: "assistant", content: res.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const u of uses) {
        const def = agentTools.find((d) => d.name === u.name)!;
        const r = await runTool(def, ctx, u.input as Record<string, unknown>);
        if (u.name === "post_to_family_group" && r.result.ok) posted++;
        results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(r.result.ok ? r.result.data : { error: r.result.error }), is_error: !r.result.ok });
      }
      messages.push({ role: "user", content: results });
    }
  } else {
    // Template from live data — no model available.
    const post = agentTools.find((t) => t.name === "post_to_family_group")!;
    await runTool(agentTools.find((t) => t.name === "get_appointments")!, ctx, {});
    const patient = personById(state, state.patientId);
    for (const a of due) {
      const clinician = personById(state, a.clinicianId);
      const text = `Heads-up: ${patient.shortName}'s ${a.title.toLowerCase()} is on ${fmtDay(a.start)} at ${fmtTime(a.start)}, ${a.location}, with ${clinician.name}${a.mode ? ` (${a.mode})` : ""}.${a.purpose ? `\n\nReason: ${a.purpose}.` : ""}${a.prep.length ? `\n\nOn record: ${a.prep.map((p) => p.charAt(0).toLowerCase() + p.slice(1)).join("; ")}.` : ""}\n\nCould someone go with her? Reply here so we know who.`;
      const r = await runTool(post, ctx, { text, category: "appointments" });
      if (r.result.ok) posted++;
    }
  }

  mutate((d) => {
    d.appointments = d.appointments.map((a) => (due.some((x) => x.id === a.id) ? { ...a, announcedToFamily: true } : a));
    for (const a of due) {
      const id = `act-lift-${a.id}`;
      if (!d.nextActions.some((n) => n.id === id)) d.nextActions = [{ id, text: `Arrange to accompany ${personById(d, d.patientId).shortName} to ${a.title.toLowerCase()} on ${fmtDay(a.start).split(",")[0]} ${new Date(a.start).getDate()} ${new Date(a.start).toLocaleDateString("en-GB", { month: "short" })}`, due: a.start.slice(0, 10), owner: "family", done: false, source: "Kindred" }, ...d.nextActions];
    }
  });
  return { posted };
}
