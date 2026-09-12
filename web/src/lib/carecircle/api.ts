/** Browser client for the CareCircle Express clinical API (proxied via /care-api). */

const API_BASE = process.env.NEXT_PUBLIC_CARE_API_BASE || "/care-api";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class AskClientError extends Error {
  constructor(
    message: string,
    public code?: string,
    public transport: "sse" | "rest" = "sse",
  ) {
    super(message);
    this.name = "AskClientError";
  }
}

export function isTransportFailure(err: unknown): boolean {
  if (err instanceof AskClientError) {
    return !err.code || err.code === "transport";
  }
  if (!(err instanceof Error)) return true;
  return /SSE|timed out|closed before|connection failed|Failed to fetch|NetworkError|stream/i.test(err.message);
}

export async function careApi<T>(
  path: string,
  opts: RequestInit & { sessionId?: string | null } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(opts.body ? { "Content-Type": "application/json" } : {}),
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (opts.sessionId) headers["x-carecircle-session"] = opts.sessionId;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  } catch {
    throw new ApiError("Clinical Ask server unreachable — start CareCircle API on :8787.", 503, null, "unavailable");
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const obj = typeof body === "object" && body ? (body as Record<string, unknown>) : null;
    const msg =
      (obj && typeof obj.message === "string" && obj.message) ||
      (obj && typeof obj.error === "string" ? humanizeCode(String(obj.error)) : null) ||
      `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, body, obj && typeof obj.error === "string" ? obj.error : undefined);
  }
  return body as T;
}

function humanizeCode(code: string): string {
  const map: Record<string, string> = {
    missing_session: "Connect the clinical Ask server first.",
    disconnected: "Not connected — restart CareCircle API (:8787).",
    unauthorized: "Permission denied — check ANIMA_API_KEY in carecircle/.env.",
    missing_key: "No Anima key — set ANIMA_API_KEY in carecircle/.env.",
    forbidden: "Permission denied for this Anima action.",
    not_found: "Patient or resource not found.",
    patient_not_in_world: "This Kindred patient was not found in the CareCircle Anima world.",
    patient_mismatch: "Selected patient does not match this request.",
    viewer_mismatch: "Wrong viewer for this Ask session.",
    question_required: "Enter a question before asking.",
    no_patient: "Select a patient first.",
    unknown_viewer: "Unknown viewer for clinical Ask.",
    unavailable: "Clinical Ask server unreachable — start CareCircle API on :8787.",
    internal: "Something went wrong in clinical Ask — retry.",
  };
  return map[code] || `Request failed (${code})`;
}

export type AskStreamEvent =
  | { type: "status"; message: string }
  | { type: "tool"; tool: string; status: "ok" | "error" | "skipped"; detail?: string }
  | { type: "stream_reset" }
  | { type: "token"; text: string }
  | {
      type: "final";
      run: any;
      memoriesUsed?: { id: string; kind: string; text: string }[];
      memoriesWritten?: { id: string; kind: string; text: string }[];
      suggestions?: string[];
    }
  | { type: "error"; message: string; code?: string };

export async function askViaSse(
  input: {
    sessionId: string;
    patientId: string;
    viewerId: string;
    question: string;
    history?: { role: "user" | "assistant"; content: string }[];
  },
  onEvent: (event: AskStreamEvent) => void,
): Promise<{ run: any; suggestions?: string[] }> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 90000);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/ask/stream`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
        "x-carecircle-session": input.sessionId,
      },
      body: JSON.stringify({
        patientId: input.patientId,
        viewerId: input.viewerId,
        question: input.question,
        history: input.history || [],
      }),
    });
  } catch (err) {
    window.clearTimeout(timer);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("SSE ask timed out");
    }
    throw new Error("SSE connection failed");
  }

  if (!res.ok || !res.body) {
    window.clearTimeout(timer);
    const text = await res.text().catch(() => "");
    try {
      const j = JSON.parse(text) as { error?: string; message?: string };
      throw new AskClientError(j.message || humanizeCode(j.error || "internal"), j.error, "sse");
    } catch (e) {
      if (e instanceof AskClientError) throw e;
      throw new Error(`SSE ask failed (${res.status})`);
    }
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let settled = false;
  let finalResult: { run: any; suggestions?: string[] } | null = null;

  const consumeDataLine = (data: string) => {
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data) as AskStreamEvent;
    onEvent(event);
    if (event.type === "error") {
      settled = true;
      throw new AskClientError(event.message || humanizeCode(event.code || "internal"), event.code, "sse");
    }
    if (event.type === "final") {
      settled = true;
      finalResult = { run: event.run, suggestions: event.suggestions };
    }
  };

  try {
    while (!settled) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n");
      buffer = parts.pop() || "";
      let dataLines: string[] = [];
      for (const rawLine of parts) {
        const line = rawLine.replace(/\r$/, "");
        if (line.startsWith(":")) continue;
        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
          continue;
        }
        if (line === "" && dataLines.length) {
          consumeDataLine(dataLines.join("\n"));
          dataLines = [];
          if (settled) break;
        }
      }
    }
    if (!settled && buffer.trim()) {
      for (const rawLine of buffer.split("\n")) {
        const line = rawLine.replace(/\r$/, "");
        if (line.startsWith("data:")) {
          consumeDataLine(line.slice(5).trimStart());
        }
      }
    }
  } catch (err) {
    window.clearTimeout(timer);
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
    throw err;
  }

  window.clearTimeout(timer);
  try {
    await reader.cancel();
  } catch {
    /* ignore */
  }

  if (!finalResult) {
    throw new Error("SSE closed before final answer");
  }
  return finalResult;
}
