const API_BASE = import.meta.env.VITE_API_BASE || '';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
    public code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Semantic Ask/WS failures should not trigger REST fallback. */
export class AskClientError extends Error {
  constructor(
    message: string,
    public code?: string,
    public transport: 'ws' | 'rest' = 'ws',
  ) {
    super(message);
    this.name = 'AskClientError';
  }
}

export function isTransportFailure(err: unknown): boolean {
  if (err instanceof AskClientError) {
    return !err.code || err.code === 'transport';
  }
  if (!(err instanceof Error)) return true;
  return /WebSocket|timed out|closed before|connection failed|Failed to fetch|NetworkError/i.test(err.message);
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
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  } catch {
    throw new ApiError('Anima unreachable — retry.', 503, null, 'unavailable');
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const obj = typeof body === 'object' && body ? (body as Record<string, unknown>) : null;
    const msg =
      (obj && typeof obj.message === 'string' && obj.message) ||
      (obj && typeof obj.error === 'string' ? humanizeCode(String(obj.error)) : null) ||
      `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, body, obj && typeof obj.error === 'string' ? obj.error : undefined);
  }
  return body as T;
}

function humanizeCode(code: string): string {
  const map: Record<string, string> = {
    missing_session: 'Connect to Anima first.',
    disconnected: 'Not connected — reconnect to Anima.',
    unauthorized: 'Permission denied — check your Anima API key.',
    forbidden: 'Permission denied for this Anima action.',
    not_found: 'Patient or resource not found in live Anima.',
    patient_not_in_world: 'Patient not found in live Anima search. Return to search.',
    patient_mismatch: 'Selected patient does not match this request.',
    viewer_mismatch: 'Wrong viewer — use the viewer switcher (identity claims are ignored).',
    question_required: 'Enter a question before asking.',
    no_patient: 'Select a patient first.',
    unknown_viewer: 'Unknown viewer for this CareCircle.',
    only_patient_may_edit_consent: 'Consent blocks this — only the patient viewer can edit access.',
    consent_conflict: 'Consent update conflict — refresh and try again.',
    unavailable: 'Anima unreachable — retry.',
    booking_not_submitted: 'Booking not submitted (API limitation or rejected slot).',
    internal: 'Something went wrong in CareCircle — retry.',
  };
  return map[code] || `Request failed (${code})`;
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

/** Prefer WebSocket streaming; throw AskClientError for semantic failures, Error for transport. */
export function askViaWebSocket(
  input: {
    sessionId: string;
    patientId: string;
    viewerId: string;
    question: string;
    history?: { role: 'user' | 'assistant'; content: string }[];
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
          history: input.history || [],
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
          fail(new AskClientError(event.message || humanizeCode(event.code || 'internal'), event.code, 'ws'));
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
