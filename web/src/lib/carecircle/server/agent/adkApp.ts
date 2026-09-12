/**
 * CareCircle Anima ADK wiring — Responses API (via @animahealth/adk/openai),
 * prompt-cache-friendly context, slim skills, consent beforeModel gate.
 *
 * Skills exposed to the model (max 4):
 * - get_permitted_evidence
 * - appointment_assist
 * - remember
 * - update_consent (patient-only)
 *
 * Consent/disclosure/patient-binding stay code-enforced outside the model.
 */
import { z } from 'zod';
import { adk, type AdkApp, type Hook } from '@animahealth/adk';
import { openai } from '@animahealth/adk/openai';
import { STATIC_SYSTEM_PROMPT } from './prompts';

export const careCircleStateSchema = {
  session: {
    runId: z.string().default(''),
    queryId: z.string().default(''),
    patientId: z.string().default(''),
    viewerId: z.string().default('patient'),
    viewerRole: z.string().default('self'),
    question: z.string().default(''),
    policyOutcome: z.string().default('pending'),
    allowedEvidenceIdsJson: z.string().default('[]'),
    permittedEvidencePackJson: z.string().default('{}'),
    memoriesJson: z.string().default('[]'),
    answerJson: z.string().default(''),
    modelLabel: z.string().default('deterministic-grounded'),
    toolTraceJson: z.string().default('[]'),
    appointmentStage: z.string().default(''),
    memoriesWrittenJson: z.string().default('[]'),
  },
} as const;

export type CareCircleAdkApp = AdkApp<typeof careCircleStateSchema>;

export type ToolTraceItem = {
  tool: string;
  status: 'ok' | 'error' | 'skipped';
  latencyMs: number;
  detail: string;
  evidenceCount?: number;
};

export function createCareCircleAdkApp(options?: {
  onEvent?: (type: string, detail?: string) => void;
}): CareCircleAdkApp {
  const consentBeforeModel: Hook<typeof careCircleStateSchema> = {
    name: 'carecircle_consent_before_model',
    beforeModel: async (ctx, renderCtx) => {
      const outcome = String(ctx.state.policyOutcome || 'pending');
      // Model must never see protected clinical content until consent+disclosure cleared.
      if (outcome === 'pending' || outcome === 'deny' || outcome === 'hold') {
        const text =
          outcome === 'hold'
            ? 'I cannot confirm whether a new result exists or what it shows. It is held until disclosure is cleared.'
            : outcome === 'deny'
              ? 'That clinical detail is outside your current CareCircle access.'
              : 'CareCircle blocked the model: consent has not been evaluated yet.';
        return {
          stepEvents: [
            {
              id: `consent_gate_${Date.now()}`,
              type: 'assistant' as const,
              createdAt: Date.now(),
              invocationId: renderCtx.invocationId,
              agentName: renderCtx.agentName,
              text: JSON.stringify({
                answer: text,
                uncertainty: `consent_gate_${outcome}`,
              }),
            },
          ],
          toolCalls: [],
          terminal: true,
        };
      }
      return;
    },
    onEvent: (event) => {
      options?.onEvent?.(event.type);
    },
  };

  return adk({
    name: 'carecircle',
    schema: careCircleStateSchema,
    hooks: [consentBeforeModel],
  });
}

/**
 * Cacheable static system prefix + dynamic patient/viewer pack at the end.
 * ADK OpenAI adapter uses Responses API; promptCache tags require providerContext.cacheable.
 */
export function cacheFriendlyContext(app: CareCircleAdkApp) {
  return app.context((ctx) => {
    const pack = safeJson(ctx.state.permittedEvidencePackJson, {});
    const memories = safeJson(ctx.state.memoriesJson, [] as unknown[]);
    const outcome = String(ctx.state.policyOutcome || 'pending');
    const viewerId = String(ctx.state.viewerId || 'patient');
    const viewerRole = String(ctx.state.viewerRole || 'self');
    const patientId = String(ctx.state.patientId || '');

    const dynamicBlock =
      outcome === 'allow' || outcome === 'partial'
        ? [
            `DYNAMIC_CONTEXT (not cached):`,
            `authenticatedViewerId=${viewerId}`,
            `viewerRole=${viewerRole}`,
            `patientId=${patientId}`,
            `policyOutcome=${outcome}`,
            `MEMORIES_FOR_THIS_VIEWER:\n${JSON.stringify(memories)}`,
            `PERMITTED_EVIDENCE (newest first; use these values only):\n${JSON.stringify(pack)}`,
            `Never invent numbers. Prefer short plain language when memories ask for it.`,
          ].join('\n\n')
        : [
            `DYNAMIC_CONTEXT (not cached):`,
            `authenticatedViewerId=${viewerId}`,
            `viewerRole=${viewerRole}`,
            `patientId=${patientId}`,
            `policyOutcome=${outcome}`,
            `MEMORIES_FOR_THIS_VIEWER:\n${JSON.stringify(memories)}`,
            `No clinical evidence is permitted for this viewer.`,
          ].join('\n\n');

    const now = Date.now();
    const cacheableSystem = {
      type: 'system' as const,
      text: STATIC_SYSTEM_PROMPT,
      id: `sys_cache_${ctx.invocationId}`,
      createdAt: now,
      invocationId: ctx.invocationId,
      agentName: ctx.agentName,
      providerContext: {
        provider: 'adk',
        data: { cacheable: true },
      },
    };
    const dynamicSystem = {
      type: 'system' as const,
      text: dynamicBlock,
      id: `sys_dyn_${ctx.invocationId}`,
      createdAt: now + 1,
      invocationId: ctx.invocationId,
      agentName: ctx.agentName,
    };

    const userEvents = ctx.events.filter((e) => e.type === 'user');

    return {
      ...ctx,
      events: [cacheableSystem, dynamicSystem, ...userEvents],
    };
  });
}

/** Ask agent — OpenAI Responses via ADK with a stable system prefix. */
export function createAskAgent(
  app: CareCircleAdkApp,
  modelName: string,
  tools: ReturnType<CareCircleAdkApp['tool']>[],
) {
  const reasoningModel = /^(gpt-5|gpt-6|o[0-9])/i.test(modelName);
  const rewriteOpts = reasoningModel
    ? { reasoning: { effort: 'medium' as const }, maxTokens: 4096 }
    : { temperature: 0.35, maxTokens: 700 };
  return app.agent({
    name: 'carecircle_ask',
    model: openai(modelName, rewriteOpts),
    maxSteps: 4,
    tools,
    toolChoice: 'auto',
    context: [cacheFriendlyContext(app)],
  });
}

function safeJson<T>(raw: unknown, fallback: T): T {
  try {
    return JSON.parse(String(raw || '')) as T;
  } catch {
    return fallback;
  }
}

export function parseToolTrace(raw: unknown): ToolTraceItem[] {
  return safeJson(raw, []);
}
