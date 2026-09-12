import { NeonClinicalClient } from '../carecircle/server/neon/client';
// Thin client for the Anima NHS-SIM (https://sim.animahealth.com).
// Team key in SIM_API_KEY. The host returns intermittent 502s, so every call
// retries with backoff. Server-side only — never import from a client component.

import { randomUUID } from "node:crypto";

export interface SimResource {
  id: string;
  patientId?: string;
  kind: string;
  title: string;
  status: string;
  owner: string;
  visibleTo: string[];
  createdAt: number;
  dueAt: number | null;
  version: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

export interface SimView {
  id: string; // world id
  now: number;
  paused: boolean;
  speed: number;
  resources: SimResource[];
  resourceTotal: number;
}

export interface SimPatient {
  id: string;
  name: string;
  birthDate: string;
  conditions?: string[];
  needs?: string[];
  goals?: string[];
  localIds?: Record<string, string>;
}

export interface SimAction {
  type: string;
  patientId?: string;
  title?: string;
  text?: string;
  target?: string;
  resourceId?: string;
  expectedVersion?: number;
  [k: string]: unknown;
}

const BASE = (process.env.SIM_BASE_URL ?? "https://sim.animahealth.com").replace(/\/$/, "");

export function simConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL || process.env.SIM_API_KEY);
}

async function call<T>(path: string, init: RequestInit = {}, attempts = 4): Promise<T> {
  if (process.env.DATABASE_URL && (!init.method || init.method === 'GET')) {
    const url = new URL(path, 'http://neon');
    return new NeonClinicalClient().request<T>('GET', url.pathname, { query: Object.fromEntries(url.searchParams) });
  }
  const key = process.env.SIM_API_KEY;
  if (!key) throw new Error("SIM_API_KEY is not set");
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        ...init,
        headers: { ...(process.env.COMPANION_BYPASS_SECRET ? { "x-vercel-protection-bypass": process.env.COMPANION_BYPASS_SECRET } : {}), Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
        cache: "no-store",
      });
      if (res.status >= 500) throw new Error(`sim ${res.status} on ${path}`);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw Object.assign(new Error(`sim ${res.status} on ${path}: ${body.slice(0, 200)}`), { status: res.status, fatal: true });
      }
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
      if ((e as { fatal?: boolean }).fatal) throw e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

export const sim = {
  base: process.env.DATABASE_URL ? "neon" : BASE,
  team: () => call<{ team: string; world: string; scopes: string[] }>("/api/team"),
  clock: () => call<{ now: number; paused: boolean; speed: number; events: unknown[] }>("/api/clock"),
  view: async (site: string, patientId: string, limit = 500): Promise<SimView> => {
    const path = `/api/sites/${site}/view?patient=${encodeURIComponent(patientId)}&limit=${limit}`;
    const first = await call<SimView>(path);
    const resources = [...first.resources];
    while (resources.length < first.resourceTotal) {
      const page = await call<SimView>(`${path}&offset=${resources.length}`);
      if (!page.resources.length) throw new Error('The patient record could not be fully loaded.');
      resources.push(...page.resources);
    }
    return { ...first, resources };
  },
  searchPatients: (q: string) => call<{ total: number; items: SimPatient[] }>(`/api/sites/gp/patients?q=${encodeURIComponent(q)}`),
  organization: (id: string) => call<{ name?: string; address?: { line?: string[]; city?: string; postalCode?: string }[] }>(`/api/nhs/ods/Organization/${id}`),
  organizations: () => call<{ entry?: { resource?: { id?: string; name?: string } }[] }>(`/api/nhs/ods/Organization?_count=100&_offset=0`),
  action: (site: string, action: SimAction) =>
    call<SimResource>(`/api/sites/${site}/actions`, {
      method: "POST",
      body: JSON.stringify({ ...action, clientRequestId: randomUUID() }),
      headers: { "Idempotency-Key": randomUUID() },
    }),
};
