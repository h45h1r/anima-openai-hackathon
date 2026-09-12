import { NeonClinicalClient } from './neon/client';
import { canonicalPolicy, saveCanonicalPolicy } from './consent/canonical';
/**
 * In-process clinical Ask runtime (ported from CareCircle Express).
 * Used by Kindred Next.js API routes under /api/care/*.
 */
import { careStore, careMemory, withCareRuntime } from "./store/runtime";
import type { SessionState } from "./store/store";
import { AnimaClient, AnimaClientError, normalisePatientSearchResponse } from "./anima/client";
import { buildClinicalContext } from "./anima/normalise";
import { runAgentQuestion, resolveAskModel, suggestionsForViewer } from "./agent/harness";
import type { AskStreamEvent } from "./agent/events";
import {
  clearResource,
  evaluateConsent,
  holdResource,
  updateGrants,
  updateSharingLevel,
  viewerSharingLevel,
  type ConsentPolicyState,
} from "./consent/policy";
import type { KindredSharingLevel } from "./consent/kindredBridge";
import {
  animaStatusForKind,
  humanMessage,
  humanizeAnimaError,
  type CareCircleErrorCode,
} from "./errors";
import type { InformationClass } from "./types/domain";

const DEFAULT_BASE = process.env.ANIMA_BASE_URL || process.env.SIM_BASE_URL || "https://sim.animahacks.com";

export type JsonResult = { status: number; body: unknown };

function jsonError(status: number, code: CareCircleErrorCode, extras?: Record<string, unknown>): JsonResult {
  return {
    status,
    body: {
      error: code,
      message: humanMessage(code),
      liveData: false,
      ...extras,
    },
  };
}

function sessionIdFrom(headers: Headers, body?: Record<string, unknown>, query?: URLSearchParams): string | undefined {
  return (
    headers.get("x-carecircle-session") ||
    (typeof body?.sessionId === "string" ? body.sessionId : undefined) ||
    query?.get("sessionId") ||
    undefined
  )?.trim() || undefined;
}

function requireSession(headers: Headers, body?: Record<string, unknown>, query?: URLSearchParams) {
  const id = sessionIdFrom(headers, body, query);
  if (!id) return { error: jsonError(401, "missing_session") as JsonResult };
  const session = careStore().getSession(id);
  if (!session || (!session.animaApiKey && session.dataSource !== 'neon')) return { error: jsonError(401, "disconnected") as JsonResult };
  if (process.env.DATABASE_URL && session.dataSource !== 'neon') {
    return { session: careStore().updateSession(session.sessionId, { dataSource: 'neon', animaBaseUrl: 'neon', animaApiKey: '' }) };
  }
  return { session };
}

function clientFor(session: SessionState) {
  if (process.env.DATABASE_URL) return new NeonClinicalClient();
  return new AnimaClient({ baseUrl: session.animaBaseUrl, apiKey: session.animaApiKey });
}

function publicPolicy(policy: ConsentPolicyState) {
  const family = policy.viewers.filter((v) => v.viewerId !== "patient");
  return {
    patientId: policy.patientId,
    policyVersion: policy.policyVersion,
    accessModel: "kindred_sharing_levels",
    viewers: policy.viewers.map((v) => ({
      ...v,
      sharingLevel: viewerSharingLevel(policy, v.viewerId),
    })),
    sharingLevels: Object.fromEntries(family.map((v) => [v.viewerId, viewerSharingLevel(policy, v.viewerId)])),
    grants: policy.grants.map((g) => ({
      viewerId: g.viewerId,
      informationClass: g.informationClass,
      allowed: g.allowed && !g.revokedAt,
      version: g.version,
    })),
    disclosures: policy.disclosures,
    audit: policy.audit.slice(-20),
  };
}

