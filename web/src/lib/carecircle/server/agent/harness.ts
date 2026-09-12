/**
 * Ask CareCircle orchestrator.
 *
 * Safety gates (code, not model):
 * 1. Patient-bound catalogue
 * 2. Consent + disclosure filter → permitted pack only
 * 3. beforeModel ADK hook blocks deny/hold clinical generation
 *
 * Model path (OpenAI Responses via ADK):
 * - Cacheable static system prefix
 * - Dynamic role + memories + permitted evidence at end
 * - Slim skills: get_permitted_evidence, appointment_assist, remember, update_consent
 *
 * Deterministic grounded draft always supplies facts/citations/viz; model may refine prose.
 */
import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { AnimaClient } from '../anima/client';
import { buildSuggestions } from '../anima/normalise';
import type { ClinicalContext } from '../types/domain';
import {
  evaluateConsent,
  filterEvidence,
  updateGrants,
  updateSharingLevel,
  type ConsentPolicyState,
  type EvidenceItem,
} from '../consent/policy';
import type {
  AgentAnswer,
  AgentRunResult,
  AppointmentAssist,
  InformationClass,
  Measurement,
  NormalisedEvent,
  ToolObservation,
} from '../types/domain';
import {
  createAskAgent,
  createCareCircleAdkApp,
  parseToolTrace,
  type ToolTraceItem,
} from './adkApp';
import type { AskEventSink } from './events';
import {
  buildDeterministicAnswer,
  buildPermittedPack,
  buildVisualisation,
  catalogueEvidence,
  clarifyAppointment,
  classifyAskIntent,
  isAppointmentIntent,
  isDocumentIntent,
  isFollowUpQuestion,
  isLabIntent,
  prefersShortPlain,
  proseFromFacts,
  proseMatchesFacts,
  reconcileRefinedProse,
  formatAskProse,
  sanitizeAnswerCitations,
  selectLabMeasurements,
  type ChatTurn,
} from './grounding';
import {
  ScopedMemoryService,
  type CareCircleMemoryItem,
  type MemoryKind,
  memoryKinds,
} from './memoryStore';
import { PROMPT_VERSION, REFINE_STYLE_INSTRUCTIONS } from './prompts';
import { buildUserFacingPolicyNotice, patientFirstName } from '../consent/messages';

/** Align Ask refine with Kindred companion model when possible. */
export function resolveAskModel(explicit?: string | null): string {
  const askOverride = (explicit && explicit.trim()) || process.env.OPENAI_MODEL?.trim() || '';
  const companion = process.env.AGENT_MODEL?.trim() || '';
  // Legacy Ask default was gpt-4o-mini — treat it as unset so Ask tracks Kindred AGENT_MODEL.
  if (askOverride && askOverride !== 'gpt-4o-mini') return askOverride;
  return companion || askOverride || 'gpt-5.6-sol';
}

export type RunAgentInput = {
  client: AnimaClient;
  context: ClinicalContext;
  policy: ConsentPolicyState;
  viewerId: string;
  question: string;
  /** Recent user/assistant turns for this patient+viewer (not clinical memory). */
  history?: ChatTurn[];
  openaiApiKey?: string;
  openaiModel?: string;
  memory: ScopedMemoryService;
  /** Optional live consent mutation callback (patient-only tool). */
  onConsentUpdate?: (policy: ConsentPolicyState) => void | Promise<void>;
  onEvent?: AskEventSink;
};

