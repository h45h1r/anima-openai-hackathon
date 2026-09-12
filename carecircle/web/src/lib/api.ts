const API_BASE = import.meta.env.VITE_API_BASE || '';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  opts: RequestInit & { sessionId?: string | null } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (opts.sessionId) headers['x-carecircle-session'] = opts.sessionId;
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg =
      typeof body === 'object' && body && 'message' in body
        ? String((body as { message: string }).message)
        : `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, body);
  }
  return body as T;
}

export type AskWsEvent =
  | { type: 'status'; message: string }
  | { type: 'tool'; tool: string; status: 'ok' | 'error' | 'skipped'; detail?: string }
  | { type: 'token'; text: string }
  | {
      type: 'final';
      run: any;
      memoriesUsed?: { id: string; kind: string; text: string }[];
      memoriesWritten?: { id: string; kind: string; text: string }[];
      suggestions?: string[];
    }
  | { type: 'error'; message: string; code?: string };

function wsUrl(path: string): string {
  if (API_BASE) {
    const base = API_BASE.replace(/^http/, 'ws');
    return `${base.replace(/\/$/, '')}${path}`;
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${path}`;
}

/** Prefer WebSocket streaming; throw to let caller fall back to REST. */
export function askViaWebSocket(
  input: {
    sessionId: string;
    patientId: string;
    viewerId: string;
    question: string;
  },
  onEvent: (event: AskWsEvent) => void,
): Promise<{ run: any; suggestions?: string[] }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const url = `${wsUrl('/ws/ask')}?sessionId=${encodeURIComponent(input.sessionId)}`;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (err) {
      reject(err);
      return;
    }

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      reject(err);
    };

    const timer = window.setTimeout(() => fail(new Error('WebSocket ask timed out')), 90000);

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          type: 'ask',
          sessionId: input.sessionId,
          patientId: input.patientId,
          viewerId: input.viewerId,
          question: input.question,
        }),
      );
    };

    socket.onerror = () => fail(new Error('WebSocket connection failed'));
    socket.onclose = () => {
      if (!settled) fail(new Error('WebSocket closed before final answer'));
    };

    socket.onmessage = (ev) => {
      try {
        const event = JSON.parse(String(ev.data)) as AskWsEvent;
        onEvent(event);
        if (event.type === 'error') {
          window.clearTimeout(timer);
          fail(new Error(event.message));
          return;
        }
        if (event.type === 'final') {
          window.clearTimeout(timer);
          settled = true;
          socket.close();
          resolve({ run: event.run, suggestions: event.suggestions });
        }
      } catch (err) {
        window.clearTimeout(timer);
        fail(err instanceof Error ? err : new Error('Bad WebSocket payload'));
      }
    };
  });
}
