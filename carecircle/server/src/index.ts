import './env.js';
import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { rootDir } from './env.js';
import { AnimaClient, AnimaClientError, normalisePatientSearchResponse } from './anima/client.js';
import { buildClinicalContext } from './anima/normalise.js';
import { runAgentQuestion, suggestionsForViewer } from './agent/harness.js';
import { ScopedMemoryService } from './agent/memoryStore.js';
import type { AskStreamEvent } from './agent/events.js';
import {
  clearResource,
  evaluateConsent,
  holdResource,
  updateGrants,
  updateSharingLevel,
  viewerSharingLevel,
  type ConsentPolicyState,
} from './consent/policy.js';
import type { KindredSharingLevel } from './consent/kindredBridge.js';
import {
  animaStatusForKind,
  humanMessage,
  humanizeAnimaError,
  type CareCircleErrorCode,
} from './errors.js';
import { CareCircleStore } from './store/store.js';
import type { InformationClass } from './types/domain.js';

function jsonError(
  res: express.Response,
  status: number,
  code: CareCircleErrorCode,
  extras?: Record<string, unknown>,
) {
  return res.status(status).json({
    error: code,
    message: humanMessage(code),
    liveData: false,
    ...extras,
  });
}

const dataDir = path.resolve(rootDir, process.env.CARE_CIRCLE_DATA_DIR || './data');
const store = new CareCircleStore(dataDir);
const memoryService = new ScopedMemoryService({
  initial: store.listMemories(),
  persist: (items) => store.saveMemories(items),
});
const PORT = Number(process.env.PORT || 8787);
const DEFAULT_BASE = process.env.ANIMA_BASE_URL || 'https://sim.animahacks.com';

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));

function sessionId(req: express.Request): string | undefined {
  return (req.header('x-carecircle-session') || req.body?.sessionId || req.query.sessionId) as string | undefined;
}

function requireSession(req: express.Request, res: express.Response) {
  const id = sessionId(req);
  if (!id) {
    jsonError(res, 401, 'missing_session');
    return null;
  }
  const session = store.getSession(id);
  if (!session?.animaApiKey) {
    jsonError(res, 401, 'disconnected');
    return null;
  }
  return session;
}

function clientFor(session: NonNullable<ReturnType<typeof store.getSession>>) {
  return new AnimaClient({ baseUrl: session.animaBaseUrl, apiKey: session.animaApiKey });
}

app.get('/api/health', (_req, res) => {
  const openaiConfigured = Boolean(process.env.OPENAI_API_KEY);
  res.json({
    ok: true,
    service: 'carecircle',
    openaiConfigured,
    openaiModel: openaiConfigured ? process.env.OPENAI_MODEL || 'gpt-4o-mini' : null,
    animaEnvKeyConfigured: Boolean(process.env.ANIMA_API_KEY),
    animaTeamNameConfigured: Boolean(process.env.ANIMA_TEAM_NAME),
    askTransport: ['sse', 'rest'],
    ssePath: '/api/ask/stream',
  });
});

/** Connect with bearer key, env key, or team name join */
app.post('/api/connect', async (req, res) => {
  try {
    const baseUrl = String(req.body.baseUrl || DEFAULT_BASE).replace(/\/$/, '');
    let apiKey = String(req.body.apiKey || process.env.ANIMA_API_KEY || '').trim();
    const teamName = String(req.body.teamName || process.env.ANIMA_TEAM_NAME || '').trim();

    let joinMeta: { team?: string; world?: string; scopes?: string[]; created?: boolean } = {};
    if (!apiKey && teamName) {
      const joined = await AnimaClient.createOrJoinTeam(baseUrl, teamName);
      apiKey = joined.apiKey;
      joinMeta = joined;
    }
    if (!apiKey) {
      return jsonError(res, 400, 'missing_key', {
        needed: ['ANIMA_API_KEY or connect UI apiKey', 'optional ANIMA_TEAM_NAME', 'optional OPENAI_API_KEY'],
      });
    }

    const client = new AnimaClient({ baseUrl, apiKey });
    const team = await client.getTeam();
    const session = store.createSession({
      animaBaseUrl: baseUrl,
      animaApiKey: apiKey,
      teamLabel: team.team || joinMeta.team,
      worldId: team.world || joinMeta.world,
      scopes: team.scopes || joinMeta.scopes || [],
      connectedAt: new Date().toISOString(),
      lastSyncAt: new Date().toISOString(),
    });

    res.json({
      requestId: session.sessionId,
      session: store.publicSessionView(session),
      createdWorld: Boolean(joinMeta.created),
    });
  } catch (err) {
    respondAnimaError(res, err);
  }
});

