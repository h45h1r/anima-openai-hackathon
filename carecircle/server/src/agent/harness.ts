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
import type { AnimaClient } from '../anima/client.js';
import { buildSuggestions } from '../anima/normalise.js';
import type { ClinicalContext } from '../types/domain.js';
import {
  evaluateConsent,
  filterEvidence,
  updateGrants,
  type ConsentPolicyState,
  type EvidenceItem,
} from '../consent/policy.js';
import type {
  AgentAnswer,
  AgentRunResult,
  AppointmentAssist,
  InformationClass,
  Measurement,
  NormalisedEvent,
  ToolObservation,
} from '../types/domain.js';
import {
  createAskAgent,
  createCareCircleAdkApp,
  parseToolTrace,
  type ToolTraceItem,
} from './adkApp.js';
import type { AskEventSink } from './events.js';
import {
  buildDeterministicAnswer,
  buildPermittedPack,
  buildVisualisation,
  catalogueEvidence,
  clarifyAppointment,
  sanitizeAnswerCitations,
} from './grounding.js';
import {
  ScopedMemoryService,
  type CareCircleMemoryItem,
  type MemoryKind,
  memoryKinds,
} from './memoryStore.js';
import { PROMPT_VERSION } from './prompts.js';

export type RunAgentInput = {
  client: AnimaClient;
  context: ClinicalContext;
  policy: ConsentPolicyState;
  viewerId: string;
  question: string;
  openaiApiKey?: string;
  openaiModel?: string;
  memory: ScopedMemoryService;
  /** Optional live consent mutation callback (patient-only tool). */
  onConsentUpdate?: (policy: ConsentPolicyState) => void;
  onEvent?: AskEventSink;
};

