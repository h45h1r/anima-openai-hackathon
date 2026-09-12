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