app.get('/api/session', (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  res.json({ session: store.publicSessionView(session) });
});

app.post('/api/disconnect', (req, res) => {
  const id = sessionId(req);
  if (id && store.getSession(id)) {
    store.updateSession(id, { animaApiKey: '', selectedPatientId: undefined, selectedPatientName: undefined });
  }
  res.json({ ok: true });
});

app.get('/api/patients', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const q = String(req.query.q || '');
  const offset = Number(req.query.offset || 0);
  const site = String(req.query.site || 'gp');
  try {
    const client = clientFor(session);
    const raw = await client.searchPatients(site, q, offset);
    const normalised = normalisePatientSearchResponse(raw);
    store.updateSession(session.sessionId, { lastSyncAt: new Date().toISOString() });
    res.json({
      requestId: `pat-${Date.now()}`,
      freshness: store.getSession(session.sessionId)?.lastSyncAt,
      ...normalised,
      site,
    });
  } catch (err) {
    respondAnimaError(res, err);
  }
});

app.post('/api/patients/select', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const patientId = String(req.body.patientId || '');
  if (!patientId) return jsonError(res, 400, 'no_patient');
  try {
    const client = clientFor(session);
    // Verify patient exists via search by ID — never trust client alone
    const raw = await client.searchPatients('gp', patientId, 0);
    const { items } = normalisePatientSearchResponse(raw);
    const match = items.find((p) => p.id === patientId);
    if (!match) {
      return jsonError(res, 404, 'patient_not_in_world');
    }
    store.updateSession(session.sessionId, {
      selectedPatientId: match.id,
      selectedPatientName: match.name,
      activeViewerId: 'patient',
      lastSyncAt: new Date().toISOString(),
    });
    const policy = store.ensurePolicy(match.id, match.name);
    const context = await loadContext(client, match.id, session);
    detectAndHoldNewResults(session.sessionId, match.id, context, policy);
    res.json({
      patient: match,
      session: store.publicSessionView(store.getSession(session.sessionId)!),
      policy: publicPolicy(store.getPolicy(match.id)!),
      context: publicContext(context),
    });
  } catch (err) {
    respondAnimaError(res, err);
  }
});

app.get('/api/patients/:patientId/context', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  if (session.selectedPatientId !== req.params.patientId) {
    return jsonError(res, 409, 'patient_mismatch');
  }
  try {
    const client = clientFor(session);
    const context = await loadContext(client, req.params.patientId, session);
    const policy = store.ensurePolicy(req.params.patientId, session.selectedPatientName || req.params.patientId);
    detectAndHoldNewResults(session.sessionId, req.params.patientId, context, policy);
    const viewerId = String(req.query.viewerId || session.activeViewerId);
    const full = context;
    const policyNow = store.getPolicy(req.params.patientId)!;
    const evidence = [
      ...full.measurements.map((m) => ({
        evidenceId: m.evidenceId,
        resourceId: m.resourceId,
        informationClass: m.informationClass,
        fields: ['value'],
        payload: m,
        kind: 'measurement' as const,
      })),
      ...full.events.map((e) => ({
        evidenceId: e.evidenceId,
        resourceId: e.resourceId,
        informationClass: e.informationClass,
        fields: Object.keys(e.fields),
        payload: e,
        kind: 'event' as const,
      })),
    ];
    const decision = evaluateConsent({ policy: policyNow, viewerId, evidence });
    const allowed = new Set(decision.allowedEvidenceIds);
    const filtered = {
      ...full,
      measurements: full.measurements.filter((m) => allowed.has(m.evidenceId)),
      events: full.events.filter((e) => allowed.has(e.evidenceId)),
    };
    res.json({
      freshness: new Date().toISOString(),
      context: publicContext(filtered),
      suggestions: suggestionsForViewer(full, policyNow, viewerId),
      policy: publicPolicy(policyNow),
      policyPreview: { outcome: decision.outcome, reasonCodes: decision.reasonCodes },
    });
  } catch (err) {
    respondAnimaError(res, err);
  }
});