export async function runAgentQuestion(input: RunAgentInput): Promise<AgentRunResult> {
  const started = Date.now();
  const queryId = nanoid(10);
  const runId = nanoid(10);
  const emit = input.onEvent || (() => undefined);
  const modelName = input.openaiModel || 'gpt-4o-mini';

  emit({ type: 'status', message: 'Preparing patient-bound evidence…' });

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

  const app = createCareCircleAdkApp({
    onEvent: (type) => emit({ type: 'status', message: `ADK: ${type}` }),
  });

  const appendTrace = (
    ctx: { state: { toolTraceJson?: string; update: (p: Record<string, unknown>) => void } },
    item: ToolTraceItem,
  ) => {
    const prev = parseToolTrace(ctx.state.toolTraceJson);
    ctx.state.update({ toolTraceJson: JSON.stringify([...prev, item]) });
  };

  const viewer = bag.policy.viewers.find((v) => v.viewerId === input.viewerId);
  const viewerRole = viewer?.relationship || 'family_member';

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
      'Patient-only: update an information-class grant for a family viewer. Rejected for non-patient viewers.',
    schema: z.object({
      targetViewerId: z.string(),
      informationClass: z.string(),
      allowed: z.boolean(),
    }),
    execute: (ctx) => {
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
        const next = updateGrants(
          bag.policy,
          ctx.args.targetViewerId,
          { [ctx.args.informationClass as InformationClass]: ctx.args.allowed },
          bag.policy.policyVersion,
          'patient',
        );
        bag.policy = next;
        input.onConsentUpdate?.(next);
        emit({
          type: 'tool',
          tool: 'update_consent',
          status: 'ok',
          detail: `${ctx.args.targetViewerId}:${ctx.args.informationClass}=${ctx.args.allowed}`,
        });
        appendTrace(ctx, {
          tool: 'update_consent',
          status: 'ok',
          latencyMs: Date.now() - t0,
          detail: `${ctx.args.targetViewerId} ${ctx.args.informationClass}=${ctx.args.allowed}`,
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
      appendTrace(ctx, {
        tool: 'patient.context.read',
        status: 'ok',
        latencyMs: Date.now() - t0,
        detail: `patient=${input.context.patientId}`,
        evidenceCount: bag.evidence.length,
      });

      const t1 = Date.now();
      emit({ type: 'status', message: 'Evaluating consent & disclosure…' });
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
      const primaryAppt =
        /^(please )?(find|book|schedule|check).*(appoint|slot)/i.test(input.question.trim()) ||
        (/\b(appoint(ment)?s?|book(ing)?|slots?)\b/i.test(input.question) &&
          !/\b(blood|result|lab|lft|alt|alp|egfr|hba1c|explain)\b/i.test(input.question));
      if (primaryAppt && decision.outcome !== 'deny' && decision.outcome !== 'hold') {
        emit({ type: 'status', message: 'Checking appointments…' });
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
      if (prefMatch) {
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

      const visualisationSpec = buildVisualisation(input.question, bag.allowedMeasurements);
      const memoryGreeting =
        bag.memoriesUsed.find((m) => m.metadata.kind === 'greeting' || m.metadata.kind === 'preference')
          ?.content;
      bag.answer = buildDeterministicAnswer({
        question: input.question,
        policyNotice: decision.userNotice,
        outcome: decision.outcome,
        measurements: bag.allowedMeasurements,
        events: bag.allowedEvents,
        visualisationSpec,
        appointmentAssist: bag.appointmentAssist,
        memoriesHint: memoryGreeting
          ? `Based on what I remember for you: ${memoryGreeting}. Ask another question if you need something else from the record.`
          : undefined,
      });

      // Soft personalisation for allow/partial when we have memories
      if (
        (decision.outcome === 'allow' || decision.outcome === 'partial') &&
        bag.memoriesUsed.length &&
        bag.answer
      ) {
        const pref = bag.memoriesUsed
          .filter((m) => m.metadata.kind === 'preference' || m.metadata.kind === 'clarification')
          .map((m) => m.content)
          .slice(0, 2);
        if (pref.length && !/outside your current|cannot confirm/i.test(bag.answer.answer)) {
          bag.answer = {
            ...bag.answer,
            answer: bag.answer.answer,
            policyNotice: [bag.answer.policyNotice, pref.length ? `Remembered: ${pref.join(' · ')}` : '']
              .filter(Boolean)
              .join(' '),
          };
        }
      }

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
            : 'deterministic_grounded',
      });
    },
  });

  const modelStep = app.step({
    name: 'responses_ask_agent',
    execute: async (ctx) => {
      const outcome = String(ctx.state.policyOutcome || '');
      const canModel =
        Boolean(input.openaiApiKey) &&
        outcome !== 'deny' &&
        outcome !== 'hold' &&
        outcome !== 'pending' &&
        Boolean(bag.answer);

      if (!canModel) {
        appendTrace(ctx, {
          tool: 'answer.refine',
          status: 'skipped',
          latencyMs: 0,
          detail: input.openaiApiKey ? `policy=${outcome}` : 'no_openai_key',
        });
        emit({
          type: 'tool',
          tool: 'answer.refine',
          status: 'skipped',
          detail: input.openaiApiKey ? `policy=${outcome}` : 'no_openai_key',
        });
        if (bag.answer?.answer) emit({ type: 'token', text: bag.answer.answer });
        ctx.respond(bag.answer?.answer || '');
        return;
      }

      process.env.OPENAI_API_KEY = input.openaiApiKey;
      const t0 = Date.now();
      emit({ type: 'status', message: 'Asking via OpenAI Responses (ADK)…' });

      try {
        const tools = [getPermittedEvidenceTool, appointmentAssistTool, rememberTool, updateConsentTool];
        const askAgent = createAskAgent(app, modelName, tools);
        let streamed = '';
        const prompt = [
          `Authenticated viewer: ${input.viewerId} (${viewerRole}).`,
          `Patient: ${input.context.patientId}.`,
          `Draft facts (grounded, already filtered): ${JSON.stringify(bag.answer?.facts || [])}.`,
          `Question: ${input.question}`,
          `Rewrite a clear CareCircle answer using only permitted evidence and memories. Call tools if needed.`,
        ].join('\n');

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
            // Some adapters emit cumulative snapshots; only forward the new suffix.
            const next = event.text;
            let piece = next;
            if (next.startsWith(streamed)) {
              piece = next.slice(streamed.length);
              streamed = next;
            } else {
              streamed += next;
            }
            if (piece) emit({ type: 'token', text: piece });
          }
          if (event.type === 'tool_call' && 'name' in event && event.name) {
            emit({ type: 'status', message: `Tool: ${event.name}` });
          }
        }
        const text = String(nested?.output?.text || streamed || '').trim();
        const parsed = tryParseModelExtras(text);
        const prose = stripTrailingJson(text) || parsed.answer;

        if (prose && bag.answer) {
          bag.answer = {
            ...bag.answer,
            answer: prose,
            uncertainty: parsed.uncertainty || bag.answer.uncertainty,
            appointmentAssist: bag.appointmentAssist || bag.answer.appointmentAssist,
          };
          if (!streamed) emit({ type: 'token', text: prose });

          // Auto-remember short preference phrases the model flagged
          for (const rem of parsed.remembered || []) {
            const saved = await input.memory.remember({
              patientId: input.context.patientId,
              viewerId: input.viewerId,
              kind: rem.kind,
              text: rem.text,
            });
            if (saved) bag.memoriesWritten.push(saved);
          }

          ctx.state.update({
            answerJson: JSON.stringify(bag.answer),
            modelLabel: `openai-responses:${modelName}`,
          });
          appendTrace(ctx, {
            tool: 'answer.refine',
            status: 'ok',
            latencyMs: Date.now() - t0,
            detail: 'adk openai responses + slim skills',
          });
          emit({
            type: 'tool',
            tool: 'answer.refine',
            status: 'ok',
            detail: 'responses_api',
          });
        } else {
          throw new Error('empty_model_output');
        }
      } catch (err) {
        // Fallback: Responses API via fetch (still not Chat Completions)
        try {
          const refined = await refineWithResponsesApi({
            apiKey: input.openaiApiKey!,
            model: modelName,
            question: input.question,
            viewerId: input.viewerId,
            viewerRole,
            patientId: input.context.patientId,
            draft: bag.answer!,
            memories: bag.memoriesUsed,
            onToken: (t) => emit({ type: 'token', text: t }),
          });
          if (refined && bag.answer) {
            bag.answer = {
              ...bag.answer,
              answer: refined.answer,
              uncertainty: refined.uncertainty || bag.answer.uncertainty,
            };
            ctx.state.update({
              answerJson: JSON.stringify(bag.answer),
              modelLabel: `openai-responses:${modelName}`,
            });
            appendTrace(ctx, {
              tool: 'answer.refine',
              status: 'ok',
              latencyMs: Date.now() - t0,
              detail: 'responses api direct fallback',
            });
          } else {
            appendTrace(ctx, {
              tool: 'answer.refine',
              status: 'error',
              latencyMs: Date.now() - t0,
              detail: err instanceof Error ? err.message : 'model failed',
            });
            if (bag.answer?.answer) emit({ type: 'token', text: bag.answer.answer });
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
          if (bag.answer?.answer) emit({ type: 'token', text: bag.answer.answer });
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

function stripTrailingJson(text: string): string {
  const start = text.lastIndexOf('\n{');
  if (start >= 0 && text.trimEnd().endsWith('}')) {
    return text.slice(0, start).trim();
  }
  // whole-message JSON
  if (text.trim().startsWith('{')) {
    try {
      const obj = JSON.parse(text) as { answer?: string };
      if (obj.answer) return obj.answer;
    } catch {
      /* ignore */
    }
  }
  return text.trim();
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
  draft: AgentAnswer;
  memories: CareCircleMemoryItem[];
  onToken?: (text: string) => void;
}): Promise<{ answer: string; uncertainty?: string } | null> {
  const { STATIC_SYSTEM_PROMPT } = await import('./prompts.js');
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: input.model,
      store: false,
      temperature: 0.2,
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
            memories: input.memories.map((m) => ({ kind: m.metadata.kind, text: m.content })),
            facts: input.draft.facts,
            draftAnswer: input.draft.answer,
            question: input.question,
            instruction: 'Return JSON only: {answer, uncertainty}',
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
    const parsed = JSON.parse(content) as { answer?: string; uncertainty?: string };
    if (parsed.answer) {
      input.onToken?.(parsed.answer);
      return { answer: parsed.answer, uncertainty: parsed.uncertainty };
    }
  } catch {
    /* model sometimes returns prose */
  }
  const prose = content.trim();
  if (!prose) return null;
  input.onToken?.(prose);
  return { answer: prose };
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