export async function runAgentQuestion(input: RunAgentInput): Promise<AgentRunResult> {
  const started = Date.now();
  const queryId = nanoid(10);
  const runId = nanoid(10);
  const emit = input.onEvent || (() => undefined);
  const modelName = resolveAskModel(input.openaiModel);
  /** True once any token has been sent for this ask (so we can clear before a replacement). */
  let tokensEmitted = false;

  const emitStatus = (message: string) => emit({ type: 'status', message });
  const emitStreamReset = () => {
    if (!tokensEmitted) return;
    emit({ type: 'stream_reset' });
    tokensEmitted = false;
  };
  /** Emit only final user-facing prose (chunked for caret UX). Never dump tool JSON. */
  const emitAnswerTokens = (text: string) => {
    const clean = String(text || '').trim();
    if (!clean) return;
    emitStreamReset();
    emitStatus('Writing…');
    const chunk = 28;
    for (let i = 0; i < clean.length; i += chunk) {
      emit({ type: 'token', text: clean.slice(i, i + chunk) });
      tokensEmitted = true;
    }
  };

  emitStatus('Looking through the record…');

  const bag: {
    evidence: EvidenceItem[];
    policyDecision?: ReturnType<typeof evaluateConsent>;
    allowedMeasurements: Measurement[];
    allowedEvents: NormalisedEvent[];
    appointmentAssist?: AppointmentAssist;
    answer?: AgentAnswer;
    memoriesUsed: CareCircleMemoryItem[];
    memoriesWritten: CareCircleMemoryItem[];
    policy: ConsentPolicyState;
  } = {
    evidence: [],
    allowedMeasurements: [],
    allowedEvents: [],
    memoriesUsed: [],
    memoriesWritten: [],
    policy: input.policy,
  };

  // ADK lifecycle noise stays off the wire — client only sees calm status / answer tokens.
  const app = createCareCircleAdkApp();

  const appendTrace = (
    ctx: { state: { toolTraceJson?: string; update: (p: Record<string, unknown>) => void } },
    item: ToolTraceItem,
  ) => {
    const prev = parseToolTrace(ctx.state.toolTraceJson);
    ctx.state.update({ toolTraceJson: JSON.stringify([...prev, item]) });
  };

  const viewer = bag.policy.viewers.find((v) => v.viewerId === input.viewerId);
  const viewerRole = viewer?.relationship || 'family_member';
  const selfViewer = bag.policy.viewers.find((v) => v.relationship === 'self');
  const addressName = patientFirstName(
    viewerRole === 'self' || input.viewerId === 'patient'
      ? selfViewer?.displayName || viewer?.displayName
      : viewer?.displayName,
  );
  const patientBrief = buildAskPatientBrief({
    patientId: input.context.patientId,
    patientDisplayName: selfViewer?.displayName,
    addressName,
    viewerRole,
    omitSoftContext:
      classifyAskIntent(input.question, input.history) === 'appointment' &&
      !/\b(prefer|preference|matters|contact)\b/i.test(input.question),
  });

  // --- Slim model skills (not observability micro-tools) ---
  const getPermittedEvidenceTool = app.tool({
    name: 'get_permitted_evidence',
    description:
      'Return the consent-filtered evidence pack already prepared for this viewer. Does not bypass consent.',
    schema: z.object({}),
    execute: (ctx) => {
      const pack = safeJson(ctx.state.permittedEvidencePackJson, {});
      return { outcome: ctx.state.policyOutcome, pack };
    },
  });

  const appointmentAssistTool = app.tool({
    name: 'appointment_assist',
    description:
      'Clarify appointment preference vs request vs available slots vs confirmed booking. Never fakes a booking.',
    schema: z.object({
      question: z.string().nullable().optional(),
    }),
    execute: async (ctx) => {
      const t0 = Date.now();
      const q = String(ctx.args.question || ctx.state.question || input.question);
      const assist = await clarifyAppointment(input.client, bag.allowedEvents, q);
      bag.appointmentAssist = assist;
      ctx.state.update({ appointmentStage: assist.stage });
      emit({ type: 'tool', tool: 'appointment_assist', status: 'ok', detail: assist.stage });
      appendTrace(ctx, {
        tool: 'appointment_assist',
        status: 'ok',
        latencyMs: Date.now() - t0,
        detail: assist.stage,
        evidenceCount: assist.availableSlots?.length || 0,
      });
      return {
        stage: assist.stage,
        notice: assist.notice,
        preferenceSummary: assist.preferenceSummary,
        requestSummary: assist.requestSummary,
        availableSlots: assist.availableSlots,
        confirmed: assist.confirmed,
      };
    },
  });

  const rememberTool = app.tool({
    name: 'remember',
    description:
      'Persist a short UX memory for this viewer+patient only (prefs, clarifications, consent summaries already known). Never store raw lab values or protected clinical dumps.',
    schema: z.object({
      kind: z.enum(memoryKinds),
      text: z.string().max(280),
    }),
    execute: async (ctx) => {
      const t0 = Date.now();
      const kind = ctx.args.kind as MemoryKind;
      const saved = await input.memory.remember({
        patientId: input.context.patientId,
        viewerId: input.viewerId,
        kind,
        text: ctx.args.text,
      });
      if (saved) bag.memoriesWritten.push(saved);
      emit({
        type: 'tool',
        tool: 'remember',
        status: saved ? 'ok' : 'skipped',
        detail: saved ? saved.content : 'rejected_unsafe_or_empty',
      });
      appendTrace(ctx, {
        tool: 'remember',
        status: saved ? 'ok' : 'skipped',
        latencyMs: Date.now() - t0,
        detail: saved ? `${kind}: ${saved.content}` : 'rejected',
      });
      const written = safeJson(ctx.state.memoriesWrittenJson, [] as CareCircleMemoryItem[]);
      if (saved) {
        ctx.state.update({ memoriesWrittenJson: JSON.stringify([...written, saved]) });
      }
      return saved
        ? { ok: true, id: saved.id, kind: saved.metadata.kind }
        : { ok: false, reason: 'unsafe_or_empty' };
    },
  });

  const updateConsentTool = app.tool({
    name: 'update_consent',
    description:
      'Patient-only: set a Kindred sharing level (everything | practical | updates) for a family viewer. Prefer levels over raw class toggles. Rejected for non-patient viewers.',
    schema: z.object({
      targetViewerId: z.string(),
      sharingLevel: z.enum(['everything', 'practical', 'updates']).optional(),
      informationClass: z.string().optional(),
      allowed: z.boolean().optional(),
    }),
    execute: async (ctx) => {
      const t0 = Date.now();
      if (input.viewerId !== 'patient') {
        emit({ type: 'tool', tool: 'update_consent', status: 'error', detail: 'patient_only' });
        appendTrace(ctx, {
          tool: 'update_consent',
          status: 'error',
          latencyMs: Date.now() - t0,
          detail: 'patient_only',
        });
        return { ok: false, error: 'only_patient_may_edit_consent' };
      }
      try {
        const level = ctx.args.sharingLevel;
        const next =
          level === 'everything' || level === 'practical' || level === 'updates'
            ? updateSharingLevel(bag.policy, ctx.args.targetViewerId, level, bag.policy.policyVersion, 'patient')
            : updateGrants(
                bag.policy,
                ctx.args.targetViewerId,
                {
                  [ctx.args.informationClass as InformationClass]: Boolean(ctx.args.allowed),
                },
                bag.policy.policyVersion,
                'patient',
              );
        await input.onConsentUpdate?.(next);
        bag.policy = next;
        const detail = level
          ? `${ctx.args.targetViewerId}:level=${level}`
          : `${ctx.args.targetViewerId}:${ctx.args.informationClass}=${ctx.args.allowed}`;
        emit({ type: 'tool', tool: 'update_consent', status: 'ok', detail });
        appendTrace(ctx, {
          tool: 'update_consent',
          status: 'ok',
          latencyMs: Date.now() - t0,
          detail,
        });
        return { ok: true, policyVersion: next.policyVersion };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'consent_update_failed';
        emit({ type: 'tool', tool: 'update_consent', status: 'error', detail: message });
        appendTrace(ctx, {
          tool: 'update_consent',
          status: 'error',
          latencyMs: Date.now() - t0,
          detail: message,
        });
        return { ok: false, error: message };
      }
    },
  });

  // --- Code safety pipeline (not model-routed) ---
  const prepareStep = app.step({
    name: 'prepare_consent_and_memory',
    execute: async (ctx) => {
      const t0 = Date.now();
      bag.evidence = catalogueEvidence(input.context);
      emit({ type: 'tool', tool: 'patient.context.read', status: 'ok', detail: input.context.patientId });
      emitStatus('Looking through the record…');
      appendTrace(ctx, {
        tool: 'patient.context.read',
        status: 'ok',
        latencyMs: Date.now() - t0,
        detail: `patient=${input.context.patientId}`,
        evidenceCount: bag.evidence.length,
      });

      const t1 = Date.now();
      emitStatus('Checking what you can see…');
      const decision = evaluateConsent({
        policy: bag.policy,
        viewerId: input.viewerId,
        purpose: 'understand',
        evidence: bag.evidence,
      });
      bag.policyDecision = decision;
      bag.allowedMeasurements = input.context.measurements.filter((m) =>
        decision.allowedEvidenceIds.includes(m.evidenceId),
      );
      bag.allowedEvents = input.context.events.filter((e) => decision.allowedEvidenceIds.includes(e.evidenceId));
      const allowedEvidence = filterEvidence(bag.evidence, decision);
      const pack = buildPermittedPack({
        patientId: input.context.patientId,
        viewerId: input.viewerId,
        outcome: decision.outcome,
        measurements: bag.allowedMeasurements,
        events: bag.allowedEvents,
        allowedEvidenceIds: decision.allowedEvidenceIds,
        filteredCount: allowedEvidence.length,
      });

      bag.memoriesUsed = await input.memory.recall({
        patientId: input.context.patientId,
        viewerId: input.viewerId,
        question: input.question,
      });

      ctx.state.update({
        policyOutcome: decision.outcome,
        allowedEvidenceIdsJson: JSON.stringify(decision.allowedEvidenceIds),
        permittedEvidencePackJson: JSON.stringify(pack),
        memoriesJson: JSON.stringify(
          bag.memoriesUsed.map((m) => ({
            kind: m.metadata.kind,
            text: m.content,
          })),
        ),
        viewerRole,
      });

      emit({
        type: 'tool',
        tool: 'consent.evaluate',
        status: 'ok',
        detail: `outcome=${decision.outcome}`,
      });
      appendTrace(ctx, {
        tool: 'consent.evaluate',
        status: 'ok',
        latencyMs: Date.now() - t1,
        detail: `outcome=${decision.outcome}`,
        evidenceCount: decision.allowedEvidenceIds.length,
      });

      if (bag.memoriesUsed.length) {
        emit({
          type: 'tool',
          tool: 'memory.recall',
          status: 'ok',
          detail: `${bag.memoriesUsed.length} memories`,
        });
        appendTrace(ctx, {
          tool: 'memory.recall',
          status: 'ok',
          latencyMs: 0,
          detail: bag.memoriesUsed.map((m) => m.content).join('; ').slice(0, 200),
          evidenceCount: bag.memoriesUsed.length,
        });
      }
    },
  });

  const groundedDraftStep = app.step({
    name: 'grounded_draft',
    execute: async (ctx) => {
      const decision = bag.policyDecision!;
      const intent = classifyAskIntent(input.question, input.history);
      emit({ type: 'tool', tool: 'intent.classify', status: 'ok', detail: `intent=${intent}` });
      appendTrace(ctx, {
        tool: 'intent.classify',
        status: 'ok',
        latencyMs: 0,
        detail: `intent=${intent}`,
      });

      const policyNotice = buildUserFacingPolicyNotice({
        outcome: decision.outcome,
        reasonCodes: decision.reasonCodes,
        deniedInformationClasses: decision.deniedInformationClasses,
        intent,
        patientFirstName: patientFirstName(selfViewer?.displayName),
      });

      const primaryAppt =
        intent === 'appointment' ||
        (/^(please )?(find|book|schedule|check).*(appoint|slot)/i.test(input.question.trim()) &&
          intent !== 'lab' &&
          intent !== 'share_consent' &&
          intent !== 'vitals_bp');
      if (primaryAppt && decision.outcome !== 'deny' && decision.outcome !== 'hold') {
        emitStatus('Checking appointments…');
        bag.appointmentAssist = await clarifyAppointment(input.client, bag.allowedEvents, input.question);
        ctx.state.update({ appointmentStage: bag.appointmentAssist.stage });
        emit({
          type: 'tool',
          tool: 'appointment_assist',
          status: 'ok',
          detail: bag.appointmentAssist.stage,
        });
        appendTrace(ctx, {
          tool: 'appointment_assist',
          status: 'ok',
          latencyMs: 0,
          detail: bag.appointmentAssist.stage,
          evidenceCount: bag.appointmentAssist.availableSlots?.length || 0,
        });
      }

      // Capture explicit UX preferences from the question (viewer-scoped; no clinical dumps).
      const prefMatch = input.question.match(
        /\b(?:i prefer|prefer|please remember|remember that)\s+([^.?!]{8,120})/i,
      );
      if (prefMatch && intent !== 'share_consent' && intent !== 'vitals_bp') {
        const saved = await input.memory.remember({
          patientId: input.context.patientId,
          viewerId: input.viewerId,
          kind: 'preference',
          text: prefMatch[0].replace(/\s+/g, ' ').trim().slice(0, 280),
        });
        if (saved) {
          bag.memoriesWritten.push(saved);
          emit({ type: 'tool', tool: 'remember', status: 'ok', detail: saved.content });
          appendTrace(ctx, {
            tool: 'remember',
            status: 'ok',
            latencyMs: 0,
            detail: saved.content,
          });
        }
      }

      const visualisationSpec =
        intent === 'share_consent' || intent === 'vitals_bp'
          ? undefined
          : buildVisualisation(input.question, bag.allowedMeasurements, input.history);
      const memoryPref = bag.memoriesUsed
        .filter((m) => m.metadata.kind === 'preference' || m.metadata.kind === 'clarification' || m.metadata.kind === 'greeting')
        .map((m) => m.content)
        .slice(0, 2)
        .join(' · ');
      bag.answer = buildDeterministicAnswer({
        question: input.question,
        policyNotice: policyNotice || undefined,
        outcome: decision.outcome,
        measurements: bag.allowedMeasurements,
        events: bag.allowedEvents,
        visualisationSpec,
        appointmentAssist: bag.appointmentAssist,
        memoriesHint: intent === 'appointment' || intent === 'lab' ? memoryPref || undefined : undefined,
        history: input.history,
        viewerIsPatient: input.viewerId === 'patient' || viewerRole === 'self',
        addressName: addressName || undefined,
      });

      ctx.state.update({
        answerJson: JSON.stringify(bag.answer),
        modelLabel: 'deterministic-grounded',
      });
      appendTrace(ctx, {
        tool: 'answer.generate',
        status: 'ok',
        latencyMs: 0,
        detail:
          decision.outcome === 'deny' || decision.outcome === 'hold'
            ? 'refused without model'
            : `deterministic_grounded:${intent}`,
      });
    },
  });

  const modelStep = app.step({
    name: 'responses_ask_agent',
    execute: async (ctx) => {
      const outcome = String(ctx.state.policyOutcome || '');
      const intent = classifyAskIntent(input.question, input.history);
      // Keep share/consent and empty-BP answers deterministic — model must not invent labs/appts.
      const lockDeterministic =
        intent === 'share_consent' ||
        (intent === 'vitals_bp' && !(bag.answer?.facts || []).length);
      const canModel =
        Boolean(input.openaiApiKey) &&
        !lockDeterministic &&
        outcome !== 'deny' &&
        outcome !== 'hold' &&
        outcome !== 'pending' &&
        Boolean(bag.answer);

      if (!canModel) {
        appendTrace(ctx, {
          tool: 'answer.refine',
          status: 'skipped',
          latencyMs: 0,
          detail: lockDeterministic
            ? `deterministic_lock:${intent}`
            : input.openaiApiKey
              ? `policy=${outcome}`
              : 'no_openai_key',
        });
        emit({
          type: 'tool',
          tool: 'answer.refine',
          status: 'skipped',
          detail: lockDeterministic
            ? `deterministic_lock:${intent}`
            : input.openaiApiKey
              ? `policy=${outcome}`
              : 'no_openai_key',
        });
        // No refine — stream the deterministic answer once (it is the final).
        if (bag.answer?.answer) emitAnswerTokens(bag.answer.answer);
        ctx.respond(bag.answer?.answer || '');
        return;
      }

      process.env.OPENAI_API_KEY = input.openaiApiKey;
      const t0 = Date.now();
      emitStatus('Writing…');

      try {
        const tools = [getPermittedEvidenceTool, appointmentAssistTool, rememberTool, updateConsentTool];
        const askAgent = createAskAgent(app, modelName, tools);
        // Buffer ADK deltas only — never forward mid-tool drafts / pack dumps to the UI.
        let buffered = '';
        const facts = bag.answer?.facts || [];
        const short = prefersShortPlain(
          bag.memoriesUsed.map((m) => m.content).join(' '),
          input.question,
        );
        const followUp = isFollowUpQuestion(input.question, input.history);
        const labFocus = selectLabMeasurements(input.question, bag.allowedMeasurements, input.history);
        const recentHistory = (input.history || []).slice(-6);
        const prompt = [
          `Authenticated viewer: ${input.viewerId} (${viewerRole}).`,
          `Patient: ${input.context.patientId}.`,
          patientBrief ? `PATIENT_BRIEF: ${patientBrief}` : '',
          addressName ? `Address the viewer as ${addressName}.` : '',
          `Memories: ${JSON.stringify(bag.memoriesUsed.map((m) => ({ kind: m.metadata.kind, text: m.content })))}.`,
          recentHistory.length
            ? `RECENT_TURNS (same patient+viewer; follow-ups refer to these):\n${JSON.stringify(recentHistory)}`
            : `RECENT_TURNS: []`,
          `STRUCTURED_FACTS (authoritative — clinical numbers/dates in your answer must match these):`,
          JSON.stringify(facts),
          `Draft answer (fallback): ${bag.answer?.answer || ''}`,
          `Question: ${input.question}`,
          REFINE_STYLE_INSTRUCTIONS,
          followUp || labFocus.focused
            ? `Focus: answer THIS question only. If it is a follow-up, do not repeat the full prior panel — focus on the asked analytes/topic (${labFocus.topicIds.join(', ') || 'as asked'}).`
            : intent === 'appointment'
              ? `Focus: appointment booking only — booked date/time/title, or say none is booked. Do not include preference notes, personal context, or "what matters".`
              : short
                ? `Focus: short plain language in warm paragraphs. No full panel dump.`
                : `Focus: concise highlights over a full dump unless asked.`,
        ]
          .filter(Boolean)
          .join('\n');

        // Fresh session so nested agent state does not collide with the pipeline session.
        const askSession = await app.sessions.create();
        askSession.state.update({
          patientId: input.context.patientId,
          viewerId: input.viewerId,
          viewerRole,
          question: input.question,
          policyOutcome: String(ctx.state.policyOutcome || ''),
          permittedEvidencePackJson: String(ctx.state.permittedEvidencePackJson || '{}'),
          memoriesJson: String(ctx.state.memoriesJson || '[]'),
          allowedEvidenceIdsJson: String(ctx.state.allowedEvidenceIdsJson || '[]'),
          toolTraceJson: '[]',
          memoriesWrittenJson: '[]',
        });

        // ADK StreamResult is async-iterable; the iterator completion value is the RunResult.
        const stream = app.run(askAgent, { session: askSession as never, input: prompt });
        const iter = stream[Symbol.asyncIterator]();
        let nested: { output?: { text?: string } } | undefined;
        while (true) {
          const step = await iter.next();
          if (step.done) {
            nested = step.value as { output?: { text?: string } } | undefined;
            break;
          }
          const event = step.value;
          if (event.type === 'assistant_delta' && 'text' in event && event.text) {
            // Cumulative snapshots vs incremental pieces — buffer only.
            const next = String(event.text);
            if (next.startsWith(buffered)) {
              buffered = next;
            } else if (buffered.startsWith(next)) {
              /* shrink / duplicate — ignore */
            } else {
              // New generation (e.g. after a tool round) — keep the latest draft only.
              buffered = next;
            }
          }
          if (event.type === 'tool_call' && 'name' in event && event.name) {
            // Tool rounds discard prior assistant drafts; UI stays on calm status.
            buffered = '';
            emitStatus(statusForToolName(String(event.name)));
          }
        }
        const text = String(nested?.output?.text || buffered || '').trim();
        const parsed = tryParseModelExtras(text);
        let prose = finalizeVisibleProse(text, parsed.answer);
        // If the model returned mostly JSON / fences, fall back to deterministic draft.
        if (!prose || looksLikeJsonProse(prose)) {
          prose = bag.answer?.answer || '';
        }
        const factMeasurements = bag.allowedMeasurements.filter((m) =>
          facts.some((f) => f.evidenceIds.includes(m.evidenceId)),
        );
        const stuck = stickRefinedProse({
          prose,
          facts,
          measurements: factMeasurements,
          question: input.question,
          history: input.history,
          memoriesHint: bag.memoriesUsed.map((m) => m.content).join(' '),
          recordedNextStep: bag.answer?.recordedNextStep?.text,
          addressName: addressName || undefined,
        });

        if (stuck.answer && bag.answer) {
          bag.answer = {
            ...bag.answer,
            answer: stuck.answer,
            uncertainty: parsed.uncertainty || bag.answer.uncertainty,
            appointmentAssist: bag.appointmentAssist || bag.answer.appointmentAssist,
          };
          // Stream only the grounded final prose — never the raw buffer / tool pack.
          emitAnswerTokens(stuck.answer);

          // Auto-remember short preference phrases the model flagged
          if (stuck.keptModelVoice) {
            for (const rem of parsed.remembered || []) {
              const saved = await input.memory.remember({
                patientId: input.context.patientId,
                viewerId: input.viewerId,
                kind: rem.kind,
                text: rem.text,
              });
              if (saved) bag.memoriesWritten.push(saved);
            }
          }

          ctx.state.update({
            answerJson: JSON.stringify(bag.answer),
            modelLabel:
              stuck.mode === 'fallback'
                ? 'deterministic-grounded-after-drift'
                : `openai-responses:${modelName}`,
          });
          appendTrace(ctx, {
            tool: 'answer.refine',
            status: 'ok',
            latencyMs: Date.now() - t0,
            detail: stuck.detail,
          });
          emit({
            type: 'tool',
            tool: 'answer.refine',
            status: 'ok',
            detail: stuck.detail,
          });
        } else {
          throw new Error('empty_model_output');
        }
      } catch (err) {
        // Fallback: Responses API via fetch (still not Chat Completions)
        try {
          emitStatus('Writing…');
          const refined = await refineWithResponsesApi({
            apiKey: input.openaiApiKey!,
            model: modelName,
            question: input.question,
            viewerId: input.viewerId,
            viewerRole,
            patientId: input.context.patientId,
            patientBrief,
            addressName: addressName || undefined,
            draft: bag.answer!,
            memories: bag.memoriesUsed,
            history: input.history,
            // Do not stream partial JSON from the HTTP body — emit once below.
          });
          if (refined && bag.answer) {
            const facts = bag.answer.facts || [];
            const cleaned = finalizeVisibleProse(refined.answer) || refined.answer;
            const candidate = looksLikeJsonProse(cleaned) ? '' : cleaned;
            const stuck = stickRefinedProse({
              prose: candidate,
              facts,
              measurements: bag.allowedMeasurements.filter((m) =>
                facts.some((f) => f.evidenceIds.includes(m.evidenceId)),
              ),
              question: input.question,
              history: input.history,
              recordedNextStep: bag.answer?.recordedNextStep?.text,
              addressName: addressName || undefined,
            });
            bag.answer = {
              ...bag.answer,
              answer: stuck.answer,
              uncertainty: refined.uncertainty || bag.answer.uncertainty,
            };
            emitAnswerTokens(stuck.answer);
            ctx.state.update({
              answerJson: JSON.stringify(bag.answer),
              modelLabel:
                stuck.mode === 'fallback'
                  ? 'deterministic-grounded-after-drift'
                  : `openai-responses:${modelName}`,
            });
            appendTrace(ctx, {
              tool: 'answer.refine',
              status: 'ok',
              latencyMs: Date.now() - t0,
              detail: stuck.detail === 'responses_api' ? 'responses api direct fallback' : stuck.detail,
            });
          } else {
            appendTrace(ctx, {
              tool: 'answer.refine',
              status: 'error',
              latencyMs: Date.now() - t0,
              detail: err instanceof Error ? err.message : 'model failed',
            });
            if (bag.answer?.answer) emitAnswerTokens(bag.answer.answer);
          }
        } catch (inner) {
          const detail = [
            err instanceof Error ? err.message : 'adk failed',
            inner instanceof Error ? inner.message : 'responses failed',
          ].join(' | ');
          appendTrace(ctx, {
            tool: 'answer.refine',
            status: 'error',
            latencyMs: Date.now() - t0,
            detail: detail.slice(0, 300),
          });
          if (bag.answer?.answer) emitAnswerTokens(bag.answer.answer);
        }
      }

      ctx.respond(bag.answer?.answer || '');
    },
  });

  const finalizeStep = app.step({
    name: 'finalize_safe_answer',
    execute: (ctx) => {
      if (bag.answer && bag.policyDecision) {
        const allowedIds = new Set(bag.policyDecision.allowedEvidenceIds);
        bag.answer = sanitizeAnswerCitations(bag.answer, allowedIds);
        if (bag.appointmentAssist) bag.answer.appointmentAssist = bag.appointmentAssist;
        ctx.state.update({ answerJson: JSON.stringify(bag.answer) });
      }
      ctx.respond(bag.answer?.answer || '');
    },
  });

  const pipeline = app.sequence({
    name: 'ask_carecircle',
    runnables: [prepareStep, groundedDraftStep, modelStep, finalizeStep],
  });

  const session = await app.sessions.create();
  session.state.update({
    runId,
    queryId,
    patientId: input.context.patientId,
    viewerId: input.viewerId,
    viewerRole,
    question: input.question,
    policyOutcome: 'pending',
    allowedEvidenceIdsJson: '[]',
    permittedEvidencePackJson: '{}',
    memoriesJson: '[]',
    memoriesWrittenJson: '[]',
    answerJson: '',
    modelLabel: 'deterministic-grounded',
    toolTraceJson: '[]',
    appointmentStage: '',
  });

  await app.run(pipeline, { session, input: input.question });

  const tools: ToolObservation[] = parseToolTrace(session.state.toolTraceJson).map((t) => ({
    tool: t.tool,
    status: t.status,
    latencyMs: t.latencyMs,
    detail: t.detail,
    evidenceCount: t.evidenceCount,
  }));

  if (!tools.some((t) => t.tool === 'consent.evaluate') && bag.policyDecision) {
    tools.unshift({
      tool: 'consent.evaluate',
      status: 'ok',
      latencyMs: 0,
      detail: `outcome=${bag.policyDecision.outcome}`,
      evidenceCount: bag.policyDecision.allowedEvidenceIds.length,
    });
  }

  await app.close().catch(() => undefined);

  const run: AgentRunResult = {
    runId,
    queryId,
    patientId: input.context.patientId,
    viewerId: input.viewerId,
    answer: bag.answer || {
      answer: 'CareCircle could not produce an answer.',
      facts: [],
      citations: [],
    },
    policy: bag.policyDecision || {
      decisionId: 'adk-incomplete',
      outcome: 'deny' as const,
      allowedEvidenceIds: [],
      allowedFieldsByEvidence: {},
      deniedInformationClasses: [],
      reasonCodes: ['adk_pipeline_incomplete'],
      userNotice: 'CareCircle could not complete consent evaluation for this ask.',
      policyVersion: input.policy.policyVersion,
    },
    tools,
    model: String(session.state.modelLabel || 'deterministic-grounded'),
    promptVersion: PROMPT_VERSION,
    latencyMs: Date.now() - started,
    memoriesUsed: bag.memoriesUsed.map((m) => ({
      id: m.id,
      kind: m.metadata.kind,
      text: m.content,
    })),
    memoriesWritten: bag.memoriesWritten.map((m) => ({
      id: m.id,
      kind: m.metadata.kind,
      text: m.content,
    })),
  };

  emit({
    type: 'final',
    run,
    memoriesUsed: run.memoriesUsed || [],
    memoriesWritten: run.memoriesWritten || [],
  });

  return run;
}