function publicContext(context: ReturnType<typeof buildClinicalContext>) {
  return {
    patientId: context.patientId,
    sites: context.sites,
    fetchedAt: context.fetchedAt,
    simulationNowMs: context.simulationNowMs,
    recordClasses: context.recordClasses,
    sparse: context.sparse,
    errors: context.errors,
    resourceCount: context.resources.length,
    measurementCount: context.measurements.length,
    events: context.events.slice(0, 40).map((e) => ({
      evidenceId: e.evidenceId,
      resourceId: e.resourceId,
      kind: e.kind,
      title: e.title,
      status: e.status,
      at: e.at,
      summary: e.summary,
      informationClass: e.informationClass,
      service: e.service,
      sourceVersion: e.sourceVersion,
    })),
    measurements: context.measurements.map((m) => ({
      evidenceId: m.evidenceId,
      resourceId: m.resourceId,
      panelId: m.panelId,
      analyteId: m.analyteId,
      displayName: m.displayName,
      value: m.value,
      unit: m.unit,
      sampledAt: m.sampledAt,
      referenceLow: m.referenceLow,
      referenceHigh: m.referenceHigh,
      referenceLabel: m.referenceLabel,
      service: m.service,
      sourceVersion: m.sourceVersion,
    })),
    resources: context.resources.slice(0, 80).map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      status: r.status,
      owner: r.owner,
      createdAt: r.createdAt,
      version: r.version,
      informationClasses: undefined,
    })),
  };
}

async function loadContext(
  client: AnimaClient,
  patientId: string,
  session: SessionState,
) {
  const sites = (session.scopes?.length ? session.scopes : ["gp", "hospital", "pharmacy"]).filter((s) =>
    ["gp", "hospital", "pharmacy", "community", "diagnostics", "referrals", "wearables"].includes(s),
  );
  const uniqueSites = [...new Set(sites.length ? sites : ["gp", "hospital", "pharmacy"])];
  const siteResources: { site: string; resources: import("./types/domain").AnimaResource[]; now?: number }[] = [];
  const errors: { site: string; message: string }[] = [];
  await Promise.all(uniqueSites.map(async site => {
    try {
      const view = await client.getView(site, patientId, 500, 0);
      const resources = [...(view.resources || [])];
      while (resources.length < view.resourceTotal) {
        const page = await client.getView(site, patientId, 500, resources.length);
        if (!page.resources.length) throw new AnimaClientError('The patient record could not be fully loaded.', 'unavailable');
        resources.push(...page.resources);
      }
      siteResources.push({ site, resources, now: view.now });
    } catch (err) {
      errors.push({
        site,
        message: err instanceof Error ? err.message : "view failed",
      });
    }
  }));
  if (!siteResources.length && errors.length) {
    throw new AnimaClientError(humanMessage("unavailable"), "unavailable");
  }
  careStore().updateSession(session.sessionId, { lastSyncAt: new Date().toISOString() });
  return buildClinicalContext({ patientId, siteResources, errors });
}

function detectAndHoldNewResults(
  sessionId: string,
  patientId: string,
  context: ReturnType<typeof buildClinicalContext>,
  policy: ConsentPolicyState,
) {
  const session = careStore().getSession(sessionId);
  if (!session) return;
  const known = new Set(session.knownResourceIds[patientId] || []);
  const labResourceIds = [
    ...new Set(
      context.measurements
        .map((m) => m.resourceId)
        .concat(context.events.filter((e) => e.informationClass === "laboratory_results").map((e) => e.resourceId)),
    ),
  ];
  let nextPolicy = policy;
  const firstSync = known.size === 0;
  for (const id of labResourceIds) {
    if (!known.has(id) && !firstSync) {
      nextPolicy = holdResource(nextPolicy, id, "system");
    }
    known.add(id);
  }
  careStore().updateSession(sessionId, {
    knownResourceIds: { ...session.knownResourceIds, [patientId]: [...known] },
  });
  if (nextPolicy !== policy) careStore().savePolicy(nextPolicy);
}

function animaErrorResult(err: unknown): JsonResult {
  if (err instanceof AnimaClientError) {
    const code: CareCircleErrorCode = err.kind;
    return {
      status: animaStatusForKind(err.kind),
      body: {
        error: code,
        message: humanizeAnimaError(err),
        animaStatus: err.status,
        liveData: false,
      },
    };
  }
  console.error(err);
  return jsonError(500, "internal");
}

