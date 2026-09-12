import { nanoid } from 'nanoid';

export type AnimaErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'bad_request'
  | 'unavailable'
  | 'malformed'
  | 'unknown';

export class AnimaClientError extends Error {
  constructor(
    message: string,
    public readonly kind: AnimaErrorKind,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'AnimaClientError';
  }
}

export interface AnimaClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

function redact(url: string): string {
  return url.replace(/([?&](?:key|token)=)[^&]+/gi, '$1[REDACTED]');
}

function backendHeaders(baseUrl: string): Record<string, string> {
  const configured = process.env.ANIMA_BASE_URL || process.env.SIM_BASE_URL;
  return configured && new URL(baseUrl).origin === new URL(configured).origin && process.env.COMPANION_BYPASS_SECRET
    ? { 'x-vercel-protection-bypass': process.env.COMPANION_BYPASS_SECRET } : {};
}

export class AnimaClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  public lastSuccessAt: string | null = null;
  public lastTrace: { requestId: string; method: string; path: string; status?: number; ms: number }[] = [];

  constructor(opts: AnimaClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 20000;
  }

  static async createOrJoinTeam(baseUrl: string, teamName: string): Promise<{
    apiKey: string;
    team: string;
    teamName: string;
    world: string;
    scopes: string[];
    created: boolean;
  }> {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/keys`, {
      method: 'POST',
      headers: { ...backendHeaders(baseUrl), 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamName }),
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new AnimaClientError('Malformed JSON from POST /api/keys', 'malformed', res.status, text);
    }
    if (!res.ok) {
      throw new AnimaClientError(
        `Failed to create/join team (${res.status})`,
        mapStatus(res.status),
        res.status,
        body,
      );
    }
    return body as {
      apiKey: string;
      team: string;
      teamName: string;
      world: string;
      scopes: string[];
      created: boolean;
    };
  }

  async request<T>(method: string, path: string, init?: { query?: Record<string, string | number | undefined>; body?: unknown }): Promise<T> {
    const requestId = nanoid(10);
    const url = new URL(this.baseUrl + path);
    if (init?.query) {
      for (const [k, v] of Object.entries(init.query)) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
      }
    }
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          ...backendHeaders(this.baseUrl),
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init?.body ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      });
      const ms = Date.now() - started;
      const text = await res.text();
      let body: unknown = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          this.lastTrace.push({ requestId, method, path: redact(url.pathname + url.search), status: res.status, ms });
          throw new AnimaClientError(`Malformed JSON from ${method} ${path}`, 'malformed', res.status, text.slice(0, 400));
        }
      }
      this.lastTrace.push({ requestId, method, path: redact(url.pathname + url.search), status: res.status, ms });
      if (this.lastTrace.length > 40) this.lastTrace.shift();
      if (!res.ok) {
        const errMsg =
          typeof body === 'object' && body && 'error' in body
            ? String((body as { error: string }).error)
            : `Anima error ${res.status}`;
        throw new AnimaClientError(errMsg, mapStatus(res.status), res.status, body);
      }
      this.lastSuccessAt = new Date().toISOString();
      return body as T;
    } catch (err) {
      if (err instanceof AnimaClientError) throw err;
      const ms = Date.now() - started;
      this.lastTrace.push({ requestId, method, path: redact(url.pathname), ms });
      throw new AnimaClientError(
        err instanceof Error && /abort/i.test(err.message)
          ? 'Anima request timed out'
          : 'Anima unreachable',
        'unavailable',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  getTeam() {
    return this.request<{ team: string; world: string; scopes: string[] }>('GET', '/api/team');
  }

  searchPatients(site: string, q: string, offset = 0) {
    return this.request<{
      items?: PatientRow[];
      patients?: PatientRow[];
      total?: number;
      offset?: number;
      limit?: number;
    } | PatientRow[]>('GET', `/api/sites/${site}/patients`, { query: { q, offset } });
  }

  getView(site: string, patient: string, limit = 500, offset = 0) {
    return this.request<{
      id: string;
      now: number;
      speed: number;
      paused: boolean;
      population: number;
      resources: import('../types/domain').AnimaResource[];
      resourceTotal: number;
      resourceOffset: number;
      resourceLimit: number;
      events?: unknown[];
    }>('GET', `/api/sites/${site}/view`, { query: { patient, limit, offset } });
  }

  getAppointments(site: string, date: string) {
    return this.request<unknown>('GET', `/api/sites/${site}/appointments`, { query: { date } });
  }

  postAction(site: string, action: Record<string, unknown>, idempotencyKey?: string) {
    // Idempotency-Key is supported by OpenAPI; fetch headers set in request when needed
    return this.requestWithHeaders('POST', `/api/sites/${site}/actions`, action, idempotencyKey);
  }

  private async requestWithHeaders<T>(
    method: string,
    path: string,
    body: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    const requestId = nanoid(10);
    const url = this.baseUrl + path;
    const started = Date.now();
    const res = await fetch(url, {
      method,
      headers: {
        ...backendHeaders(this.baseUrl),
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    });
    const ms = Date.now() - started;
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      throw new AnimaClientError('Malformed JSON from action', 'malformed', res.status, text.slice(0, 400));
    }
    this.lastTrace.push({ requestId, method, path, status: res.status, ms });
    if (!res.ok) {
      throw new AnimaClientError(
        typeof parsed === 'object' && parsed && 'error' in parsed
          ? String((parsed as { error: string }).error)
          : `Action failed ${res.status}`,
        mapStatus(res.status),
        res.status,
        parsed,
      );
    }
    this.lastSuccessAt = new Date().toISOString();
    return parsed as T;
  }

  getClock() {
    return this.request<{ now: number; paused: boolean; speed: number; events: unknown[] }>('GET', '/api/clock');
  }

  advanceClock(advanceMinutes: number) {
    return this.request<{ now: number; paused: boolean; speed: number; events: unknown[] }>('POST', '/api/clock', {
      body: { paused: true, advanceMinutes },
    });
  }
}

export interface PatientRow {
  id: string;
  name: string;
  birthDate: string;
  localIds: Record<string, string>;
  conditions: string[];
  needs: string[];
  goals: string[];
  synthetic: true;
}

function mapStatus(status: number): AnimaErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 400) return 'bad_request';
  if (status >= 500) return 'unavailable';
  return 'unknown';
}

export function normalisePatientSearchResponse(body: unknown): { items: PatientRow[]; total: number; offset: number } {
  if (Array.isArray(body)) {
    return { items: body as PatientRow[], total: body.length, offset: 0 };
  }
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    const items = (o.items ?? o.patients ?? o.results ?? []) as PatientRow[];
    return {
      items,
      total: typeof o.total === 'number' ? o.total : items.length,
      offset: typeof o.offset === 'number' ? o.offset : 0,
    };
  }
  throw new AnimaClientError('Unexpected patient search response shape', 'malformed', undefined, body);
}