function safeJson<T>(raw: unknown, fallback: T): T {
  try {
    return JSON.parse(String(raw || '')) as T;
  } catch {
    return fallback;
  }
}

/** Calm status copy for tool rounds — never surface pack dumps or raw tool JSON. */
function statusForToolName(name: string): string {
  switch (name) {
    case 'get_permitted_evidence':
      return 'Looking through the record…';
    case 'appointment_assist':
      return 'Checking appointments…';
    case 'remember':
      return 'Saving preference…';
    case 'update_consent':
      return 'Updating access…';
    default:
      return 'Looking through the record…';
  }
}

function tryParseModelExtras(text: string): {
  answer?: string;
  uncertainty?: string;
  remembered?: { kind: MemoryKind; text: string }[];
} {
  try {
    const start = text.lastIndexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const obj = JSON.parse(text.slice(start, end + 1)) as {
        answer?: string;
        uncertainty?: string;
        remembered?: { kind: MemoryKind; text: string }[];
      };
      return obj;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function stripCodeFences(text: string): string {
  let t = text.trim();
  // ```json ... ``` or ``` ... ```
  const fenced = t.match(/^```(?:json|markdown|md|text)?\s*([\s\S]*?)```\s*$/i);
  if (fenced) return fenced[1].trim();
  t = t.replace(/```(?:json|markdown|md|text)?\s*([\s\S]*?)```/gi, (_, inner) => String(inner || '').trim());
  return t.trim();
}

function stripTrailingJson(text: string): string {
  let t = stripCodeFences(text);
  const start = t.lastIndexOf('\n{');
  if (start >= 0 && t.trimEnd().endsWith('}')) {
    return t.slice(0, start).trim();
  }
  // whole-message JSON
  if (t.trim().startsWith('{')) {
    try {
      const obj = JSON.parse(t) as { answer?: string };
      if (obj.answer) return String(obj.answer).trim();
    } catch {
      /* ignore */
    }
  }
  return t.trim();
}

/** True when visible text still looks like a JSON object/array (or fence residue). */
function looksLikeJsonProse(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^```/.test(t)) return true;
  if (!(t.startsWith('{') || t.startsWith('['))) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    // Incomplete / trailing JSON blobs still shouldn't reach the UI.
    return /"[a-zA-Z_]+"\s*:/.test(t) && (t.match(/[{[]/g) || []).length >= 2;
  }
}

function finalizeVisibleProse(text: string, fallbackAnswer?: string): string {
  const stripped = stripTrailingJson(text);
  if (stripped && !looksLikeJsonProse(stripped)) return stripped;
  if (fallbackAnswer && !looksLikeJsonProse(fallbackAnswer)) return fallbackAnswer.trim();
  return '';
}

/**
 * Direct OpenAI Responses API fallback (never Chat Completions).
 * Keeps static instructions first for cache friendliness.
 */
async function refineWithResponsesApi(input: {
  apiKey: string;
  model: string;
  question: string;
  viewerId: string;
  viewerRole: string;
  patientId: string;
  patientBrief?: string;
  addressName?: string;
  draft: AgentAnswer;
  memories: CareCircleMemoryItem[];
  history?: ChatTurn[];
}): Promise<{ answer: string; uncertainty?: string } | null> {
  const { STATIC_SYSTEM_PROMPT } = await import('./prompts');
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: input.model,
      store: false,
      temperature: 0.35,
      max_output_tokens: 700,
      // Stable prefix first for prompt-cache friendliness; dynamic pack last.
      input: [
        {
          role: 'system',
          content: STATIC_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: JSON.stringify({
            viewerId: input.viewerId,
            viewerRole: input.viewerRole,
            patientId: input.patientId,
            patientBrief: input.patientBrief || undefined,
            addressAs: input.addressName || undefined,
            memories: input.memories.map((m) => ({ kind: m.metadata.kind, text: m.content })),
            recentTurns: (input.history || []).slice(-6),
            facts: input.draft.facts,
            draftAnswer: input.draft.answer,
            question: input.question,
            instruction: `${REFINE_STYLE_INSTRUCTIONS} Prefer a prose answer body. If you must use JSON, return {answer, uncertainty} only — never put JSON in the visible answer field.`,
          }),
        },
      ],
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenAI Responses HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }
  const body = (await res.json()) as {
    output_text?: string;
    output?: { content?: { type: string; text?: string }[] }[];
  };
  let content = body.output_text || '';
  if (!content && Array.isArray(body.output)) {
    for (const item of body.output) {
      for (const part of item.content || []) {
        if (part.type === 'output_text' && part.text) content += part.text;
      }
    }
  }
  if (!content) return null;
  try {
    const parsed = JSON.parse(stripCodeFences(content)) as { answer?: string; uncertainty?: string };
    if (parsed.answer) {
      return { answer: finalizeVisibleProse(parsed.answer) || parsed.answer, uncertainty: parsed.uncertainty };
    }
  } catch {
    /* model sometimes returns prose */
  }
  const extras = tryParseModelExtras(content);
  const prose = finalizeVisibleProse(content, extras.answer);
  if (!prose) return null;
  return { answer: prose, uncertainty: extras.uncertainty };
}

/** Prefer refined companion prose; repair numbers; only then soft deterministic fallback. */
function stickRefinedProse(input: {
  prose: string;
  facts: { text: string; evidenceIds: string[] }[];
  measurements: Measurement[];
  question: string;
  history?: ChatTurn[];
  memoriesHint?: string;
  recordedNextStep?: string;
  addressName?: string;
}): { answer: string; detail: string; mode: 'ok' | 'repaired' | 'fallback'; keptModelVoice: boolean } {
  const raw = String(input.prose || '').trim();
  if (!raw) {
    return {
      answer: formatAskProse([
        proseFromFacts(input.facts, {
          short: prefersShortPlain(input.memoriesHint || '', input.question),
          labIntent: isLabIntent(input.question, input.history),
          docIntent: isDocumentIntent(input.question),
          apptIntent: isAppointmentIntent(input.question),
          memoriesHint: input.memoriesHint,
          recordedNextStep: input.recordedNextStep,
          question: input.question,
          addressName: input.addressName,
        }),
      ]),
      detail: 'empty_model_fallback',
      mode: 'fallback',
      keptModelVoice: false,
    };
  }

  if (proseMatchesFacts(raw, input.facts, input.measurements)) {
    return {
      answer: formatAskProse([raw]),
      detail: 'adk openai responses + slim skills',
      mode: 'ok',
      keptModelVoice: true,
    };
  }

  const repaired = reconcileRefinedProse(raw, input.facts, input.measurements);
  if (repaired) {
    return {
      answer: repaired,
      detail: 'numeric_repair_kept_prose',
      mode: 'repaired',
      keptModelVoice: true,
    };
  }

  return {
    answer: formatAskProse([
      proseFromFacts(input.facts, {
        short: prefersShortPlain(input.memoriesHint || '', input.question),
        labIntent: isLabIntent(input.question, input.history),
        docIntent: isDocumentIntent(input.question),
        apptIntent: isAppointmentIntent(input.question),
        memoriesHint: input.memoriesHint,
        recordedNextStep: input.recordedNextStep,
        question: input.question,
        addressName: input.addressName,
      }),
    ]),
    detail: 'numeric_drift_fallback',
    mode: 'fallback',
    keptModelVoice: false,
  };
}

/** Light patient brief (name + optional Kindred needs/goals) for Ask refine context. */
function buildAskPatientBrief(input: {
  patientId: string;
  patientDisplayName?: string;
  addressName?: string;
  viewerRole: string;
  /** Skip needs/goals/personal context (e.g. next-appointment asks). */
  omitSoftContext?: boolean;
}): string {
  const first =
    input.addressName ||
    patientFirstName(input.patientDisplayName) ||
    '';
  const bits: string[] = [];
  if (input.patientDisplayName) {
    bits.push(`${input.patientDisplayName} (record id ${input.patientId})`);
  } else if (first) {
    bits.push(`${first} (record id ${input.patientId})`);
  } else {
    bits.push(`Patient ${input.patientId}`);
  }
  bits.push(`Viewer role: ${input.viewerRole}.`);

  if (input.omitSoftContext) {
    return bits.join(' ');
  }

  try {
    // Optional soft context from Kindred companion when the same patient is loaded.
    // Relative require avoids pulling the store into the Ask module graph at build time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const kindredStore = require('../../../store') as {
      getState: () => {
        patientId?: string;
        patient?: { name?: string; needs?: string[]; goals?: string[]; context?: string };
        conditions?: { name: string }[];
      };
    };
    const state = kindredStore.getState();
    const p = state?.patient;
    const same =
      state?.patientId === input.patientId ||
      (p?.name &&
        input.patientDisplayName &&
        p.name.toLowerCase().includes(String(input.patientDisplayName).split(' ')[0].toLowerCase()));
    if (same && p) {
      const conditions = (state?.conditions || []).map((c) => c.name).filter(Boolean).slice(0, 6);
      if (conditions.length) bits.push(`Active problems on the GP record: ${conditions.join(', ')}.`);
      if (p.needs?.length) bits.push(`Recorded needs: ${p.needs.join(', ')}.`);
      if (p.goals?.length) bits.push(`What matters: ${p.goals.join('; ')}.`);
      if (p.context) bits.push(`Personal context: ${p.context.replace(/\s+/g, ' ').trim().slice(0, 220)}`);
    }
  } catch {
    /* companion store unavailable in this runtime — name-only brief is fine */
  }

  return bits.join(' ');
}

export function suggestionsForViewer(ctx: ClinicalContext, policy: ConsentPolicyState, viewerId: string) {
  const evidence = catalogueEvidence(ctx);
  const decision = evaluateConsent({ policy, viewerId, evidence });
  const allowedClasses = [
    ...new Set(
      evidence.filter((e) => decision.allowedEvidenceIds.includes(e.evidenceId)).map((e) => e.informationClass),
    ),
  ];
  const viewer = policy.viewers.find((v) => v.viewerId === viewerId);
  const classes =
    viewer?.relationship === 'self'
      ? ctx.recordClasses
      : allowedClasses.length
        ? allowedClasses
        : ctx.recordClasses.filter((c) =>
            policy.grants.some((g) => g.viewerId === viewerId && g.informationClass === c && g.allowed && !g.revokedAt),
          );
  return buildSuggestions(ctx, classes);
}