app.post('/api/viewer', (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const viewerId = String(req.body.viewerId || '');
  const patientId = session.selectedPatientId;
  if (!patientId) return jsonError(res, 400, 'no_patient');
  const policy = store.ensurePolicy(patientId, session.selectedPatientName || patientId);
  if (!policy.viewers.some((v) => v.viewerId === viewerId)) {
    return jsonError(res, 400, 'unknown_viewer');
  }
  store.updateSession(session.sessionId, { activeViewerId: viewerId });
  res.json({ session: store.publicSessionView(store.getSession(session.sessionId)!), policy: publicPolicy(policy) });
});

app.get('/api/consent/:patientId', (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  if (session.selectedPatientId !== req.params.patientId) {
    return jsonError(res, 409, 'patient_mismatch');
  }
  const policy = store.ensurePolicy(req.params.patientId, session.selectedPatientName || req.params.patientId);
  res.json({ policy: publicPolicy(policy) });
});

app.put('/api/consent/:patientId', (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  if (session.selectedPatientId !== req.params.patientId) {
    return jsonError(res, 409, 'patient_mismatch');
  }
  if (session.activeViewerId !== 'patient') {
    return jsonError(res, 403, 'only_patient_may_edit_consent');
  }
  try {
    const policy = store.ensurePolicy(req.params.patientId, session.selectedPatientName || req.params.patientId);
    const { viewerId, sharingLevel, updates, expectedVersion } = req.body as {
      viewerId: string;
      /** Preferred: Kindred sharing level (Everything / Only practical / Important updates). */
      sharingLevel?: KindredSharingLevel;
      /** Legacy class map — still accepted for evals/smoke; UI uses sharingLevel. */
      updates?: Partial<Record<InformationClass, boolean>>;
      expectedVersion: number;
    };
    const next =
      sharingLevel === 'everything' || sharingLevel === 'practical' || sharingLevel === 'updates'
        ? updateSharingLevel(policy, viewerId, sharingLevel, Number(expectedVersion), 'patient')
        : updateGrants(policy, viewerId, updates || {}, Number(expectedVersion), 'patient');
    store.savePolicy(next);
    res.json({ policy: publicPolicy(next) });
  } catch {
    return jsonError(res, 409, 'consent_conflict');
  }
});

app.post('/api/disclosure/:patientId', (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  if (session.selectedPatientId !== req.params.patientId) {
    return jsonError(res, 409, 'patient_mismatch');
  }
  const { resourceId, state } = req.body as { resourceId: string; state: 'held' | 'cleared' };
  let policy = store.ensurePolicy(req.params.patientId, session.selectedPatientName || req.params.patientId);
  policy = state === 'held' ? holdResource(policy, resourceId, 'demo') : clearResource(policy, resourceId, 'demo');
  store.savePolicy(policy);
  res.json({ policy: publicPolicy(policy) });
});

