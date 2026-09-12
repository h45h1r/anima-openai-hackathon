import { z } from 'zod';
import { adk, type AdkApp } from '@animahealth/adk';
import { openai } from '@animahealth/adk/openai';
import { STATIC_SYSTEM_PROMPT } from './prompts';

export const careCircleStateSchema = {
  session: { patientId: z.string().default(''), viewerId: z.string().default('patient') },
} as const;
export type CareCircleAdkApp = AdkApp<typeof careCircleStateSchema>;

export function createCareCircleAdkApp(onModelContext?: (events: string) => void): CareCircleAdkApp {
  return adk({ hooks: onModelContext ? [{ name: 'eval_model_context', beforeModel: (_ctx, renderCtx) => { onModelContext(JSON.stringify(renderCtx.events)); } }] : [], name: 'carecircle', schema: careCircleStateSchema });
}

export function createAskAgent(app: CareCircleAdkApp, modelName: string, tools: ReturnType<CareCircleAdkApp['tool']>[]) {
  const reasoningModel = /^(gpt-5|gpt-6|o[0-9])/i.test(modelName);
  return app.agent({
    name: 'carecircle_ask',
    model: openai(modelName, reasoningModel
      ? { reasoning: { effort: 'medium' }, maxTokens: 4096 }
      : { temperature: 0.35, maxTokens: 1500 }),
    maxSteps: 8,
    toolChoice: 'auto',
    tools,
    context: [app.context.system(STATIC_SYSTEM_PROMPT), app.context.history()],
  });
}
