/**
 * Silent Kindred companion turn for unified Ask.
 *
 * Runs the same tools as /api/chat (agentTurn) without writing into the Kindred
 * companion chat thread — replies stream into the Ask UI instead.
 * Circle / Kindred store remains source of truth for sharing mutations.
 */
import { nanoid } from 'nanoid';
import type { AskEventSink } from './events';
import type { AgentRunResult, PolicyDecision } from '../types/domain';
import type { ConsentPolicyState } from '../consent/policy';
import { updateSharingLevel } from '../consent/policy';
import { PROMPT_VERSION } from './prompts';
import { isCompanionAskIntent } from './intent';
import { careViewerForKindred } from '../../viewers';
import type { ChatTurn } from './grounding';

export { isCompanionAskIntent };

export function resolveKindredActorId(careViewerId: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const store = require('../../../store') as {
      getState: () => {
        patientId: string;
        people: { id: string; role: string; shortName: string }[];
      };
    };
    const state = store.getState();
    if (!state?.patientId) return null;
    if (careViewerId === 'patient') return state.patientId;
    const hit = state.people.find(
      (p) =>
        (p.role === 'family' || p.role === 'carer') &&
        careViewerForKindred(state as never, p.id) === careViewerId,
    );
    if (hit) return hit.id;
    const byName = state.people.find((p) => p.shortName.toLowerCase() === careViewerId.toLowerCase());
    return byName?.id ?? null;
  } catch {
    return null;
  }
}

/** Mirror Kindred Circle levels into CareCircle Ask policy after companion mutations. */
export function syncCarePolicyFromKindred(
  policy: ConsentPolicyState,
  onConsentUpdate?: (next: ConsentPolicyState) => void,
): ConsentPolicyState {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const store = require('../../../store') as { getState: () => unknown };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { familyForLevelSync } = require('../../viewers') as {
      familyForLevelSync: (state: unknown) => {
        careViewerId: string;
        level: string;
      }[];
    };
    const state = store.getState();
    let next = policy;
    for (const row of familyForLevelSync(state)) {
      if (row.level !== 'everything' && row.level !== 'practical' && row.level !== 'updates') continue;
      try {
        next = updateSharingLevel(next, row.careViewerId, row.level, next.policyVersion, 'patient');
      } catch {
        /* version conflict — skip this viewer */
      }
    }
    if (next !== policy) onConsentUpdate?.(next);
    return next;
  } catch {
    return policy;
  }
}

export type CompanionAskInput = {
  careViewerId: string;
  patientId: string;
  question: string;
  history?: ChatTurn[];
  policy: ConsentPolicyState;
  onConsentUpdate?: (next: ConsentPolicyState) => void;
  onEvent?: AskEventSink;
};

/**
 * Companion-capable Ask turn using Kindred tools (sharing, consent, next actions,
 * goals/needs voice, request_access). Does not post into Kindred chat threads.
 */
