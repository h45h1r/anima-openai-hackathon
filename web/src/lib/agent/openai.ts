// OpenAI runtime: Responses API, streaming, function tools, reasoning effort.
// Model and effort from env (AGENT_MODEL, AGENT_REASONING); defaults
// gpt-5.6-sol / medium.

import OpenAI from "openai";
import { getState, updateMessage } from "../store";
import type { ToolTrace } from "../types";
import { systemPrompt } from "./prompts";
import { runTool, toolsForActor, type ToolDef, type ToolResult } from "./tools";

export const OPENAI_MODEL = process.env.AGENT_MODEL ?? "gpt-5.6-sol";
export const OPENAI_EFFORT = (process.env.AGENT_REASONING ?? "medium") as OpenAI.ReasoningEffort;

export function toOpenAITools(defs: ToolDef[]): OpenAI.Responses.FunctionTool[] {
  return defs.map((d) => ({ type: "function", name: d.name, description: d.description, parameters: d.input_schema as Record<string, unknown>, strict: false }));
}

function historyFor(threadId: string, agentId: string, limit = 16): OpenAI.Responses.ResponseInputItem[] {
  const msgs = getState().messages.filter((m) => m.threadId === threadId && !m.streaming && m.kind === "chat");
  return msgs.slice(-limit).map((m) => ({ role: m.senderId === agentId ? "assistant" : "user", content: m.text }) as OpenAI.Responses.EasyInputMessage);
}

export async function openaiTurn(messageId: string, threadId: string, actorId: string, text: string) {
  const client = new OpenAI();
  const state = getState();
  const defs = toolsForActor(actorId);
  const tools = toOpenAITools(defs);
  const instructions = systemPrompt(state, actorId);

  let input: OpenAI.Responses.ResponseInputItem[] = historyFor(threadId, state.agentId);
  const last = input[input.length - 1] as OpenAI.Responses.EasyInputMessage | undefined;
  if (!last || last.role !== "user") input.push({ role: "user", content: text });

  const traces: ToolTrace[] = [];
  let finalText = "";
  let previousResponseId: string | undefined;

  for (let iter = 0; iter < 8; iter++) {
    let iterText = "";
    const stream = await client.responses.create({
      model: OPENAI_MODEL, service_tier: "priority",
      instructions,
      input,
      tools,
      reasoning: { effort: OPENAI_EFFORT },
      previous_response_id: previousResponseId,
      stream: true,
    });

    let response: OpenAI.Responses.Response | undefined;
    for await (const ev of stream) {
      if (ev.type === "response.output_text.delta") {
        iterText += ev.delta;
        updateMessage(messageId, { text: (finalText ? finalText + "\n\n" : "") + iterText, trace: [...traces] });
      } else if (ev.type === "response.completed") {
        response = ev.response;
      } else if (ev.type === "response.failed") {
        throw new Error(ev.response.error?.message ?? "response failed");
      } else if (ev.type === "error") {
        throw new Error(ev.message);
      }
    }
    if (!response) throw new Error("stream ended without a completed response");
    if (iterText.trim()) finalText = finalText ? `${finalText}\n\n${iterText}` : iterText;

    const calls = response.output.filter((o): o is OpenAI.Responses.ResponseFunctionToolCall => o.type === "function_call");
    if (calls.length === 0) break;

    previousResponseId = response.id;
    input = [];
    for (const call of calls) {
      const def = defs.find((d) => d.name === call.name);
      let parsed: Record<string, unknown> = {};
      try {
        parsed = call.arguments ? (JSON.parse(call.arguments) as Record<string, unknown>) : {};
      } catch {
        parsed = {};
      }
      let result: ToolResult;
      if (!def) {
        result = { ok: false, error: `Unknown tool ${call.name}`, summary: "unknown tool" };
        traces.push({ name: call.name, input: parsed, summary: "unknown tool", ok: false, ms: 0 });
      } else {
        const r = await runTool(def, { actorId, threadId }, parsed);
        result = r.result;
        traces.push(r.trace);
      }
      updateMessage(messageId, { trace: [...traces] });
      input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result.ok ? result.data : { error: result.error }) });
    }
  }

  updateMessage(messageId, { text: finalText.trim() || "(no reply)", streaming: false, trace: traces });
}

/** Non-streaming agentic loop used by the scheduled check. Returns tool names called. */
export async function openaiRun(instructions: string, userText: string, defs: ToolDef[], ctx: { actorId: string; threadId: string }): Promise<{ toolCalls: string[]; text: string }> {
  const client = new OpenAI();
  const tools = toOpenAITools(defs);
  let input: OpenAI.Responses.ResponseInputItem[] = [{ role: "user", content: userText }];
  let previousResponseId: string | undefined;
  const toolCalls: string[] = [];
  let text = "";
  for (let i = 0; i < 8; i++) {
    const res = await client.responses.create({ model: OPENAI_MODEL, service_tier: "priority", instructions, input, tools, reasoning: { effort: OPENAI_EFFORT }, previous_response_id: previousResponseId });
    text = res.output_text ?? text;
    const calls = res.output.filter((o): o is OpenAI.Responses.ResponseFunctionToolCall => o.type === "function_call");
    if (calls.length === 0) break;
    previousResponseId = res.id;
    input = [];
    for (const call of calls) {
      const def = defs.find((d) => d.name === call.name);
      let parsed: Record<string, unknown> = {};
      try {
        parsed = call.arguments ? (JSON.parse(call.arguments) as Record<string, unknown>) : {};
      } catch {
        /* keep {} */
      }
      const r = def ? await runTool(def, ctx, parsed) : { result: { ok: false, error: `Unknown tool ${call.name}`, summary: "unknown tool" } as ToolResult };
      toolCalls.push(call.name);
      input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(r.result.ok ? r.result.data : { error: r.result.error }) });
    }
  }
  return { toolCalls, text };
}
