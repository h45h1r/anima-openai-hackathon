// Anima NHS-SIM adapter. Retries 502/503 and network errors, 60s timeout, one log line per request.
import { randomUUID } from "node:crypto";

const RETRIES = 6;
const BACKOFF_MS = 2500;
const TIMEOUT_MS = 60_000;
const RETRY_STATUSES = new Set([502, 503, 504]);

export const GP_SITE = "gp";

function config() {
  const baseUrl = (process.env.ANIMA_SIM_BASE_URL || "https://sim.animahealth.com").replace(/\/$/, "");
  const apiKey = process.env.ANIMA_SIM_API_KEY;
  if (!apiKey) throw new Error("ANIMA_SIM_API_KEY is not set");
  return { baseUrl, apiKey };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class AnimaError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "AnimaError";
    this.status = status;
    this.body = body;
  }
}

async function once(method, path, body, headers) {
  const { baseUrl, apiKey } = config();
  const started = Date.now();
  const res = await fetch(baseUrl + path, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  console.log(`anima ${method} ${path} -> ${res.status} (${Date.now() - started}ms)`);
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { error: text.slice(0, 200) };
  }
  return { status: res.status, json };
}

export async function request(method, path, body, headers = {}) {
  let lastErr = null;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const { status, json } = await once(method, path, body, headers);
      if (status >= 200 && status < 300) return json;
      const err = new AnimaError(json?.error || `Anima ${status}`, status, json);
      if (!RETRY_STATUSES.has(status)) throw err;
      lastErr = err;
    } catch (e) {
      if (e instanceof AnimaError && !RETRY_STATUSES.has(e.status)) throw e;
      lastErr = e;
      console.log(`anima ${method} ${path} -> retryable failure (${e.message}) attempt ${attempt}/${RETRIES}`);
    }
    if (attempt < RETRIES) await sleep(BACKOFF_MS * attempt);
  }
  throw lastErr;
}

// Every action carries a UUID clientRequestId (body) and Idempotency-Key (header) so retries never duplicate.
async function action(site, payload) {
  const id = randomUUID();
  return request("POST", `/api/sites/${site}/actions`, { ...payload, clientRequestId: id }, { "Idempotency-Key": id });
}

export function orderLft(patientId) {
  return action(GP_SITE, {
    type: "order_test",
    patientId,
    title: "Liver function tests",
    bloodTestOrder: {
      panelId: "lft",
      panel: "Liver function tests (LFT)",
      specimen: "Serum",
      priority: "routine",
      collection: "now",
      clinicalDetails: "CareCircle LFT monitoring.",
    },
  });
}

export function advance(minutes) {
  const advanceMinutes = Math.max(0, Math.min(10080, Number(minutes) || 0));
  return request("POST", "/api/clock", { paused: true, advanceMinutes });
}

export function siteView(site, patientId, limit = 300) {
  const q = new URLSearchParams({ patient: patientId, limit: String(limit) });
  return request("GET", `/api/sites/${site}/view?${q}`);
}

export const patientView = (patientId, limit = 300) => siteView(GP_SITE, patientId, limit);
export const communityView = (patientId, limit = 300) => siteView("community", patientId, limit);

export function createTask(patientId, title, text) {
  return action(GP_SITE, { type: "create_task", patientId, title, text });
}

export function clockEvents() {
  return request("GET", "/api/clock");
}

export const simMsToIso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