export async function runCompanionAsk(input: CompanionAskInput): Promise<AgentRunResult> {
  const started = Date.now();
  const queryId = nanoid(10);
  const runId = nanoid(10);
  const emit = input.onEvent || (() => undefined);

  emit({ type: 'status', message: 'Thinking with Kindred…' });

  const actorId = resolveKindredActorId(input.careViewerId);
  if (!actorId) {
    const answer =
      'I can’t reach the Kindred companion tools right now. Try again in a moment, or open Circle to change sharing.';
    emitTokens(emit, answer);
    return companionRunResult({
      runId,
      queryId,
      patientId: input.patientId,
      viewerId: input.careViewerId,
      answer,
      policy: allowDecision(input.policy),
      tools: [{ tool: 'companion.route', status: 'error', latencyMs: 0, detail: 'no_kindred_actor' }],
      model: 'companion-unavailable',
      latencyMs: Date.now() - started,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const kindredStore = require('../../../store') as {
    getState: () => { patientId: string; agentMode: string; agentId: string };
    ensureLoaded?: () => Promise<unknown>;
  };
  if (typeof kindredStore.ensureLoaded === 'function') {
    await kindredStore.ensureLoaded();
  }

  const state = kindredStore.getState();
  const threadId = `${state.patientId}-kindred`;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { systemPrompt } = require('../../../agent/prompts') as {
    systemPrompt: (s: unknown, actorId: string) => string;
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { toolsForActor, runTool } = require('../../../agent/tools') as {
    toolsForActor: (actorId: string) => { name: string; description: string; input_schema: unknown; handler: unknown }[];
    runTool: (
      def: unknown,
      ctx: { actorId: string; threadId: string },
      input: Record<string, unknown>,
    ) => Promise<{ result: { ok: boolean; data?: unknown; error?: string; summary: string }; trace: { name: string; summary: string; ok: boolean; ms: number } }>;
  };

  const defs = toolsForActor(actorId);
  const toolsUsed: AgentRunResult['tools'] = [
    { tool: 'companion.route', status: 'ok', latencyMs: 0, detail: 'kindred_tools' },
  ];

  let reply = '';
  let modelLabel = 'companion-scripted';

  const historyHint = (input.history || [])
    .slice(-4)
    .map((t) => `${t.role}: ${t.content}`)
    .join('\n');
  const userBlob = historyHint
    ? `Recent Ask turns:\n${historyHint}\n\nLatest: ${input.question}`
    : input.question;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { openaiRun } = require('../../../agent/openai') as {
      openaiRun: (
        instructions: string,
        userText: string,
        defs: unknown[],
        ctx: { actorId: string; threadId: string },
      ) => Promise<{ toolCalls: string[]; text: string }>;
    };
    const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
    if (hasOpenAI && (state.agentMode === 'openai' || state.agentMode === 'claude')) {
      emit({ type: 'status', message: 'Updating Circle…' });
      const instructions = systemPrompt(kindredStore.getState(), actorId);
      const out = await openaiRun(instructions, userBlob, defs, { actorId, threadId });
      reply = String(out.text || '').trim();
      modelLabel = `companion-openai:${process.env.AGENT_MODEL || 'default'}`;
      for (const name of out.toolCalls) {
        emit({ type: 'tool', tool: name, status: 'ok', detail: 'kindred' });
        toolsUsed.push({ tool: name, status: 'ok', latencyMs: 0, detail: 'kindred_companion' });
      }
    } else {
      const scripted = await scriptedCompanionReply(actorId, threadId, input.question, defs, runTool, emit);
      reply = scripted.text;
      modelLabel = 'companion-scripted';
      toolsUsed.push(...scripted.tools);
    }
  } catch (err) {
    const scripted = await scriptedCompanionReply(actorId, threadId, input.question, defs, runTool, emit);
    reply = scripted.text || (err instanceof Error ? err.message : 'Companion turn failed');
    modelLabel = 'companion-scripted-fallback';
    toolsUsed.push(...scripted.tools);
  }

  if (!reply) {
    reply =
      'I can help with sharing levels, who can see what, next actions on the care plan, and what matters to you — or ask a clinical question about results and appointments.';
  }

  // Circle mutations → keep CareCircle Ask filter in sync
  const mutated = toolsUsed.some((t: { tool: string }) =>
    ['set_sharing_level', 'update_consent', 'request_access'].includes(t.tool),
  );
  if (mutated) {
    syncCarePolicyFromKindred(input.policy, input.onConsentUpdate);
  }

  emitTokens(emit, reply);

  return companionRunResult({
    runId,
    queryId,
    patientId: input.patientId,
    viewerId: input.careViewerId,
    answer: reply,
    policy: allowDecision(input.policy),
    tools: toolsUsed,
    model: modelLabel,
    latencyMs: Date.now() - started,
  });
}

function emitTokens(emit: AskEventSink, text: string) {
  const clean = String(text || '').trim();
  if (!clean) return;
  emit({ type: 'status', message: 'Writing…' });
  const chunk = 28;
  for (let i = 0; i < clean.length; i += chunk) {
    emit({ type: 'token', text: clean.slice(i, i + chunk) });
  }
}

function allowDecision(policy: ConsentPolicyState): PolicyDecision {
  return {
    decisionId: `companion_${nanoid(6)}`,
    outcome: 'allow',
    allowedEvidenceIds: [],
    allowedFieldsByEvidence: {},
    deniedInformationClasses: [],
    reasonCodes: ['companion_path'],
    userNotice: '',
    policyVersion: policy.policyVersion,
  };
}

function companionRunResult(opts: {
  runId: string;
  queryId: string;
  patientId: string;
  viewerId: string;
  answer: string;
  policy: PolicyDecision;
  tools: AgentRunResult['tools'];
  model: string;
  latencyMs: number;
}): AgentRunResult {
  return {
    runId: opts.runId,
    queryId: opts.queryId,
    patientId: opts.patientId,
    viewerId: opts.viewerId as AgentRunResult['viewerId'],
    answer: {
      answer: opts.answer,
      facts: [],
      citations: [],
    },
    policy: opts.policy,
    tools: opts.tools,
    model: opts.model,
    promptVersion: `${PROMPT_VERSION}+companion`,
    latencyMs: opts.latencyMs,
  };
}

type RunToolFn = (
  def: unknown,
  ctx: { actorId: string; threadId: string },
  input: Record<string, unknown>,
) => Promise<{ result: { ok: boolean; data?: unknown; error?: string; summary: string }; trace: { name: string; summary: string; ok: boolean } }>;

async function scriptedCompanionReply(
  actorId: string,
  threadId: string,
  text: string,
  defs: { name: string }[],
  runTool: RunToolFn,
  emit: AskEventSink,
): Promise<{ text: string; tools: AgentRunResult['tools'] }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const store = require('../../../store') as {
    getState: () => {
      patientId: string;
      patient: { practice: string; needs: string[]; goals: string[]; context?: string };
      people: { id: string; role: string; shortName: string; name: string; relation: string }[];
      audit: { kind: string; actorId: string; ok?: boolean; detail?: { category?: string } }[];
      nextActions: { done: boolean; text: string }[];
    };
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { CATEGORIES, personById } = require('../../../types') as {
    CATEGORIES: { id: string; label: string }[];
    personById: (s: unknown, id: string) => { shortName: string; name: string; relation: string };
  };

  const state = store.getState();
  const actor = personById(state, actorId);
  const patient = personById(state, state.patientId);
  const isPatient = actorId === state.patientId;
  const tools: AgentRunResult['tools'] = [];
  const t = text.toLowerCase();

  const call = async (name: string, input: Record<string, unknown> = {}) => {
    const def = defs.find((d) => d.name === name);
    if (!def) return { ok: false as const, error: 'not permitted', summary: 'not permitted', data: undefined };
    emit({ type: 'tool', tool: name, status: 'ok', detail: 'scripted' });
    const r = await runTool(def, { actorId, threadId }, input);
    tools.push({
      tool: name,
      status: r.result.ok ? 'ok' : 'error',
      latencyMs: 0,
      detail: r.result.summary,
    });
    return r.result;
  };

  const matchPerson = (): string | null => {
    for (const p of state.people) {
      if (p.role === 'patient' || p.role === 'agent') continue;
      if (t.includes(p.shortName.toLowerCase()) || t.includes(p.name.toLowerCase())) return p.id;
    }
    return null;
  };

  const matchCategory = (): string | null => {
    if (/(blood test|test result|results|lab)/.test(t)) return 'lab_results';
    if (/(mood|mental|wellbeing|sleep)/.test(t)) return 'mental_health';
    if (/(medic|pill|tablet)/.test(t)) return 'medications';
    if (/(appointment|coming up)/.test(t)) return 'appointments';
    if (/(condition|diagnos)/.test(t)) return 'conditions';
    if (/(care note|notes)/.test(t)) return 'care_notes';
    return null;
  };

  const person = matchPerson();
  const category = matchCategory();
  const levelMatch = /(everything|practical|important (updates?|stuff|things)|only the big|just the important)/.exec(t);

  if (isPatient && person && levelMatch) {
    const level = /everything/.test(levelMatch[0]) ? 'everything' : /practical/.test(levelMatch[0]) ? 'practical' : 'updates';
    const who = personById(state, person).shortName;
    const res = await call('set_sharing_level', { person: who, level });
    const d = res.data as { level?: string; nowSees?: string[] } | undefined;
    return {
      text: res.ok
        ? `Done, ${patient.shortName}. ${who} is now on “${d?.level}” and can see ${d?.nowSees?.length ? d.nowSees.join(', ').toLowerCase() : 'nothing yet'}. ${state.patient.practice}'s record is updated too.`
        : `I couldn't make that change: ${res.error}`,
      tools,
    };
  }

  if (isPatient && person && category && /(let|allow|share|give|show|can see|access|stop|don.?t|hide|remove|revoke|no longer)/.test(t)) {
    const allowed = !/(stop|don.?t|hide|remove|revoke|no longer|not)/.test(t);
    const who = personById(state, person).shortName;
    const res = await call('update_consent', { person: who, category, allowed });
    const cat = CATEGORIES.find((c) => c.id === category)!.label.toLowerCase();
    return {
      text: res.ok
        ? allowed
          ? `Done, ${patient.shortName}. ${who} can now see your ${cat}. I've written that to ${state.patient.practice}'s record too. You can change it any time from Circle.`
          : `Of course. ${who} can no longer see your ${cat}. That's updated at ${state.patient.practice} as well.`
        : `I couldn't make that change: ${res.error}`,
      tools,
    };
  }

  if (isPatient && /(who can see|who has access|what.*shar|my circle|consent)/.test(t)) {
    const res = await call('get_consent');
    const rows =
      ((res.data as { people?: { person: string; canSee: string[]; level?: string }[] })?.people as
        | { person: string; canSee: string[]; level?: string }[]
        | undefined) ??
      ((res.data as { person: string; canSee: string[] }[]) || []);
    const list = Array.isArray(rows)
      ? rows
          .map((r) => {
            const row = r as { person: string; canSee: string[]; level?: string };
            return `• ${row.person}${row.level ? ` (${row.level})` : ''}: ${row.canSee?.length ? row.canSee.join(', ') : 'nothing yet'}`;
          })
          .join('\n')
      : '';
    return {
      text: `Here's who can see what right now:\n\n${list || 'No circle members listed yet.'}\n\nTell me if you'd like to change any of these — for example “share everything with Grace”.`,
      tools,
    };
  }

  if (!isPatient && /(ask her|ask him|please ask|send.*request|request access|ask .* to share)/.test(t)) {
    const lastDenied = state.audit.find((a) => a.kind === 'consent.check' && a.actorId === actorId && a.ok === false);
    const cat = (lastDenied?.detail as { category?: string } | undefined)?.category ?? category ?? 'lab_results';
    const label = CATEGORIES.find((c) => c.id === cat)?.label.toLowerCase() || cat;
    const res = await call('request_access', {
      category: cat,
      reason: `${actor.shortName} would like to understand ${patient.shortName}'s ${label}.`,
    });
    return {
      text: res.ok
        ? `I've asked ${patient.shortName} to share her ${label} with you. She'll see it on her home screen — nothing is shared until she says yes.`
        : `I couldn't send that request: ${res.error}`,
      tools,
    };
  }

  if (/(next action|to-?do|outstanding|care plan|what should i (do|help)|prep for)/.test(t)) {
    const res = await call('get_next_actions');
    if (!res.ok) {
      return {
        text: `${patient.shortName} hasn't shared enough for me to list next actions with you yet. I can ask her if you'd like.`,
        tools,
      };
    }
    const actions = (res.data as { text?: string; title?: string; detail?: string }[]) || [];
    if (!actions.length) {
      return { text: `There are no open next actions on ${isPatient ? 'your' : `${patient.shortName}'s`} care plan right now.`, tools };
    }
    return {
      text: `Open next actions:\n\n${actions.map((a) => `• ${a.text || a.title || a.detail || 'Action'}`).join('\n')}`,
      tools,
    };
  }

  if (/(what matters|my goals?|needs|personal context|what.*important to (me|her))/i.test(t)) {
    const needs = state.patient.needs || [];
    const goals = state.patient.goals || [];
    const ctx = state.patient.context?.replace(/\s+/g, ' ').trim();
    const bits: string[] = [];
    if (goals.length) bits.push(`What matters: ${goals.join('; ')}.`);
    if (needs.length) bits.push(`Recorded needs: ${needs.join(', ')}.`);
    if (ctx) bits.push(`Personal context: ${ctx.slice(0, 280)}`);
    return {
      text: bits.length
        ? `${isPatient ? 'From your record' : `From ${patient.shortName}'s record`}:\n\n${bits.join('\n\n')}\n\nI can also adjust sharing or look up appointments and results.`
        : `There isn't a goals or needs note on the record yet. Tell me what matters and I can remember it for this chat.`,
      tools,
    };
  }

  // Soft companion greeting when routed here without a sharper intent
  const family = state.people.find((p) => p.role === 'family');
  return {
    text: isPatient
      ? `I can change sharing (e.g. “Let ${family?.shortName || 'Grace'} see my test results”), show who can see what, list next actions, or talk about what matters — and I still answer clinical questions about results and appointments.`
      : `I can help with what ${patient.shortName} has shared, ask her for access when something isn't shared, and list practical next actions.`,
    tools,
  };
}