app.post('/api/ask', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const patientId = String(req.body.patientId || session.selectedPatientId || '');
  const question = String(req.body.question || '').trim();
  const viewerId = String(req.body.viewerId || session.activeViewerId);
  if (!patientId || session.selectedPatientId !== patientId) {
    return jsonError(res, 409, patientId ? 'patient_mismatch' : 'no_patient');
  }
  if (!question) return jsonError(res, 400, 'question_required');

  // Reject identity manipulation via body vs session: session viewer wins unless explicitly switched via /api/viewer
  const authenticatedViewer = session.activeViewerId;
  if (viewerId !== authenticatedViewer) {
    return jsonError(res, 400, 'viewer_mismatch');
  }

  try {
    const client = clientFor(session);
    const context = await loadContext(client, patientId, session);
    const policy = store.ensurePolicy(patientId, session.selectedPatientName || patientId);
    detectAndHoldNewResults(session.sessionId, patientId, context, policy);
    const clientHistory = sanitizeHistory(req.body.history);
    const history = mergeHistory(
      store.getChatTurns(session.sessionId, patientId, authenticatedViewer),
      clientHistory,
    );
    const run = await runAgentQuestion({
      client,
      context,
      policy: store.getPolicy(patientId)!,
      viewerId: authenticatedViewer,
      question,
      history,
      openaiApiKey: process.env.OPENAI_API_KEY,
      openaiModel: process.env.OPENAI_MODEL,
      memory: memoryService,
      onConsentUpdate: (next) => store.savePolicy(next),
    });
    store.addRun(run);
    store.appendChatTurns(session.sessionId, patientId, authenticatedViewer, [
      { role: 'user', content: question },
      { role: 'assistant', content: run.answer.answer },
    ]);
    res.json({
      freshness: context.fetchedAt,
      run,
      suggestions: suggestionsForViewer(context, store.getPolicy(patientId)!, authenticatedViewer),
      memoriesUsed: run.memoriesUsed || [],
      memoriesWritten: run.memoriesWritten || [],
    });
  } catch (err) {
    respondAnimaError(res, err);
  }
});

/**
 * Kindred-aligned Ask streaming: POST text/event-stream with `data: {AskStreamEvent}\n\n`
 * (same event shapes as the former WS path; unnamed SSE frames like Kindred `/api/events`).
 */
app.post('/api/ask/stream', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;

  const patientId = String(req.body.patientId || session.selectedPatientId || '');
  const question = String(req.body.question || '').trim();
  const viewerId = String(req.body.viewerId || session.activeViewerId);
  const authenticatedViewer = session.activeViewerId;

  const send = (event: AskStreamEvent) => {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const fail = (code: CareCircleErrorCode, status = 400) => {
    if (!res.headersSent) {
      res.status(status);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
    }
    send({ type: 'error', message: humanMessage(code), code });
    res.end();
  };

  if (!patientId || session.selectedPatientId !== patientId) {
    return fail(patientId ? 'patient_mismatch' : 'no_patient', 409);
  }
  if (!question) return fail('question_required', 400);
  if (viewerId !== authenticatedViewer) return fail('viewer_mismatch', 400);

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof (res as express.Response & { flushHeaders?: () => void }).flushHeaders === 'function') {
    (res as express.Response & { flushHeaders: () => void }).flushHeaders();
  }

  const keepalive = setInterval(() => {
    if (res.writableEnded) return;
    try {
      res.write(`: ping\n\n`);
    } catch {
      /* closed */
    }
  }, 15000);

  req.on('close', () => clearInterval(keepalive));

  try {
    send({ type: 'status', message: 'Retrieving…' });
    const { run, suggestions } = await executeAsk({
      session,
      patientId,
      viewerId: authenticatedViewer,
      question,
      history: sanitizeHistory(req.body.history),
      onEvent: (event) => {
        if (event.type !== 'final') send(event);
      },
    });
    send({
      type: 'final',
      run,
      memoriesUsed: run.memoriesUsed || [],
      memoriesWritten: run.memoriesWritten || [],
      suggestions,
    });
    clearInterval(keepalive);
    res.end();
  } catch (err) {
    clearInterval(keepalive);
    if (err instanceof AnimaClientError) {
      send({ type: 'error', message: humanizeAnimaError(err), code: err.kind });
      res.end();
      return;
    }
    console.error(err);
    send({ type: 'error', message: humanMessage('internal'), code: 'internal' });
    res.end();
  }
});

app.get('/api/appointments', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const date = String(req.query.date || new Date().toISOString().slice(0, 10));
  try {
    const client = clientFor(session);
    const book = await client.getAppointments('gp', date);
    res.json({ date, book, notice: 'Slots are availability only — not a confirmed booking.' });
  } catch (err) {
    respondAnimaError(res, err);
  }
});

