// OpenAI chat uses the shared Anima ADK consent harness.
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { getState, addMessage, updateMessage, setThreadBusy, addAudit } from "../store";
import { personById, type Message, type ToolTrace } from "../types";
import { systemPrompt } from "./prompts";
import { runTool, toAnthropicTools, toolsForActor, type ToolDef, type ToolResult } from "./tools";
import { scriptedTurn } from "./scripted";
import { adkTurn } from "./adk";

export interface TurnOpts {
  threadId: string;
  actorId: string;
  text: string;
}

export async function agentTurn(opts: TurnOpts): Promise<Message> {
  const state = getState();
  const { threadId, actorId, text } = opts;
  addMessage({ threadId, senderId: actorId, text, kind: "chat" });
  const placeholder = addMessage({ threadId, senderId: state.agentId, text: "", kind: "chat", streaming: true, trace: [], audience: [actorId] });
  setThreadBusy(threadId, true);
  addAudit({ kind: "agent.turn", actorId, summary: `${personById(state, actorId).shortName} asked Kindred: “${text.slice(0, 80)}${text.length > 80 ? "…" : ""}”`, detail: { model: state.agentModel } });

  try {
    if (state.agentMode === "openai") await adkTurn(placeholder.id, threadId, actorId, text);
    else if (state.agentMode === "claude") await claudeTurn(placeholder.id, threadId, actorId, text);
    else await scriptedTurn(placeholder.id, threadId, actorId, text);
  } catch (e) {
    const msg =
      e instanceof OpenAI.APIError
        ? `Kindred hit an OpenAI error (${e.status}): ${e.message}`
        : e instanceof Anthropic.APIError
          ? `Kindred hit an Anthropic error (${e.status}): ${e.message}`
          : `Kindred hit an error: ${e instanceof Error ? e.message : String(e)}`;
    updateMessage(placeholder.id, { text: msg, streaming: false });
    addAudit({ kind: "system", actorId: state.agentId, summary: msg, ok: false });
  } finally {
    setThreadBusy(threadId, false);
  }
  return getState().messages.find((m) => m.id === placeholder.id)!;
}

function historyFor(threadId: string, agentId: string, limit = 16): Anthropic.MessageParam[] {
  const msgs = getState().messages.filter((m) => m.threadId === threadId && !m.streaming && m.kind === "chat");
  return msgs.slice(-limit).map((m) => ({ role: m.senderId === agentId ? "assistant" : "user", content: m.text }));
}

async function claudeTurn(messageId: string, threadId: string, actorId: string, text: string) {
  const client = new Anthropic();
  const state = getState();
  const defs = toolsForActor(actorId);
  const tools = toAnthropicTools(defs);
  const system = systemPrompt(state, actorId);
  const messages: Anthropic.MessageParam[] = historyFor(threadId, state.agentId);
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") messages.push({ role: "user", content: text });

  const traces: ToolTrace[] = [];
  let finalText = "";
  for (let iter = 0; iter < 8; iter++) {
    let iterText = "";
    const stream = client.messages.stream({
      model: state.agentModel,
      max_tokens: 8000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools,
      messages,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
    });
    stream.on("text", (delta) => {
      iterText += delta;
      updateMessage(messageId, { text: (finalText ? finalText + "\n\n" : "") + iterText, trace: [...traces] });
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") {
      finalText = "I can't help with that one. If it's about care, try asking in a different way.";
      break;
    }
    if (iterText.trim()) finalText = finalText ? `${finalText}\n\n${iterText}` : iterText;
    const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (message.stop_reason !== "tool_use" || toolUses.length === 0) break;
    messages.push({ role: "assistant", content: message.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const def = defs.find((d) => d.name === tu.name);
      let result: ToolResult;
      if (!def) {
        result = { ok: false, error: `Unknown tool ${tu.name}`, summary: "unknown tool" };
        traces.push({ name: tu.name, input: tu.input, summary: "unknown tool", ok: false, ms: 0 });
      } else {
        const r = await runTool(def, { actorId, threadId }, tu.input as Record<string, unknown>);
        result = r.result;
        traces.push(r.trace);
      }
      updateMessage(messageId, { trace: [...traces] });
      results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result.ok ? result.data : { error: result.error }), is_error: !result.ok });
    }
    messages.push({ role: "user", content: results });
  }
  updateMessage(messageId, { text: finalText.trim() || "(no reply)", streaming: false, trace: traces });
}

export { runTool };
export type { ToolDef };