function cryptoRandom() {
  return globalThis.crypto?.randomUUID?.() || `cc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sanitizeHistory(raw: unknown): { role: "user" | "assistant"; content: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const item of raw.slice(-8)) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: string }).role;
    const content = String((item as { content?: string }).content || "").trim();
    if ((role === "user" || role === "assistant") && content && content.length < 4000) {
      out.push({ role, content });
    }
  }
  return out;
}

function mergeHistory(
  stored: { role: "user" | "assistant"; content: string }[],
  client: { role: "user" | "assistant"; content: string }[],
) {
  const base = client.length >= stored.length ? client : stored;
  return base.slice(-6);
}

async function executeAsk(input: {
  session: SessionState;
  patientId: string;
  viewerId: string;
  question: string;
  history?: { role: "user" | "assistant"; content: string }[];
  onEvent?: (event: AskStreamEvent) => void;
}) {
  const client = clientFor(input.session);
  const context = await loadContext(client, input.patientId, input.session);
  const policy = await canonicalPolicy(input.patientId, input.session.selectedPatientName || input.patientId);
  detectAndHoldNewResults(input.session.sessionId, input.patientId, context, policy);
  const history = mergeHistory(
    careStore().getChatTurns(input.session.sessionId, input.patientId, input.viewerId),
    sanitizeHistory(input.history),
  );
  const run = await runAgentQuestion({
    client,
    context,
    policy: careStore().getPolicy(input.patientId)!,
    viewerId: input.viewerId,
    question: input.question,
    history,
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiModel: resolveAskModel(process.env.OPENAI_MODEL),
    memory: careMemory(),
    onConsentUpdate: saveCanonicalPolicy,
    onEvent: input.onEvent,
  });
  careStore().addRun(run);
  careStore().appendChatTurns(input.session.sessionId, input.patientId, input.viewerId, [
    { role: "user", content: input.question },
    { role: "assistant", content: run.answer.answer },
  ]);
  const suggestions = suggestionsForViewer(context, careStore().getPolicy(input.patientId)!, input.viewerId);
  return { context, run, suggestions };
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const text = await req.text();
    if (!text) return {};
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function matchPath(parts: string[], pattern: string[]): boolean {
  if (parts.length !== pattern.length) return false;
  return pattern.every((p, i) => p.startsWith(":") || p === parts[i]);
}

async function handleCareApiInScope(req: Request, pathParts: string[]): Promise<Response> {
  const method = req.method.toUpperCase();
  const url = new URL(req.url);
  const query = url.searchParams;

  // Health — no session
  if (method === "GET" && matchPath(pathParts, ["health"])) {
    const openaiConfigured = Boolean(process.env.OPENAI_API_KEY);
    return Response.json({
      ok: true,
      service: "kindred-care",
      databaseConfigured: Boolean(process.env.DATABASE_URL),
      dataSource: process.env.DATABASE_URL ? "neon" : "anima",
      openaiConfigured,
      openaiModel: openaiConfigured ? resolveAskModel(process.env.OPENAI_MODEL) : null,
      animaEnvKeyConfigured: !process.env.DATABASE_URL && Boolean(process.env.ANIMA_API_KEY || process.env.SIM_API_KEY),
      animaTeamNameConfigured: Boolean(process.env.ANIMA_TEAM_NAME),
      askTransport: ["sse", "rest"],
      ssePath: "/api/care/ask/stream",
    });
  }

  // SSE ask stream — handled specially
  if (method === "POST" && matchPath(pathParts, ["ask", "stream"])) {
    return handleAskStream(req);
  }

  const body = method === "GET" || method === "HEAD" ? {} : await readJsonBody(req);
  const result = await dispatchJson(method, pathParts, req.headers, body, query);
  return Response.json(result.body, { status: result.status });
}

async function dispatchJson(
  method: string,
  pathParts: string[],
  headers: Headers,
  body: Record<string, unknown>,
  query: URLSearchParams,
): Promise<JsonResult> {
  try {
    if (method === "POST" && matchPath(pathParts, ["connect"])) {
      if (process.env.DATABASE_URL) {
        const team = await new NeonClinicalClient().getTeam();
        const session = careStore().createSession({ animaBaseUrl: 'neon', animaApiKey: '', dataSource: 'neon',
          teamLabel: team.team, worldId: team.world, scopes: team.scopes, connectedAt: new Date().toISOString() });
        return { status: 200, body: { session: careStore().publicSessionView(session), createdWorld: false } };
      }

      const baseUrl = String(process.env.VERCEL ? DEFAULT_BASE : body.baseUrl || DEFAULT_BASE).replace(/\/$/, "");
      let apiKey = String(body.apiKey || process.env.ANIMA_API_KEY || process.env.SIM_API_KEY || "").trim();
      const teamName = String(body.teamName || process.env.ANIMA_TEAM_NAME || "").trim();

      let joinMeta: { team?: string; world?: string; scopes?: string[]; created?: boolean } = {};
      if (!apiKey && teamName) {
        const joined = await AnimaClient.createOrJoinTeam(baseUrl, teamName);
        apiKey = joined.apiKey;
        joinMeta = joined;
      }
      if (!apiKey) {
        return jsonError(400, "missing_key", {
          needed: ["ANIMA_API_KEY or connect UI apiKey", "optional ANIMA_TEAM_NAME", "optional OPENAI_API_KEY"],
        });
      }

      const client = new AnimaClient({ baseUrl, apiKey });
      const team = await client.getTeam();
      const session = careStore().createSession({
        animaBaseUrl: baseUrl,
        animaApiKey: apiKey,
        teamLabel: team.team || joinMeta.team,
        worldId: team.world || joinMeta.world,
        scopes: team.scopes || joinMeta.scopes || [],
        connectedAt: new Date().toISOString(),
        lastSyncAt: new Date().toISOString(),
      });

      return {
        status: 200,
        body: {
          requestId: session.sessionId,
          session: careStore().publicSessionView(session),
          createdWorld: Boolean(joinMeta.created),
        },
      };
    }

    if (method === "GET" && matchPath(pathParts, ["session"])) {
      const gate = requireSession(headers, body, query);
      if ("error" in gate && gate.error) return gate.error;
      const session = gate.session!;
      return { status: 200, body: { session: careStore().publicSessionView(session) } };
    }

    if (method === "POST" && matchPath(pathParts, ["disconnect"])) {
      const id = sessionIdFrom(headers, body, query);
      if (id && careStore().getSession(id)) {
        careStore().updateSession(id, { animaApiKey: "", dataSource: undefined, selectedPatientId: undefined, selectedPatientName: undefined });
      }
      return { status: 200, body: { ok: true } };
    }

    if (method === "GET" && matchPath(pathParts, ["patients"])) {
      const gate = requireSession(headers, body, query);
      if ("error" in gate && gate.error) return gate.error;
      const session = gate.session!;
      const q = String(query.get("q") || "");
      const offset = Number(query.get("offset") || 0);
      const site = String(query.get("site") || "gp");
      const client = clientFor(session);
      const raw = await client.searchPatients(site, q, offset);
      const normalised = normalisePatientSearchResponse(raw);
      careStore().updateSession(session.sessionId, { lastSyncAt: new Date().toISOString() });
      return {
        status: 200,
        body: {
          requestId: `pat-${Date.now()}`,
          freshness: careStore().getSession(session.sessionId)?.lastSyncAt,
          ...normalised,
          site,
        },
      };
    }

    if (method === "POST" && matchPath(pathParts, ["patients", "select"])) {
      const gate = requireSession(headers, body, query);
      if ("error" in gate && gate.error) return gate.error;
      const session = gate.session!;
      const patientId = String(body.patientId || "");
      if (!patientId) return jsonError(400, "no_patient");
      const client = clientFor(session);
      const raw = await client.searchPatients("gp", patientId, 0);
      const { items } = normalisePatientSearchResponse(raw);
      const match = items.find((p) => p.id === patientId);
      if (!match) return jsonError(404, "patient_not_in_world");
      careStore().updateSession(session.sessionId, {
        selectedPatientId: match.id,
        selectedPatientName: match.name,
        activeViewerId: "patient",
        lastSyncAt: new Date().toISOString(),
      });
      const policy = await canonicalPolicy(match.id, match.name);
      const context = await loadContext(client, match.id, session);
      detectAndHoldNewResults(session.sessionId, match.id, context, policy);
      return {
        status: 200,
        body: {
          patient: match,
          session: careStore().publicSessionView(careStore().getSession(session.sessionId)!),
          policy: publicPolicy(careStore().getPolicy(match.id)!),
          context: publicContext(context),
        },
      };
    }

    if (method === "GET" && pathParts.length === 3 && pathParts[0] === "patients" && pathParts[2] === "context") {
      const gate = requireSession(headers, body, query);
      if ("error" in gate && gate.error) return gate.error;
      const session = gate.session!;
      const patientId = pathParts[1];
      if (session.selectedPatientId !== patientId) return jsonError(409, "patient_mismatch");
      const client = clientFor(session);
      const context = await loadContext(client, patientId, session);
      await canonicalPolicy(patientId, session.selectedPatientName || patientId);
      detectAndHoldNewResults(session.sessionId, patientId, context, careStore().getPolicy(patientId)!);
      const viewerId = String(query.get("viewerId") || session.activeViewerId);
      const full = context;
      const policyNow = careStore().getPolicy(patientId)!;
      const evidence = [
        ...full.measurements.map((m) => ({
          evidenceId: m.evidenceId,
          resourceId: m.resourceId,
          informationClass: m.informationClass,
          fields: ["value"],
          payload: m,
          kind: "measurement" as const,
        })),
        ...full.events.map((e) => ({
          evidenceId: e.evidenceId,
          resourceId: e.resourceId,
          informationClass: e.informationClass,
          fields: Object.keys(e.fields),
          payload: e,
          kind: "event" as const,
        })),
      ];
      const decision = evaluateConsent({ policy: policyNow, viewerId, evidence });
      const allowed = new Set(decision.allowedEvidenceIds);
      const filtered = {
        ...full,
        measurements: full.measurements.filter((m) => allowed.has(m.evidenceId)),
        events: full.events.filter((e) => allowed.has(e.evidenceId)),
      };
      return {
        status: 200,
        body: {
          freshness: new Date().toISOString(),
          context: publicContext(filtered),
          suggestions: suggestionsForViewer(full, policyNow, viewerId),
          policy: publicPolicy(policyNow),
          policyPreview: { outcome: decision.outcome, reasonCodes: decision.reasonCodes },
        },
      };
    }

    if (method === "POST" && matchPath(pathParts, ["viewer"])) {
      const gate = requireSession(headers, body, query);
      if ("error" in gate && gate.error) return gate.error;
      const session = gate.session!;
      const viewerId = String(body.viewerId || "");
      const patientId = session.selectedPatientId;
      if (!patientId) return jsonError(400, "no_patient");
      const policy = await canonicalPolicy(patientId, session.selectedPatientName || patientId);
      if (!policy.viewers.some((v) => v.viewerId === viewerId)) return jsonError(400, "unknown_viewer");
      careStore().updateSession(session.sessionId, { activeViewerId: viewerId });
      return {
        status: 200,
        body: { session: careStore().publicSessionView(careStore().getSession(session.sessionId)!), policy: publicPolicy(policy) },
      };
    }

    if (method === "GET" && pathParts.length === 2 && pathParts[0] === "consent") {
      const gate = requireSession(headers, body, query);
      if ("error" in gate && gate.error) return gate.error;
      const session = gate.session!;
      const patientId = pathParts[1];
      if (session.selectedPatientId !== patientId) return jsonError(409, "patient_mismatch");
      const policy = await canonicalPolicy(patientId, session.selectedPatientName || patientId);
      return { status: 200, body: { policy: publicPolicy(policy) } };
    }

    if (method === "PUT" && pathParts.length === 2 && pathParts[0] === "consent") {
      const gate = requireSession(headers, body, query);
      if ("error" in gate && gate.error) return gate.error;
      const session = gate.session!;
      const patientId = pathParts[1];
      if (session.selectedPatientId !== patientId) return jsonError(409, "patient_mismatch");
      if (session.activeViewerId !== "patient") return jsonError(403, "only_patient_may_edit_consent");
      try {
        const policy = await canonicalPolicy(patientId, session.selectedPatientName || patientId);
        const { viewerId, sharingLevel, updates, expectedVersion } = body as {
          viewerId: string;
          sharingLevel?: KindredSharingLevel;
          updates?: Partial<Record<InformationClass, boolean>>;
          expectedVersion: number;
        };
        const next =
          sharingLevel === "everything" || sharingLevel === "practical" || sharingLevel === "updates"
            ? updateSharingLevel(policy, viewerId, sharingLevel, Number(expectedVersion), "patient")
            : updateGrants(policy, viewerId, updates || {}, Number(expectedVersion), "patient");
        await saveCanonicalPolicy(next);
        return { status: 200, body: { policy: publicPolicy(careStore().getPolicy(patientId)!) } };
      } catch {
        return jsonError(409, "consent_conflict");
      }
    }

    if (method === "POST" && pathParts.length === 2 && pathParts[0] === "disclosure") {
      const gate = requireSession(headers, body, query);
      if ("error" in gate && gate.error) return gate.error;
      const session = gate.session!;
      const patientId = pathParts[1];
      if (session.selectedPatientId !== patientId) return jsonError(409, "patient_mismatch");
      const { resourceId, state } = body as { resourceId: string; state: "held" | "cleared" };
      let policy = await canonicalPolicy(patientId, session.selectedPatientName || patientId);
      policy = state === "held" ? holdResource(policy, resourceId, "demo") : clearResource(policy, resourceId, "demo");
      careStore().savePolicy(policy);
      return { status: 200, body: { policy: publicPolicy(policy) } };
    }

    if (method === "POST" && matchPath(pathParts, ["ask"])) {
      const gate = requireSession(headers, body, query);
      if ("error" in gate && gate.error) return gate.error;
      const session = gate.session!;
      const patientId = String(body.patientId || session.selectedPatientId || "");
      const question = String(body.question || "").trim();
      const viewerId = String(body.viewerId || session.activeViewerId);
      if (!patientId || session.selectedPatientId !== patientId) {
        return jsonError(409, patientId ? "patient_mismatch" : "no_patient");
      }
      if (!question) return jsonError(400, "question_required");
      const authenticatedViewer = session.activeViewerId;
      if (viewerId !== authenticatedViewer) return jsonError(400, "viewer_mismatch");

      const client = clientFor(session);
      const context = await loadContext(client, patientId, session);
      await canonicalPolicy(patientId, session.selectedPatientName || patientId);
      detectAndHoldNewResults(session.sessionId, patientId, context, careStore().getPolicy(patientId)!);
      const clientHistory = sanitizeHistory(body.history);
      const history = mergeHistory(
        careStore().getChatTurns(session.sessionId, patientId, authenticatedViewer),
        clientHistory,
      );
      const run = await runAgentQuestion({
        client,
        context,
        policy: careStore().getPolicy(patientId)!,
        viewerId: authenticatedViewer,
        question,
        history,
        openaiApiKey: process.env.OPENAI_API_KEY,
        openaiModel: resolveAskModel(process.env.OPENAI_MODEL),
        memory: careMemory(),
        onConsentUpdate: saveCanonicalPolicy,
      });
      careStore().addRun(run);
      careStore().appendChatTurns(session.sessionId, patientId, authenticatedViewer, [
        { role: "user", content: question },
        { role: "assistant", content: run.answer.answer },
      ]);
      return {
        status: 200,
        body: {
          freshness: context.fetchedAt,
          run,
          suggestions: suggestionsForViewer(context, careStore().getPolicy(patientId)!, authenticatedViewer),
          memoriesUsed: run.memoriesUsed || [],
          memoriesWritten: run.memoriesWritten || [],
        },
      };
    }

    if (method === "GET" && matchPath(pathParts, ["appointments"])) {
      const gate = requireSession(headers, body, query);
      if ("error" in gate && gate.error) return gate.error;
      const session = gate.session!;
      const date = String(query.get("date") || new Date().toISOString().slice(0, 10));
      const client = clientFor(session);
      const book = await client.getAppointments("gp", date);
      return { status: 200, body: { date, book, notice: "Slots are availability only — not a confirmed booking." } };
    }

    if (method === "POST" && matchPath(pathParts, ["appointments", "request"])) {
      const gate = requireSession(headers, body, query);
      if ("error" in gate && gate.error) return gate.error;
      const session = gate.session!;
      const { confirmBook, slot, reason, preference } = body as {
        confirmBook?: boolean;
        slot?: { sessionId: string; sessionVersion: number; startsAt: string; title?: string };
        reason?: string;
        preference?: string;
      };
      if (!confirmBook || !slot?.sessionId || !slot?.startsAt || slot.sessionVersion == null) {
        return {
          status: 200,
          body: {
            stage: "awaiting_confirmation",
            notice:
              "Slots and preferences only — booking not submitted. Confirm an exact slot (confirmBook + sessionId, sessionVersion, startsAt) to attempt book_appointment.",
            draft: { reason, preference, slot },
          },
        };
      }
      if (!session.selectedPatientId) return jsonError(400, "no_patient");
      try {
        const client = clientFor(session);
        const result = await client.postAction(
          "gp",
          {
            type: "book_appointment",
            sessionId: slot.sessionId,
            sessionVersion: slot.sessionVersion,
            startsAt: slot.startsAt,
            patientId: session.selectedPatientId,
            title: slot.title || reason || "Kindred requested appointment",
          },
          cryptoRandom(),
        );
        return {
          status: 200,
          body: {
            stage: "confirmed",
            notice: "Booking submitted to Anima via book_appointment.",
            result,
          },
        };
      } catch (err) {
        if (err instanceof AnimaClientError) {
          return jsonError(animaStatusForKind(err.kind), "booking_not_submitted", {
            animaStatus: err.status,
            animaDetail: err.kind,
          });
        }
        throw err;
      }
    }

    if (method === "POST" && matchPath(pathParts, ["clock", "advance"])) {
      const gate = requireSession(headers, body, query);
      if ("error" in gate && gate.error) return gate.error;
      const session = gate.session!;
      const minutes = Number(body.advanceMinutes || 121);
      const client = clientFor(session);
      const clock = await client.advanceClock(minutes);
      careStore().updateSession(session.sessionId, { lastSyncAt: new Date().toISOString() });
      return {
        status: 200,
        body: { clock, notice: "Simulation clock advanced (paused). Refresh patient context for new events." },
      };
    }

    if (method === "POST" && matchPath(pathParts, ["demo", "reset"])) {
      const gate = requireSession(headers, body, query);
      if ("error" in gate && gate.error) return gate.error;
      const session = gate.session!;
      careStore().resetCareCircleState(session.selectedPatientId);
      if (session.selectedPatientId) {
        await canonicalPolicy(session.selectedPatientId, session.selectedPatientName || session.selectedPatientId);
      }
      return { status: 200, body: { ok: true } };
    }

    if (method === "GET" && matchPath(pathParts, ["runs"])) {
      const gate = requireSession(headers, body, query);
      if ("error" in gate && gate.error) return gate.error;
      const session = gate.session!;
      if (!session.selectedPatientId) return jsonError(400, "no_patient");
      return { status: 200, body: { runs: careStore().listRuns(session.selectedPatientId) } };
    }

    return jsonError(404, "not_found");
  } catch (err) {
    return animaErrorResult(err);
  }
}

async function handleAskStream(req: Request): Promise<Response> {
  const body = await readJsonBody(req);
  const gate = requireSession(req.headers, body);
  if ("error" in gate && gate.error) {
    return Response.json(gate.error.body, { status: gate.error.status });
  }
  const session = gate.session!;
  const patientId = String(body.patientId || session.selectedPatientId || "");
  const question = String(body.question || "").trim();
  const viewerId = String(body.viewerId || session.activeViewerId);
  const authenticatedViewer = session.activeViewerId;

  const encoder = new TextEncoder();
  let keepalive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: AskStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          /* closed */
        }
      };
      const fail = (code: CareCircleErrorCode) => {
        send({ type: "error", message: humanMessage(code), code });
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      };

      if (!patientId || session.selectedPatientId !== patientId) {
        fail(patientId ? "patient_mismatch" : "no_patient");
        return;
      }
      if (!question) {
        fail("question_required");
        return;
      }
      if (viewerId !== authenticatedViewer) {
        fail("viewer_mismatch");
        return;
      }

      keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          /* closed */
        }
      }, 15000);

      const abort = () => {
        if (keepalive) clearInterval(keepalive);
      };
      req.signal.addEventListener("abort", abort);

      try {
        send({ type: "status", message: "Retrieving…" });
        const { run, suggestions } = await executeAsk({
          session,
          patientId,
          viewerId: authenticatedViewer,
          question,
          history: sanitizeHistory(body.history),
          onEvent: (event) => {
            if (event.type !== "final") send(event);
          },
        });
        send({
          type: "final",
          run,
          memoriesUsed: run.memoriesUsed || [],
          memoriesWritten: run.memoriesWritten || [],
          suggestions,
        });
      } catch (err) {
        if (err instanceof AnimaClientError) {
          send({ type: "error", message: humanizeAnimaError(err), code: err.kind });
        } else {
          console.error(err);
          send({ type: "error", message: humanMessage("internal"), code: "internal" });
        }
      } finally {
        if (keepalive) clearInterval(keepalive);
        req.signal.removeEventListener("abort", abort);
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      }
    },
    cancel() {
      if (keepalive) clearInterval(keepalive);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function handleCareApi(req: Request, pathParts: string[]): Promise<Response> {
  if (req.method === 'GET' && matchPath(pathParts, ['health'])) return handleCareApiInScope(req, pathParts);
  const body = req.method === 'GET' ? {} : await req.clone().json().catch(() => ({}));
  const isConnect = req.method === 'POST' && matchPath(pathParts, ['connect']);
  const sessionId = isConnect ? cryptoRandom() : sessionIdFrom(req.headers, body, new URL(req.url).searchParams);
  if (!sessionId || !/^[A-Za-z0-9_-]{6,80}$/.test(sessionId)) return Response.json({ error: 'missing_session' }, { status: 401 });
  if (req.method !== 'POST' || !matchPath(pathParts, ['ask', 'stream'])) {
    return withCareRuntime(() => handleCareApiInScope(req, pathParts), sessionId);
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let final: Uint8Array | undefined;
      try {
        await withCareRuntime(async () => {
          const response = await handleCareApiInScope(req, pathParts);
          if (!response.ok) throw new Error((await response.json()).message || 'Ask request failed.');
          const reader = response.body!.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (new TextDecoder().decode(value).includes('"type":"final"')) final = value;
            else controller.enqueue(value);
          }
        }, sessionId);
        if (final) controller.enqueue(final);
      } catch (error) {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', code: 'internal', message: error instanceof Error ? error.message : 'Ask failed.' })}\n\n`)); } catch { /* Client disconnected. */ }
      } finally { try { controller.close(); } catch { /* Client disconnected. */ } }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-store', 'X-Accel-Buffering': 'no' } });
}