app.post('/api/appointments/request', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  // Safe assistance: structure a request; do NOT book unless confirmBook + exact slot provided
  const { confirmBook, slot, reason, preference } = req.body as {
    confirmBook?: boolean;
    slot?: { sessionId: string; sessionVersion: number; startsAt: string; title?: string };
    reason?: string;
    preference?: string;
  };
  if (!confirmBook || !slot?.sessionId || !slot?.startsAt || slot.sessionVersion == null) {
    return res.json({
      stage: 'awaiting_confirmation',
      notice:
        'Slots and preferences only — booking not submitted. Confirm an exact slot (confirmBook + sessionId, sessionVersion, startsAt) to attempt book_appointment.',
      draft: { reason, preference, slot },
    });
  }
  if (!session.selectedPatientId) return jsonError(res, 400, 'no_patient');
  try {
    const client = clientFor(session);
    const result = await client.postAction(
      'gp',
      {
        type: 'book_appointment',
        sessionId: slot.sessionId,
        sessionVersion: slot.sessionVersion,
        startsAt: slot.startsAt,
        patientId: session.selectedPatientId,
        title: slot.title || reason || 'CareCircle requested appointment',
      },
      cryptoRandom(),
    );
    res.json({
      stage: 'confirmed',
      notice: 'Booking submitted to Anima via book_appointment.',
      result,
    });
  } catch (err) {
    if (err instanceof AnimaClientError) {
      return jsonError(res, animaStatusForKind(err.kind), 'booking_not_submitted', {
        animaStatus: err.status,
        animaDetail: err.kind,
      });
    }
    respondAnimaError(res, err);
  }
});

app.post('/api/clock/advance', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const minutes = Number(req.body.advanceMinutes || 121);
  try {
    const client = clientFor(session);
    const clock = await client.advanceClock(minutes);
    store.updateSession(session.sessionId, { lastSyncAt: new Date().toISOString() });
    res.json({ clock, notice: 'Simulation clock advanced (paused). Refresh patient context for new events.' });
  } catch (err) {
    respondAnimaError(res, err);
  }
});

app.post('/api/demo/reset', (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  store.resetCareCircleState(session.selectedPatientId);
  if (session.selectedPatientId) {
    store.ensurePolicy(session.selectedPatientId, session.selectedPatientName || session.selectedPatientId);
  }
  res.json({ ok: true });
});

app.get('/api/runs', (req, res) => {
  const session = requireSession(req, res);
  if (!session?.selectedPatientId) return jsonError(res, 400, 'no_patient');
  res.json({ runs: store.listRuns(session.selectedPatientId) });
});

