import './env.js';
import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { rootDir } from './env.js';
import { AnimaClient, AnimaClientError, normalisePatientSearchResponse } from './anima/client.js';
import { buildClinicalContext } from './anima/normalise.js';
import { runAgentQuestion, suggestionsForViewer } from './agent/harness.js';
import {
  clearResource,
  evaluateConsent,
  holdResource,
  updateGrants,
  type ConsentPolicyState,
} from './consent/policy.js';
import { CareCircleStore } from './store/store.js';
import type { InformationClass } from './types/domain.js';

const dataDir = path.resolve(rootDir, process.env.CARE_CIRCLE_DATA_DIR || './data');
const store = new CareCircleStore(dataDir);
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
    res.status(401).json({ error: 'missing_session', message: 'Connect to Anima first.' });
    return null;
  }
  const session = store.getSession(id);
  if (!session?.animaApiKey) {
    res.status(401).json({ error: 'disconnected', message: 'Simulator session missing or disconnected.' });
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
      return res.status(400).json({
        error: 'missing_key',
        message: 'Provide apiKey, or teamName, or set ANIMA_API_KEY / ANIMA_TEAM_NAME.',
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
  if (!patientId) return res.status(400).json({ error: 'patientId required' });
  try {
    const client = clientFor(session);
    // Verify patient exists via search by ID — never trust client alone
    const raw = await client.searchPatients('gp', patientId, 0);
    const { items } = normalisePatientSearchResponse(raw);
    const match = items.find((p) => p.id === patientId);
    if (!match) {
      return res.status(404).json({
        error: 'patient_not_in_world',
        message: `Patient ${patientId} was not returned by live Anima search. Return to search.`,
      });
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
    return res.status(409).json({ error: 'patient_mismatch', message: 'Selected patient does not match session.' });
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
  if (!patientId) return res.status(400).json({ error: 'no_patient' });
  const policy = store.ensurePolicy(patientId, session.selectedPatientName || patientId);
  if (!policy.viewers.some((v) => v.viewerId === viewerId)) {
    return res.status(400).json({ error: 'unknown_viewer' });
  }
  store.updateSession(session.sessionId, { activeViewerId: viewerId });
  res.json({ session: store.publicSessionView(store.getSession(session.sessionId)!), policy: publicPolicy(policy) });
});

app.get('/api/consent/:patientId', (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  if (session.selectedPatientId !== req.params.patientId) {
    return res.status(409).json({ error: 'patient_mismatch' });
  }
  const policy = store.ensurePolicy(req.params.patientId, session.selectedPatientName || req.params.patientId);
  res.json({ policy: publicPolicy(policy) });
});

app.put('/api/consent/:patientId', (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  if (session.selectedPatientId !== req.params.patientId) {
    return res.status(409).json({ error: 'patient_mismatch' });
  }
  if (session.activeViewerId !== 'patient') {
    return res.status(403).json({ error: 'only_patient_may_edit_consent' });
  }
  try {
    const policy = store.ensurePolicy(req.params.patientId, session.selectedPatientName || req.params.patientId);
    const { viewerId, updates, expectedVersion } = req.body as {
      viewerId: string;
      updates: Partial<Record<InformationClass, boolean>>;
      expectedVersion: number;
    };
    const next = updateGrants(policy, viewerId, updates || {}, Number(expectedVersion), 'patient');
    store.savePolicy(next);
    res.json({ policy: publicPolicy(next) });
  } catch (err) {
    res.status(409).json({ error: 'consent_conflict', message: err instanceof Error ? err.message : 'conflict' });
  }
});

app.post('/api/disclosure/:patientId', (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  if (session.selectedPatientId !== req.params.patientId) {
    return res.status(409).json({ error: 'patient_mismatch' });
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
    return res.status(409).json({ error: 'patient_mismatch', message: 'Bind a patient before asking.' });
  }
  if (!question) return res.status(400).json({ error: 'question_required' });

  // Reject identity manipulation via body vs session: session viewer wins unless explicitly switched via /api/viewer
  const authenticatedViewer = session.activeViewerId;
  if (viewerId !== authenticatedViewer) {
    return res.status(400).json({
      error: 'viewer_mismatch',
      message: 'Viewer must match session. Use the viewer switcher; natural-language identity claims are ignored.',
    });
  }

  try {
    const client = clientFor(session);
    const context = await loadContext(client, patientId, session);
    const policy = store.ensurePolicy(patientId, session.selectedPatientName || patientId);
    detectAndHoldNewResults(session.sessionId, patientId, context, policy);
    const run = await runAgentQuestion({
      client,
      context,
      policy: store.getPolicy(patientId)!,
      viewerId: authenticatedViewer,
      question,
      openaiApiKey: process.env.OPENAI_API_KEY,
      openaiModel: process.env.OPENAI_MODEL,
    });
    store.addRun(run);
    res.json({
      freshness: context.fetchedAt,
      run,
      suggestions: suggestionsForViewer(context, store.getPolicy(patientId)!, authenticatedViewer),
    });
  } catch (err) {
    respondAnimaError(res, err);
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
        'Appointment assistance prepared a request only. Provide confirmBook=true with exact sessionId, sessionVersion, startsAt to attempt book_appointment.',
      draft: { reason, preference, slot },
    });
  }
  if (!session.selectedPatientId) return res.status(400).json({ error: 'no_patient' });
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
  if (!session?.selectedPatientId) return res.status(400).json({ error: 'no_patient' });
  res.json({ runs: store.listRuns(session.selectedPatientId) });
});

function publicPolicy(policy: ConsentPolicyState) {
  return {
    patientId: policy.patientId,
    policyVersion: policy.policyVersion,
    viewers: policy.viewers,
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
    throw new AnimaClientError(errors.map((e) => `${e.site}: ${e.message}`).join('; '), 'unavailable');
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
    const status =
      err.kind === 'unauthorized'
        ? 401
        : err.kind === 'forbidden'
          ? 403
          : err.kind === 'not_found'
            ? 404
            : err.kind === 'conflict'
              ? 409
              : err.kind === 'bad_request'
                ? 400
                : err.kind === 'malformed'
                  ? 502
                  : 503;
    return res.status(status).json({
      error: err.kind,
      message: err.message,
      animaStatus: err.status,
      liveData: false,
    });
  }
  console.error(err);
  res.status(500).json({ error: 'internal', message: err instanceof Error ? err.message : 'unknown' });
}

function cryptoRandom() {
  return globalThis.crypto?.randomUUID?.() || `cc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

app.listen(PORT, () => {
  console.log(`CareCircle API on http://localhost:${PORT}`);
  console.log(`ANIMA_API_KEY: ${process.env.ANIMA_API_KEY ? 'set' : 'missing'} | OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? 'set' : 'missing'}`);
});