function publicPolicy(policy: ConsentPolicyState) {
  const family = policy.viewers.filter((v) => v.viewerId !== 'patient');
  return {
    patientId: policy.patientId,
    policyVersion: policy.policyVersion,
    accessModel: 'kindred_sharing_levels',
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
  session: NonNullable<ReturnType<typeof store.getSession>>,
) {
  const sites = (session.scopes?.length ? session.scopes : ['gp', 'hospital', 'pharmacy']).filter((s) =>
    ['gp', 'hospital', 'pharmacy', 'community', 'diagnostics', 'referrals', 'wearables'].includes(s),
  );
  const uniqueSites = [...new Set(sites.length ? sites : ['gp', 'hospital', 'pharmacy'])];
  const siteResources: { site: string; resources: import('./types/domain.js').AnimaResource[]; now?: number }[] = [];
  const errors: { site: string; message: string }[] = [];
  for (const site of uniqueSites) {
    try {
      const view = await client.getView(site, patientId, 500, 0);
      siteResources.push({ site, resources: view.resources || [], now: view.now });
    } catch (err) {
      errors.push({
        site,
        message: err instanceof Error ? err.message : 'view failed',
      });
    }
  }
  if (!siteResources.length && errors.length) {
    throw new AnimaClientError(humanMessage('unavailable'), 'unavailable');
  }
  store.updateSession(session.sessionId, { lastSyncAt: new Date().toISOString() });
  return buildClinicalContext({ patientId, siteResources, errors });
}

function detectAndHoldNewResults(
  sessionId: string,
  patientId: string,
  context: ReturnType<typeof buildClinicalContext>,
  policy: ConsentPolicyState,
) {
  const session = store.getSession(sessionId);
  if (!session) return;
  const known = new Set(session.knownResourceIds[patientId] || []);
  const labResourceIds = [
    ...new Set(
      context.measurements.map((m) => m.resourceId).concat(
        context.events.filter((e) => e.informationClass === 'laboratory_results').map((e) => e.resourceId),
      ),
    ),
  ];
  let nextPolicy = policy;
  const firstSync = known.size === 0;
  for (const id of labResourceIds) {
    if (!known.has(id) && !firstSync) {
      nextPolicy = holdResource(nextPolicy, id, 'system');
    }
    known.add(id);
  }
  store.updateSession(sessionId, {
    knownResourceIds: { ...session.knownResourceIds, [patientId]: [...known] },
  });
  if (nextPolicy !== policy) store.savePolicy(nextPolicy);
}

function respondAnimaError(res: express.Response, err: unknown) {
  if (err instanceof AnimaClientError) {
    const code: CareCircleErrorCode = err.kind;
    return res.status(animaStatusForKind(err.kind)).json({
      error: code,
      message: humanizeAnimaError(err),
      animaStatus: err.status,
      liveData: false,
    });
  }
  console.error(err);
  return jsonError(res, 500, 'internal');
}

function cryptoRandom() {
  return globalThis.crypto?.randomUUID?.() || `cc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function executeAsk(input: {
  session: NonNullable<ReturnType<typeof store.getSession>>;
  patientId: string;
  viewerId: string;
  question: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  onEvent?: (event: AskStreamEvent) => void;
}) {
  const client = clientFor(input.session);
  const context = await loadContext(client, input.patientId, input.session);
  const policy = store.ensurePolicy(input.patientId, input.session.selectedPatientName || input.patientId);
  detectAndHoldNewResults(input.session.sessionId, input.patientId, context, policy);
  const history = mergeHistory(
    store.getChatTurns(input.session.sessionId, input.patientId, input.viewerId),
    sanitizeHistory(input.history),
  );
  const run = await runAgentQuestion({
    client,
    context,
    policy: store.getPolicy(input.patientId)!,
    viewerId: input.viewerId,
    question: input.question,
    history,
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiModel: process.env.OPENAI_MODEL,
    memory: memoryService,
    onConsentUpdate: (next) => store.savePolicy(next),
    onEvent: input.onEvent,
  });
  store.addRun(run);
  store.appendChatTurns(input.session.sessionId, input.patientId, input.viewerId, [
    { role: 'user', content: input.question },
    { role: 'assistant', content: run.answer.answer },
  ]);
  const suggestions = suggestionsForViewer(context, store.getPolicy(input.patientId)!, input.viewerId);
  return { context, run, suggestions };
}

function sanitizeHistory(raw: unknown): { role: 'user' | 'assistant'; content: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const item of raw.slice(-8)) {
    if (!item || typeof item !== 'object') continue;
    const role = (item as { role?: string }).role;
    const content = String((item as { content?: string }).content || '').trim();
    if ((role === 'user' || role === 'assistant') && content && content.length < 4000) {
      out.push({ role, content });
    }
  }
  return out;
}

/** Prefer longer client-provided thread when present; else stored turns. Cap at 6 prior turns. */
function mergeHistory(
  stored: { role: 'user' | 'assistant'; content: string }[],
  client: { role: 'user' | 'assistant'; content: string }[],
) {
  const base = client.length >= stored.length ? client : stored;
  return base.slice(-6);
}

app.listen(PORT, () => {
  console.log(`CareCircle API on http://localhost:${PORT}`);
  console.log(`Ask SSE POST http://localhost:${PORT}/api/ask/stream`);
  console.log(
    `ANIMA_API_KEY: ${process.env.ANIMA_API_KEY ? 'set' : 'missing'} | OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? 'set' : 'missing'}`,
  );
});
