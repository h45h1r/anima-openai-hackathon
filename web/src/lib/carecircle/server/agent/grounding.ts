/**
 * Deterministic grounding helpers — citations, visualisation, appointment stages.
 * Safety-critical booking rules live here (slots ≠ booked).
 * Intent routing lives in ./intent.ts so Kindred/SSE ports can reuse the same paths.
 */
import type { AnimaClient } from '../anima/client';
import type {
  AgentAnswer,
  AppointmentAssist,
  Citation,
  ClinicalContext,
  Measurement,
  NormalisedEvent,
  VisualisationSpec,
} from '../types/domain';
import type { EvidenceItem } from '../consent/policy';
import {
  classifyAskIntent,
  isAppointmentIntent,
  isDocumentIntent,
  isFollowUpQuestion,
  isLabIntent,
  isShareConsentIntent,
  isVitalsBpIntent,
  type ChatTurn,
} from './intent';

export {
  classifyAskIntent,
  isAppointmentIntent,
  isDocumentIntent,
  isFollowUpQuestion,
  isLabIntent,
  type ChatTurn,
} from './intent';

const TREND_Q = /\b(trend|chart|graph|changed|over time|history|compare|how has)\b/i;

const BP_MEASUREMENT =
  /\b(bp|blood\s*pressure|systolic|diastolic|mm\s*hg|mmhg)\b/i;

/** Topic → analyte / panel matchers so “kidney” ≠ full FBC dump. More specific topics first. */
const LAB_TOPICS: { id: string; re: RegExp; analyte: RegExp }[] = [
  {
    id: 'potassium',
    re: /\b(potassium|k\+)\b/i,
    analyte: /potassium/i,
  },
  {
    id: 'hba1c',
    re: /\b(hba1c|a1c|diabetes|glucose|sugar)\b/i,
    analyte: /hba1c|a1c|glucose|diabetes/i,
  },
  {
    id: 'kidney',
    re: /\b(kidney|renal|u\s*&\s*e|uande|electrolyte|egfr|gfr|creatinine|urea|sodium|na\+)\b/i,
    analyte: /egfr|gfr|creatinine|urea|sodium|potassium|electrolyte|kidney|renal|u.?e/i,
  },
  {
    id: 'lft',
    re: /\b(lft|liver|alt|alp|bilirubin|albumin|ast|ggt)\b/i,
    analyte: /alt|alp|bilirubin|albumin|ast|ggt|liver|lft/i,
  },
  {
    id: 'fbc',
    re: /\b(fbc|full blood|haemoglobin|hemoglobin|wbc|white cell|platelet|rbc|haematocrit|hematocrit)\b/i,
    analyte: /haemoglobin|hemoglobin|white.?cell|wbc|platelet|rbc|haematocrit|hematocrit|fbc|full blood/i,
  },
];

/** Resolve which lab measurements answer this question (and prior turn, for follow-ups). */
export function selectLabMeasurements(
  question: string,
  measurements: Measurement[],
  history?: ChatTurn[],
): { selected: Measurement[]; topicIds: string[]; focused: boolean } {
  if (!measurements.length) return { selected: [], topicIds: [], focused: false };
  const blob = [
    question,
    ...(history || [])
      .slice(-4)
      .map((t) => t.content)
      .reverse(),
  ].join('\n');

  // Prefer the first (most specific) topic matched in the current question.
  const currentTopic = LAB_TOPICS.find((t) => t.re.test(question));
  const historyTopic =
    !currentTopic && isFollowUpQuestion(question, history)
      ? LAB_TOPICS.find((t) => t.re.test(blob))
      : undefined;
  const topics = currentTopic ? [currentTopic] : historyTopic ? [historyTopic] : [];

  if (topics.length) {
    const analyteRe = new RegExp(topics.map((t) => t.analyte.source).join('|'), 'i');
    const selected = measurements.filter(
      (m) => analyteRe.test(m.displayName) || analyteRe.test(m.analyteId) || analyteRe.test(m.informationClass || ''),
    );
    // Topic was explicit — never fall back to an unrelated full panel dump.
    return { selected, topicIds: topics.map((t) => t.id), focused: true };
  }

  // Named single analyte (e.g. “what about ALT”)
  const byAnalyte = groupByAnalyte(measurements);
  for (const [, series] of byAnalyte) {
    const name = series[0].displayName.toLowerCase();
    const id = series[0].analyteId.toLowerCase();
    if (question.toLowerCase().includes(id) || question.toLowerCase().includes(name) || nameTokensMatch(question.toLowerCase(), name)) {
      return { selected: series, topicIds: [id], focused: true };
    }
  }

  // Generic blood/results ask → latest panel day (unfocused overview)
  return { selected: measurements, topicIds: [], focused: false };
}

export function catalogueEvidence(ctx: ClinicalContext): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  for (const m of ctx.measurements) {
    items.push({
      evidenceId: m.evidenceId,
      resourceId: m.resourceId,
      informationClass: m.informationClass,
      fields: ['value', 'unit', 'sampledAt', 'displayName', 'referenceLow', 'referenceHigh'],
      payload: m,
      kind: 'measurement',
    });
  }
  for (const e of ctx.events) {
    items.push({
      evidenceId: e.evidenceId,
      resourceId: e.resourceId,
      informationClass: e.informationClass,
      fields: Object.keys(e.fields),
      payload: e,
      kind: 'event',
    });
  }
  return items;
}

export function buildPermittedPack(input: {
  patientId: string;
  viewerId: string;
  outcome: string;
  measurements: Measurement[];
  events: NormalisedEvent[];
  allowedEvidenceIds: string[];
  filteredCount: number;
}) {
  // Newest per analyte first — never hand the model an oldest-only slice of a long history.
  const byAnalyte = new Map<string, Measurement[]>();
  for (const m of input.measurements) {
    const list = byAnalyte.get(m.analyteId) || [];
    list.push(m);
    byAnalyte.set(m.analyteId, list);
  }
  const newestMeasurements: Measurement[] = [];
  const sixMonths = 1000 * 60 * 60 * 24 * 180;
  for (const series of byAnalyte.values()) {
    const sorted = [...series].sort((a, b) => b.sampledAt.localeCompare(a.sampledAt));
    const latest = sorted[0];
    if (!latest) continue;
    newestMeasurements.push(latest);
    const prev = sorted[1];
    if (prev) {
      const latestMs = Date.parse(latest.sampledAt);
      const prevMs = Date.parse(prev.sampledAt);
      if (
        Number.isFinite(latestMs) &&
        Number.isFinite(prevMs) &&
        latestMs - prevMs <= sixMonths
      ) {
        newestMeasurements.push(prev);
      }
    }
  }
  newestMeasurements.sort((a, b) => b.sampledAt.localeCompare(a.sampledAt));
  const capped = newestMeasurements.slice(0, 28);
  const newestEvents = [...input.events].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);

  return {
    patientId: input.patientId,
    viewerId: input.viewerId,
    outcome: input.outcome,
    measurements: capped.map((m) => ({
      evidenceId: m.evidenceId,
      name: m.displayName,
      value: m.value,
      unit: m.unit,
      sampledAt: m.sampledAt,
      referenceLow: m.referenceLow,
      referenceHigh: m.referenceHigh,
    })),
    events: newestEvents.map((e) => ({
      evidenceId: e.evidenceId,
      title: e.title,
      status: e.status,
      summary: truncate(humaniseEventSummary(e), 280),
    })),
    allowedEvidenceIds: input.allowedEvidenceIds,
    filteredCount: input.filteredCount,
  };
}

export function buildVisualisation(
  question: string,
  measurements: Measurement[],
  history?: ChatTurn[],
): VisualisationSpec | undefined {
  if (!measurements.length) return undefined;
  const q = question.toLowerCase();
  const wantsTrend = TREND_Q.test(q);
  const focused = selectLabMeasurements(question, measurements, history);
  const pool = focused.focused && focused.selected.length ? focused.selected : measurements;
  const byAnalyte = new Map<string, Measurement[]>();
  for (const m of pool) {
    const list = byAnalyte.get(m.analyteId) || [];
    list.push(m);
    byAnalyte.set(m.analyteId, list);
  }

  let chosen: Measurement[] | undefined;
  let named = false;
  for (const [, series] of byAnalyte) {
    const id = series[0].analyteId.toLowerCase();
    const name = series[0].displayName.toLowerCase();
    if (q.includes(id) || q.includes(name) || nameTokensMatch(q, name)) {
      chosen = series;
      named = true;
      break;
    }
  }
  // Topic focus (e.g. kidney) with a single dominant analyte series → chart that.
  if (!named && focused.focused && byAnalyte.size === 1) {
    chosen = [...byAnalyte.values()][0];
    named = true;
  }

  // Only visualise when the analyte is named, or the user clearly asks for a trend.
  if (!named && !wantsTrend) return undefined;
  if (!chosen) {
    if (!wantsTrend) return undefined;
    chosen = [...byAnalyte.values()].sort((a, b) => b.length - a.length)[0];
  }
  if (!chosen?.length) return undefined;

  const sorted = [...chosen].sort((a, b) => a.sampledAt.localeCompare(b.sampledAt));
  // Prefer a coherent recent window (drop sparse year-ago outliers when a dense recent series exists).
  const recent = trimStaleSeries(sorted);
  if (recent.length < 1) return undefined;
  if (!named && !wantsTrend && recent.length < 2) return undefined;

  const unit = recent[0].unit;
  return {
    type: 'result_trend',
    title: `${recent[0].displayName} (${unit})`,
    unit,
    evidenceIds: recent.map((m) => m.evidenceId),
    points: recent.map((m) => ({
      date: m.sampledAt,
      value: m.value,
      label: m.displayName,
      evidenceId: m.evidenceId,
    })),
    referenceLow: recent.find((m) => m.referenceLow !== undefined)?.referenceLow,
    referenceHigh: recent.find((m) => m.referenceHigh !== undefined)?.referenceHigh,
    referenceLabel: recent.find((m) => m.referenceLabel)?.referenceLabel || 'Illustrative simulator interval',
  };
}

/** Drop a single distant year-ago point when the rest of the series is clustered. */
function trimStaleSeries(sorted: Measurement[]): Measurement[] {
  if (sorted.length < 3) return sorted;
  const times = sorted.map((m) => Date.parse(m.sampledAt));
  if (times.some((t) => Number.isNaN(t))) return sorted;
  const latest = times[times.length - 1];
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  const medianGap = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] || 0;
  // If the first gap is > ~4 months and much larger than typical spacing, drop the oldest point.
  const fourMonths = 1000 * 60 * 60 * 24 * 120;
  if (gaps[0] > fourMonths && gaps[0] > medianGap * 3) {
    return sorted.slice(1);
  }
  // Also drop points older than ~10 months before latest when a shorter recent run exists.
  const tenMonths = 1000 * 60 * 60 * 24 * 300;
  const recent = sorted.filter((_, i) => latest - times[i] <= tenMonths);
  return recent.length >= 2 ? recent : sorted;
}

function nameTokensMatch(q: string, name: string): boolean {
  const tokens = name.split(/\W+/).filter((t) => t.length > 3);
  return tokens.length > 0 && tokens.every((t) => q.includes(t));
}

export function prefersShortPlain(memoriesHint?: string, question?: string): boolean {
  const blob = `${memoriesHint || ''} ${question || ''}`.toLowerCase();
  return /short|plain.?language|brief|concise|simple updates|not too (long|much)/i.test(blob);
}

/** BP / blood-pressure measurements only (never oxygen or unrelated vitals). */
export function selectBpMeasurements(measurements: Measurement[]): Measurement[] {
  return measurements.filter(
    (m) =>
      BP_MEASUREMENT.test(m.displayName) ||
      BP_MEASUREMENT.test(m.analyteId) ||
      BP_MEASUREMENT.test(m.informationClass || '') ||
      /blood.?pressure|systolic|diastolic/i.test(m.displayName),
  );
}

const PATIENT_UNCERTAINTY =
  'This restates what the record shows for you. It is not a diagnosis or treatment plan — check with the care team if you are unsure.';

export function buildShareConsentAnswer(input: {
  question: string;
  policyNotice?: string;
  viewerIsPatient?: boolean;
}): AgentAnswer {
  const wantsDaughter = /\bdaughter\b/i.test(input.question);
  const who = wantsDaughter ? 'your daughter' : 'family or supporters';
  const answer = input.viewerIsPatient
    ? `Sharing is controlled in Kindred Circle — three levels (Everything, Only practical, Important updates). Nothing goes to ${who} unless you put them on a level.\n\n**What to do next**\nOpen Circle to adjust who can see what.`
    : `I can’t change who has access from this view. Kindred Circle owns sharing levels; the patient manages access there.\n\n**What to do next**\nAsk them to review Circle if they want to share more with ${who}.`;
  return {
    answer,
    facts: [],
    policyNotice: input.policyNotice || undefined,
    citations: [],
    escalation: input.viewerIsPatient
      ? 'Open Kindred Circle to change sharing levels.'
      : 'Ask the patient to open Kindred Circle if they want to change sharing.',
  };
}

export function buildDeterministicAnswer(input: {
  question: string;
  policyNotice?: string;
  outcome: string;
  measurements: Measurement[];
  events: NormalisedEvent[];
  visualisationSpec?: VisualisationSpec;
  appointmentAssist?: AppointmentAssist;
  memoriesHint?: string;
  history?: ChatTurn[];
  viewerIsPatient?: boolean;
}): AgentAnswer {
  if (input.outcome === 'hold') {
    return {
      answer:
        input.policyNotice ||
        "I can’t show that yet — it’s waiting for the patient to release it. Ask them to check Circle.",
      facts: [],
      policyNotice: input.policyNotice,
      citations: [],
      escalation: 'Ask the patient to review Circle, or check with the clinical team.',
    };
  }
  if (input.outcome === 'deny') {
    return {
      answer:
        input.policyNotice ||
        "That isn’t shared with you yet. Ask the patient to open Circle if they’d like to share more.",
      facts: [],
      policyNotice: input.policyNotice,
      citations: [],
      escalation: 'Ask the patient to review Kindred Circle if they want to share more.',
    };
  }

  // Sharing / consent / people — never hijack with labs or appointment memory.
  if (isShareConsentIntent(input.question)) {
    return buildShareConsentAnswer({
      question: input.question,
      policyNotice: input.policyNotice,
      viewerIsPatient: input.viewerIsPatient,
    });
  }

  // Blood pressure / BP — never substitute appointments or unrelated reviews.
  if (isVitalsBpIntent(input.question)) {
    const bp = selectBpMeasurements(input.measurements);
    if (!bp.length) {
      return {
        answer: 'There is no blood pressure reading in the live record for this viewer.',
        facts: [],
        uncertainty: 'No permitted BP measurements were available.',
        policyNotice: input.policyNotice || undefined,
        citations: [],
      };
    }
    const latest = [...bp].sort((a, b) => b.sampledAt.localeCompare(a.sampledAt))[0];
    const facts = [
      {
        text: `Latest blood pressure on record: ${latest.displayName} ${formatNum(latest.value)} ${latest.unit} (sampled ${formatDate(latest.sampledAt)}).`,
        evidenceIds: [latest.evidenceId],
      },
    ];
    return {
      answer: proseFromFacts(facts, { short: true }),
      facts,
      uncertainty: PATIENT_UNCERTAINTY,
      policyNotice: input.policyNotice || undefined,
      citations: [
        {
          evidenceId: latest.evidenceId,
          resourceId: latest.resourceId,
          title: latest.displayName,
          date: latest.sampledAt,
          service: latest.service,
          kind: 'measurement',
        },
      ],
    };
  }

  const facts: { text: string; evidenceIds: string[] }[] = [];
  const citations: Citation[] = [];
  const cite = (title: string, evidenceId: string, resourceId: string, service: string, kind: string, date?: string) => {
    if (citations.some((c) => c.evidenceId === evidenceId)) return;
    citations.push({ evidenceId, resourceId, title, date, service, kind });
  };

  const followUp = isFollowUpQuestion(input.question, input.history);
  const labIntent = isLabIntent(input.question, input.history);
  const apptIntent = isAppointmentIntent(input.question);
  const docIntent = isDocumentIntent(input.question);
  const short = prefersShortPlain(input.memoriesHint, input.question) || followUp;
  const wantsFullPanel = /\b(full|every|all|complete|entire)\b.*\b(panel|result|blood|lab)/i.test(input.question);
  const labPick = selectLabMeasurements(input.question, input.measurements, input.history);
  const labMeasurements = labPick.selected;

  if (labIntent && !labMeasurements.length) {
    const topicLabel = labPick.topicIds.includes('kidney')
      ? 'kidney / U&E'
      : labPick.topicIds.includes('lft')
        ? 'liver (LFT)'
        : labPick.topicIds.includes('fbc')
          ? 'full blood count'
          : labPick.focused
            ? 'that topic'
            : 'blood / lab';
    return {
      answer: `I do not see permitted ${topicLabel} measurements in the live record for this viewer. Try another result topic, or refresh after selecting a patient with those labs.`,
      facts: [],
      uncertainty: 'No matching permitted analytes for the requested topic.',
      policyNotice: input.policyNotice,
      citations: [],
      appointmentAssist: input.appointmentAssist,
    };
  }

  if (labMeasurements.length && labIntent) {
    const latestDay = latestSampleDay(labMeasurements);
    const latestPanel = labMeasurements
      .filter((m) => sampleDay(m.sampledAt) === latestDay)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
    // Dedupe to newest per analyte on that day
    const byName = new Map<string, Measurement>();
    for (const m of latestPanel) {
      const prev = byName.get(m.analyteId);
      if (!prev || m.sampledAt > prev.sampledAt) byName.set(m.analyteId, m);
    }
    const panel = [...byName.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
    const flagged = panel.filter(isOutOfRange);
    const maxHighlight = labPick.focused ? (short ? 4 : 8) : short && !wantsFullPanel ? 3 : 8;
    const highlight = flagged.length && !labPick.focused ? flagged : panel.slice(0, maxHighlight);
    const valuesToShow =
      wantsFullPanel && !labPick.focused ? panel : labPick.focused || short || followUp ? highlight : panel.slice(0, 8);

    const topicLabel = labPick.topicIds.includes('kidney')
      ? 'kidney / U&E-related'
      : labPick.topicIds.includes('lft')
        ? 'liver (LFT)'
        : labPick.topicIds.includes('fbc')
          ? 'full blood count'
          : labPick.focused
            ? 'requested'
            : 'blood';

    facts.push({
      text: labPick.focused
        ? `Latest ${topicLabel} results on record are from ${formatDate(latestDay)}.`
        : `Latest blood results on record are from ${formatDate(latestDay)}.`,
      evidenceIds: valuesToShow.map((m) => m.evidenceId),
    });

    for (const m of valuesToShow) {
      const range =
        m.referenceLow !== undefined || m.referenceHigh !== undefined
          ? ` (illustrative range ${m.referenceLow ?? '—'}–${m.referenceHigh ?? '—'} ${m.unit})`
          : '';
      const flag = isOutOfRange(m) ? ' — outside illustrative range' : '';
      facts.push({
        text: `${m.displayName}: ${formatNum(m.value)} ${m.unit}${flag}${range}.`,
        evidenceIds: [m.evidenceId],
      });
      cite(m.displayName, m.evidenceId, m.resourceId, m.service, 'measurement', m.sampledAt);
    }

    // Prior value for the primary highlighted analyte (longest series or first flagged).
    const primary = pickPrimaryAnalyte(labMeasurements, input.question, flagged[0] || valuesToShow[0]);
    if (primary) {
      const sorted = [...primary].sort((a, b) => a.sampledAt.localeCompare(b.sampledAt));
      if (sorted.length >= 2) {
        const prev = sorted[sorted.length - 2];
        const latest = sorted[sorted.length - 1];
        facts.push({
          text: `Previous ${latest.displayName} was ${formatNum(prev.value)} ${prev.unit} on ${formatDate(prev.sampledAt)}.`,
          evidenceIds: [prev.evidenceId],
        });
        cite(prev.displayName, prev.evidenceId, prev.resourceId, prev.service, 'measurement', prev.sampledAt);
      }
    }

    // Lab-related resources only — skip on focused follow-ups to avoid repeating the full panel dump.
    if (!labPick.focused || !followUp) {
      for (const ev of rankEvents(input.question, input.events, { labIntent: true }).slice(0, labPick.focused ? 1 : 3)) {
        if (!isLabRelatedEvent(ev)) continue;
        facts.push({
          text: formatEventFact(ev),
          evidenceIds: [ev.evidenceId],
        });
        cite(ev.title, ev.evidenceId, ev.resourceId, ev.service, ev.kind, ev.at);
      }
    }
  } else {
    // Non-lab asks: only surface events when the question is about appointments/docs/general record — never invent a clinical substitute.
    const relevantEvents = rankEvents(input.question, input.events, {
      labIntent: false,
      apptIntent,
      docIntent,
    }).slice(0, apptIntent || docIntent ? 5 : 3);
    // Avoid dumping appointments for vague clinical asks that didn't match lab/vitals routing.
    const allowEvents = apptIntent || docIntent || /what.*(happening|next|record|care)|status|update/i.test(input.question);
    if (allowEvents) {
      if (docIntent) {
        pushDocumentFacts(relevantEvents, facts, cite);
      } else {
        for (const ev of relevantEvents) {
          facts.push({
            text: formatEventFact(ev),
            evidenceIds: [ev.evidenceId],
          });
          cite(ev.title, ev.evidenceId, ev.resourceId, ev.service, ev.kind, ev.at);
        }
      }
    }

    if (input.measurements.length && /result|value|number|level/i.test(input.question) && !apptIntent && !docIntent) {
      const byAnalyte = groupByAnalyte(input.measurements);
      const series = [...byAnalyte.values()].sort((a, b) => b.length - a.length)[0];
      const sorted = [...series].sort((a, b) => a.sampledAt.localeCompare(b.sampledAt));
      const latest = sorted[sorted.length - 1];
      facts.unshift({
        text: `Latest ${latest.displayName} is ${formatNum(latest.value)} ${latest.unit} (sampled ${formatDate(latest.sampledAt)}).`,
        evidenceIds: [latest.evidenceId],
      });
      cite(latest.displayName, latest.evidenceId, latest.resourceId, latest.service, 'measurement', latest.sampledAt);
    }
  }

  let recordedNextStep: AgentAnswer['recordedNextStep'];
  if ((!labIntent && (apptIntent || docIntent)) || docIntent || /next step|what happens next|follow.?up|need to do next/i.test(input.question)) {
    const next =
      input.events.find((e) => /follow|task|action|review|plan/i.test(`${e.title} ${e.summary}`)) ||
      input.events.find((e) => /appoint/i.test(`${e.title} ${e.kind}`));
    if (next) {
      const substance = extractEventSubstance(next) || truncate(humaniseEventSummary(next), 160);
      recordedNextStep = {
        text: substance
          ? `Recorded next step from ${friendlyDocTitle(next)}: ${substance}`
          : `Recorded next step: ${next.title}.`,
        evidenceIds: [next.evidenceId],
      };
      cite(next.title, next.evidenceId, next.resourceId, next.service, next.kind, next.at);
    }
  }

  if (!facts.length) {
    return {
      answer:
        'The retrieved record for this patient does not contain enough permitted evidence to answer that question. Try another topic from the suggestions, or refresh after selecting a patient with supporting records.',
      facts: [],
      uncertainty: 'No matching permitted evidence was available for this query.',
      policyNotice: input.policyNotice,
      citations: [],
      appointmentAssist: input.appointmentAssist,
    };
  }

  const answer =
    input.appointmentAssist && apptIntent
      ? input.appointmentAssist.notice
      : proseFromFacts(facts, {
          short,
          labIntent,
          docIntent,
          apptIntent,
          memoriesHint: input.memoriesHint,
          recordedNextStep: recordedNextStep?.text,
          question: input.question,
        });

  return {
    answer,
    facts,
    uncertainty: PATIENT_UNCERTAINTY,
    recordedNextStep,
    policyNotice: input.policyNotice || undefined,
    citations,
    visualisationSpec: input.visualisationSpec,
    appointmentAssist: input.appointmentAssist,
  };
}

/** Deterministic patient-facing prose from structured facts only. */
export function proseFromFacts(
  facts: { text: string; evidenceIds: string[] }[],
  opts?: {
    short?: boolean;
    labIntent?: boolean;
    docIntent?: boolean;
    apptIntent?: boolean;
    memoriesHint?: string;
    recordedNextStep?: string;
    question?: string;
  },
): string {
  if (!facts.length) return 'I could not find permitted evidence for that question.';
  const short = opts?.short ?? false;
  const lines = facts.map((f) => f.text);

  if (opts?.labIntent) {
    const dateLine = lines.find((l) => /latest .+ results on record/i.test(l));
    const valueLines = lines.filter((l) => /: .+/.test(l) && !/previous |on record/i.test(l));
    const prev = lines.find((l) => /^Previous /i.test(l));
    const flagged = valueLines.filter((l) => /outside illustrative range/i.test(l));
    const ok = valueLines.filter((l) => !/outside illustrative range/i.test(l));
    const focused = /kidney|u&e|liver|full blood count|requested/i.test(dateLine || '');

    const knowBits: string[] = [];
    if (dateLine) knowBits.push(dateLine.replace(/\.$/, ''));
    const valueBullets = [
      ...flagged.slice(0, short ? 3 : 6).map((l) => `• ${stripFactChrome(l)}`),
      ...ok.slice(0, short || focused ? 4 : 4).map((l) => `• ${stripFactChrome(l)}`),
    ];
    if (prev && !short) knowBits.push(prev.replace(/\.$/, ''));

    const meaningBits: string[] = [];
    if (flagged.length) {
      meaningBits.push(
        short
          ? `${flagged.length === 1 ? 'One value sits' : 'Some values sit'} outside the illustrative range shown on the record.`
          : `${flagged.length === 1 ? 'One value sits' : `${flagged.length} values sit`} outside the illustrative range shown on the record — worth noting with the care team if it hasn’t been discussed.`,
      );
    } else if (ok.some(line => /illustrative range/i.test(line))) {
      meaningBits.push('The values with a reference range shown are within that range.');
    }
    if (prev && !short) {
      meaningBits.push('A previous reading is included above so you can see the change over time.');
    }

    const nextBits = short && !focused
      ? ['Ask if you want the full panel, or take these figures to your next review.']
      : ['Take these figures to your next review if you want them explained in context.'];

    const sections = [
      `**What we know**\n${[...knowBits, ...valueBullets].join('\n')}`,
      meaningBits.length ? `**What it means**\n${meaningBits.join('\n')}` : '',
      `**What to do next**\n${nextBits.join('\n')}`,
    ].filter(Boolean);

    return sections.join('\n\n');
  }

  if (opts?.docIntent || opts?.apptIntent) {
    return proseFromEventFacts(lines, {
      short,
      docIntent: Boolean(opts.docIntent),
      apptIntent: Boolean(opts.apptIntent),
      recordedNextStep: opts.recordedNextStep,
      question: opts.question,
    });
  }

  const cleaned = lines.map(stripFactChrome).filter((l) => l && !isWorkflowChrome(l));
  const lead = cleaned[0] || lines[0];
  const rest = cleaned.slice(1, short ? 3 : 4);
  const knowBody = rest.length
    ? `${lead}\n${rest.map((r) => `• ${r}`).join('\n')}`
    : lead;
  const meaning = rest.length
    ? 'Taken together, this is what the shared record currently shows for that question.'
    : 'This is the clearest permitted detail in the record for that question.';
  const next = opts?.recordedNextStep
    ? stripRecordedNextPrefix(opts.recordedNextStep)
    : 'If anything is unclear, check with the care team at your next contact.';

  return `**What we know**\n${knowBody}\n\n**What it means**\n${meaning}\n\n**What to do next**\n${next}`;
}

function proseFromEventFacts(
  lines: string[],
  opts: {
    short?: boolean;
    docIntent: boolean;
    apptIntent: boolean;
    recordedNextStep?: string;
    question?: string;
  },
): string {
  const cleaned = lines.map(stripFactChrome).filter((l) => l && !isWorkflowChrome(l));
  const actionLines = cleaned.filter((l) => looksLikeActionLine(l));
  const contextLines = cleaned.filter((l) => !looksLikeActionLine(l));
  const wantsNext = /next|do |follow|plan|should i/i.test(opts.question || '');

  const knowBits: string[] = [];
  if (opts.docIntent && (actionLines.length || contextLines.length)) {
    const intro = wantsNext
      ? 'Your latest care notes include these follow-up points:'
      : 'From the latest letters and care notes on record:';
    knowBits.push(intro);
    const bullets = (actionLines.length ? actionLines : contextLines).slice(0, opts.short ? 3 : 4);
    for (const b of bullets) knowBits.push(`• ${b}`);
  } else if (opts.apptIntent) {
    const intro = contextLines[0] || cleaned[0] || 'An appointment-related note is in the record.';
    knowBits.push(intro);
    for (const b of contextLines.slice(1, opts.short ? 2 : 3)) knowBits.push(`• ${b}`);
  } else {
    knowBits.push(cleaned[0] || lines[0]);
    for (const b of cleaned.slice(1, 3)) knowBits.push(`• ${b}`);
  }

  const meaningBits: string[] = [];
  if (opts.docIntent && actionLines.length) {
    meaningBits.push(
      'These are actions already written into your record by the care team — Kindred is restating them, not adding new advice.',
    );
  } else if (opts.docIntent) {
    meaningBits.push(
      'The shared documents describe what was recorded at that visit; they do not add a new diagnosis from Kindred.',
    );
  } else if (opts.apptIntent) {
    meaningBits.push(
      'This reflects appointment status in the record only — a preference or open slot is not the same as a confirmed booking.',
    );
  } else {
    meaningBits.push('This is what the permitted record shows for that question.');
  }

  const nextBits: string[] = [];
  if (opts.recordedNextStep) {
    nextBits.push(stripRecordedNextPrefix(opts.recordedNextStep));
  } else if (actionLines.length) {
    nextBits.push('Follow the points above, and ask the care team if any step is unclear.');
  } else if (opts.apptIntent) {
    nextBits.push('Ask the care team to confirm the time if you are unsure whether it is booked.');
  } else {
    nextBits.push('Ask the care team if you want this explained in more detail.');
  }

  return [
    `**What we know**\n${knowBits.join('\n')}`,
    `**What it means**\n${meaningBits.join('\n')}`,
    `**What to do next**\n${nextBits.join('\n')}`,
  ].join('\n\n');
}

function stripFactChrome(line: string): string {
  return line
    .replace(/\s*—\s*outside illustrative range/gi, ' (outside illustrative range)')
    .replace(/\s*\(illustrative range[^)]*\)\.?/gi, '')
    .replace(/\bStatus:\s*[\w\s-]+/gi, '')
    .replace(/\(\s*(sent|completed|draft|pending|recorded|arrived|booked|requested)\s*\)/gi, '')
    .replace(/\s*[—-]\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\.\s*\./g, '.')
    .replace(/\.$/, '')
    .trim();
}

function isWorkflowChrome(line: string): boolean {
  const t = line.trim();
  return /^(status|stage)\b/i.test(t) || /^(sent|completed|draft|pending)$/i.test(t);
}

function looksLikeActionLine(line: string): boolean {
  return /\b(continue|monitor|attend|follow|review|take|book|return|contact|check|keep|arrange|discuss|complete|start|stop|reduce|increase)\b/i.test(
    line,
  );
}

function stripRecordedNextPrefix(text: string): string {
  return text.replace(/^Recorded next step(?: from [^:]+)?:\s*/i, '').trim();
}

function pushDocumentFacts(
  events: NormalisedEvent[],
  facts: { text: string; evidenceIds: string[] }[],
  cite: (title: string, evidenceId: string, resourceId: string, service: string, kind: string, date?: string) => void,
) {
  const docs = events.filter(isDocumentLikeEvent).slice(0, 3);
  const pool = docs.length ? docs : events.slice(0, 3);
  for (const ev of pool) {
    const actions = extractActionLines(ev);
    const substance = extractEventSubstance(ev);
    if (actions.length) {
      facts.push({
        text: `From ${friendlyDocTitle(ev)} (${formatDate(ev.at)}):`,
        evidenceIds: [ev.evidenceId],
      });
      for (const a of actions.slice(0, 4)) {
        facts.push({ text: a, evidenceIds: [ev.evidenceId] });
      }
    } else if (substance) {
      facts.push({
        text: `${friendlyDocTitle(ev)} (${formatDate(ev.at)}): ${substance}`,
        evidenceIds: [ev.evidenceId],
      });
    } else {
      facts.push({
        text: formatEventFact(ev),
        evidenceIds: [ev.evidenceId],
      });
    }
    cite(ev.title, ev.evidenceId, ev.resourceId, ev.service, ev.kind, ev.at);
  }
}

function isDocumentLikeEvent(ev: NormalisedEvent): boolean {
  return /document|discharge|handover|letter|summary|consult|care\s*plan|note/i.test(
    `${ev.kind} ${ev.title} ${ev.informationClass}`,
  );
}

function friendlyDocTitle(ev: NormalisedEvent): string {
  const t = ev.title.replace(/^Clinical Document:\s*/i, '').trim();
  return t || ev.title;
}

function extractActionLines(ev: NormalisedEvent): string[] {
  const raw = `${ev.summary || ''}\n${ev.rawSnippet || ''}`.replace(/\s+/g, ' ').trim();
  if (!raw) return [];
  const human = humaniseEventSummary(ev);
  const blob = stripFactChrome(human || raw);
  const chunks = blob
    .split(/(?:;\s+|\.\s+(?=[A-Z])|\n+|•\s+)/)
    .map((c) => stripFactChrome(c))
    .filter((c) => c.length > 12 && looksLikeActionLine(c));
  return [...new Set(chunks)].slice(0, 4);
}

function extractEventSubstance(ev: NormalisedEvent): string {
  const human = stripFactChrome(humaniseEventSummary(ev));
  if (!human) return '';
  // Drop fictional-workflow boilerplate that doesn't help patients.
  const cleaned = human
    .replace(/\bThis is a fictional episode[^.]*\.?/gi, '')
    .replace(/\bfor document workflow practice[^.]*\.?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return truncate(cleaned, 220);
}

export function formatEventFact(ev: NormalisedEvent): string {
  const substance = extractEventSubstance(ev);
  const when = formatDate(ev.at);
  const title = friendlyDocTitle(ev);
  if (substance) {
    return `${title} (${when}): ${substance}`;
  }
  return `${title} on ${when}.`;
}

export function humaniseEventSummary(ev: NormalisedEvent): string {
  const raw = (ev.summary || ev.rawSnippet || '').trim();
  if (!raw) return '';
  if (looksLikeJson(raw)) {
    return humaniseJsonBlob(raw) || ev.title;
  }
  if (looksLikeJson(raw.slice(raw.indexOf('{')))) {
    const start = raw.indexOf('{');
    const prefix = raw.slice(0, start).trim().replace(/[—:-]+$/, '').trim();
    const human = humaniseJsonBlob(raw.slice(start));
    return [prefix, human].filter(Boolean).join(' — ');
  }
  return raw.replace(/\s+/g, ' ').trim();
}

function looksLikeJson(s: string): boolean {
  const t = s.trim();
  return t.startsWith('{') || t.startsWith('[');
}

export function humaniseJsonBlob(raw: string): string {
  try {
    const obj = JSON.parse(raw);
    return summariseUnknown(obj, 0);
  } catch {
    // Truncated JSON in facts — strip braces and quote noise for readability.
    return raw
      .replace(/[{}\[\]"]/g, ' ')
      .replace(/\b(stage|sentAt|sentBy|assignee|sections|entries|kind|panel|analytes|id|name|unit|value|referenceLow|referenceHigh|body|actor)\b/gi, ' ')
      .replace(/[,:]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220);
  }
}

function summariseUnknown(value: unknown, depth: number): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.slice(0, 240);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (depth > 3) return '';
  if (Array.isArray(value)) {
    return value
      .slice(0, 4)
      .map((v) => summariseUnknown(v, depth + 1))
      .filter(Boolean)
      .join('. ');
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    // Blood panel shape
    if (o.analytes && Array.isArray(o.analytes)) {
      const panel = (o.panel as { name?: string } | undefined)?.name || (o.kind as string) || 'Panel';
      const bits = (o.analytes as Record<string, unknown>[])
        .slice(0, 6)
        .map((a) => {
          const name = String(a.name || a.id || 'result');
          const v = a.value;
          const unit = a.unit ? ` ${a.unit}` : '';
          return v !== undefined ? `${name} ${v}${unit}` : name;
        });
      return `${panel}: ${bits.join(', ')}`;
    }
    if (Array.isArray(o.entries)) {
      const bodies = (o.entries as Record<string, unknown>[])
        .map((e) => asText(e.body) || asText(e.text))
        .filter(Boolean)
        .slice(0, 2);
      if (bodies.length) return bodies.join(' ');
    }
    if (o.sections && typeof o.sections === 'object') {
      const secs = o.sections as Record<string, unknown>;
      const preferred = ['reason', 'course', 'plan', 'actions', 'followUp'];
      const parts: string[] = [];
      for (const k of preferred) {
        const t = asText(secs[k]);
        if (t) parts.push(t.slice(0, 120));
      }
      if (parts.length) {
        const who = asText(o.sentBy);
        const head = who ? `From ${who}` : '';
        return [head, parts.join(' ')].filter(Boolean).join('. ');
      }
    }
    const preferredKeys = ['text', 'body', 'summary', 'notes', 'reason', 'message', 'notice', 'statusText', 'followUp'];
    for (const k of preferredKeys) {
      const t = asText(o[k]);
      if (t) return t.slice(0, 240);
    }
    const stage = asText(o.stage);
    const status = asText(o.status);
    if (stage || status) return `Status: ${humanStatus(stage || status || '')}`;
    return Object.entries(o)
      .slice(0, 4)
      .map(([k, v]) => {
        if (v && typeof v === 'object') return '';
        const label = k.replace(/_/g, ' ');
        return `${label}: ${String(v)}`;
      })
      .filter(Boolean)
      .join('. ')
      .slice(0, 220);
  }
  return '';
}

function asText(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v.trim();
  return undefined;
}

function humanStatus(status: string): string {
  if (!status) return 'recorded';
  if (looksLikeJson(status)) return humaniseJsonBlob(status) || 'recorded';
  return status.replace(/_/g, ' ');
}

function isLabRelatedEvent(ev: NormalisedEvent): boolean {
  const hay = `${ev.kind} ${ev.title} ${ev.informationClass}`.toLowerCase();
  return /lab|blood|result|patholog|diagnostic|report|panel|fbc|lft|ue\b|hba1c|observation/.test(hay);
}

function isOutOfRange(m: Measurement): boolean {
  if (m.referenceLow !== undefined && m.value < m.referenceLow) return true;
  if (m.referenceHigh !== undefined && m.value > m.referenceHigh) return true;
  return false;
}

function sampleDay(iso: string): string {
  const d = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : iso;
}

function latestSampleDay(measurements: Measurement[]): string {
  return measurements.map((m) => sampleDay(m.sampledAt)).sort().at(-1) || '';
}

function groupByAnalyte(measurements: Measurement[]): Map<string, Measurement[]> {
  const byAnalyte = new Map<string, Measurement[]>();
  for (const m of measurements) {
    const list = byAnalyte.get(m.analyteId) || [];
    list.push(m);
    byAnalyte.set(m.analyteId, list);
  }
  return byAnalyte;
}

function pickPrimaryAnalyte(
  measurements: Measurement[],
  question: string,
  flagged?: Measurement,
): Measurement[] | undefined {
  const q = question.toLowerCase();
  const byAnalyte = groupByAnalyte(measurements);
  for (const [, series] of byAnalyte) {
    const name = series[0].displayName.toLowerCase();
    const id = series[0].analyteId.toLowerCase();
    if (q.includes(id) || q.includes(name)) return series;
  }
  if (flagged) return byAnalyte.get(flagged.analyteId);
  return [...byAnalyte.values()].sort((a, b) => b.length - a.length)[0];
}

function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n);
}

/**
 * Reject model prose that introduces numbers not present in structured facts / known measurements.
 * Years and calendar day-of-month near month names are ignored.
 */
export function proseMatchesFacts(
  prose: string,
  facts: { text: string }[],
  measurements: Measurement[] = [],
): boolean {
  const allowed = new Set<number>();
  const absorb = (text: string) => {
    for (const n of extractNumbers(text)) allowed.add(n);
  };
  for (const f of facts) absorb(f.text);
  for (const m of measurements) {
    allowed.add(m.value);
    if (m.referenceLow !== undefined) allowed.add(m.referenceLow);
    if (m.referenceHigh !== undefined) allowed.add(m.referenceHigh);
  }

  const cleaned = prose
    .replace(/\b(19|20)\d{2}\b/g, ' ') // years
    .replace(
      /\b([0-3]?\d)\s+(January|February|March|April|May|June|July|August|September|October|November|December)\b/gi,
      ' ',
    )
    .replace(/×\s*10\s*[⁹9]/gi, ' ')
    .replace(/\b10[⁹9]\b/g, ' ');

  for (const n of extractNumbers(cleaned)) {
    if (n >= 1 && n <= 31) continue; // residual day/month fragments
    if (!allowed.has(n)) return false;
  }
  return true;
}

function extractNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\d+(?:\.\d+)?/g)) {
    const n = Number(m[0]);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

export function factsContainRawJson(facts: { text: string }[]): boolean {
  return facts.some((f) => /[{[]/.test(f.text) && /".*":/.test(f.text));
}

function rankEvents(
  question: string,
  events: NormalisedEvent[],
  intent?: { labIntent?: boolean; apptIntent?: boolean; docIntent?: boolean },
): NormalisedEvent[] {
  const tokens = question.toLowerCase().split(/\W+/).filter((t) => t.length > 3);
  return [...events].sort((a, b) => score(b, tokens, intent) - score(a, tokens, intent));
}

function score(
  ev: NormalisedEvent,
  tokens: string[],
  intent?: { labIntent?: boolean; apptIntent?: boolean; docIntent?: boolean },
): number {
  const hay = `${ev.title} ${ev.summary} ${ev.kind} ${ev.status} ${ev.informationClass}`.toLowerCase();
  let s = 0;
  for (const t of tokens) if (hay.includes(t)) s += 2;
  if (intent?.labIntent) {
    if (isLabRelatedEvent(ev)) s += 6;
    else if (/discharge|appoint|message|conversation|booking|handover/.test(hay)) s -= 8;
  }
  if (intent?.apptIntent && /appoint|slot|book|diary/.test(hay)) s += 5;
  if (intent?.docIntent && /discharge|document|letter|handover|summary/.test(hay)) s += 5;
  if (/appoint|task|discharge|handover|result|pharmac|follow|blood|lab/.test(hay)) s += 1;
  return s;
}

export async function clarifyAppointment(
  client: AnimaClient,
  events: NormalisedEvent[],
  question: string,
): Promise<AppointmentAssist> {
  const preference = events.find((e) => /afternoon|prefer|preference/i.test(`${e.title} ${humaniseEventSummary(e)}`));
  const booked = events.find(
    (e) => /appoint/i.test(e.kind + e.title) && /book|confirm|scheduled|arrived/i.test(e.status + e.summary),
  );
  const request = events.find(
    (e) => /appoint/i.test(e.kind + e.title) && /request|waiting|pending/i.test(e.status + e.summary),
  );
  const wantsNewBooking = /book|find (an |a )?afternoon|find (an |a )?appointment|available slot/i.test(question);

  const preferenceSummary = preference
    ? truncate(`${preference.title}: ${humaniseEventSummary(preference)}`, 200)
    : /afternoon/i.test(question)
      ? 'Question mentions an afternoon preference; no separate preference record was found in permitted evidence.'
      : undefined;

  const dates = [new Date(), new Date(Date.now() + 86400000)].map((d) => d.toISOString().slice(0, 10));
  const slots: AppointmentAssist['availableSlots'] = [];
  for (const date of dates) {
    try {
      const book = await client.getAppointments('gp', date);
      slots.push(...extractSlots(book, date));
    } catch {
      /* leave unsupported portion honest */
    }
  }

  if (wantsNewBooking) {
    return {
      stage: slots.length ? 'slots' : request ? 'request' : preferenceSummary ? 'preference' : 'awaiting_confirmation',
      preferenceSummary,
      requestSummary: request
        ? truncate(`${request.title}: ${humaniseEventSummary(request)}`, 200)
        : booked
          ? `Existing recorded booking: ${booked.title} (${humanStatus(booked.status)}). This is not a new CareCircle booking.`
          : undefined,
      availableSlots: slots.slice(0, 8),
      notice:
        'No booking was submitted. Kindred can clarify preference, request, available slots, and confirmed bookings — it will not book a slot until you confirm the exact patient and time.',
    };
  }

  if (booked) {
    return {
      stage: 'confirmed',
      preferenceSummary,
      requestSummary: request ? truncate(humaniseEventSummary(request), 180) : undefined,
      availableSlots: slots.slice(0, 8),
      confirmed: { startsAt: booked.at, resourceId: booked.resourceId },
      notice: `A booked follow-up appears in the record (${booked.title}, status ${humanStatus(booked.status)}${
        booked.at ? `, ${formatDate(booked.at)}` : ''
      }). ${preferenceSummary ? `Preference note: ${preferenceSummary}. ` : ''}An afternoon preference is not itself a booking.`,
    };
  }

  if (slots.length) {
    return {
      stage: 'slots',
      preferenceSummary,
      requestSummary: request ? truncate(humaniseEventSummary(request), 180) : undefined,
      availableSlots: slots.slice(0, 8),
      notice:
        'Available diary slots were retrieved from the GP appointment book. No booking has been made. Confirm an exact patient and time before any booking is submitted.',
    };
  }

  if (request || preferenceSummary) {
    return {
      stage: request ? 'request' : 'preference',
      preferenceSummary,
      requestSummary: request ? truncate(`${request.title}: ${humaniseEventSummary(request)}`, 200) : undefined,
      notice:
        'Kindred can clarify preferences and recorded requests. Live open slots were not returned for the queried dates, so no booking is offered.',
    };
  }

  return {
    stage: 'unsupported',
    notice:
      'No confirmed booking, open slot list, or appointment preference was found in permitted evidence for this patient.',
  };
}

function extractSlots(book: unknown, date: string): NonNullable<AppointmentAssist['availableSlots']> {
  const out: NonNullable<AppointmentAssist['availableSlots']> = [];
  const visit = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    const status = String(o.status ?? o.slotStatus ?? '');
    const startsAt = String(o.startsAt ?? o.start ?? o.time ?? '');
    const available =
      /free|open|available/i.test(status) ||
      o.available === true ||
      o.booked === false ||
      (!o.patientId && startsAt);
    if (available && startsAt) {
      out.push({
        startsAt: startsAt.includes('T') ? startsAt : `${date}T${startsAt}`,
        sessionId: typeof o.sessionId === 'string' ? o.sessionId : typeof o.id === 'string' ? o.id : undefined,
        sessionVersion:
          typeof o.sessionVersion === 'number' ? o.sessionVersion : typeof o.version === 'number' ? o.version : undefined,
        clinician:
          typeof o.clinician === 'string' ? o.clinician : typeof o.practitioner === 'string' ? o.practitioner : undefined,
        title: typeof o.title === 'string' ? o.title : undefined,
      });
    }
    for (const v of Object.values(o)) {
      if (v && typeof v === 'object') visit(v);
    }
  };
  visit(book);
  return out;
}

export function formatDate(iso: string): string {
  // Prefer calendar date from YYYY-MM-DD to avoid TZ day-shift.
  const day = iso.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const [y, m, d] = day.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

export function sanitizeAnswerCitations(answer: AgentAnswer, allowedIds: Set<string>): AgentAnswer {
  const next = { ...answer };
  next.citations = (answer.citations || []).filter((c) => allowedIds.has(c.evidenceId));
  next.facts = (answer.facts || []).filter((f) => f.evidenceIds.every((id) => allowedIds.has(id)));
  if (next.visualisationSpec) {
    next.visualisationSpec = {
      ...next.visualisationSpec,
      evidenceIds: next.visualisationSpec.evidenceIds.filter((id) => allowedIds.has(id)),
      points: next.visualisationSpec.points?.filter((p) => allowedIds.has(p.evidenceId)),
    };
    if (!next.visualisationSpec.points?.length) {
      next.visualisationSpec = undefined;
    }
  }
  // Final safety: never surface raw JSON blobs in facts.
  next.facts = (next.facts || []).map((f) =>
    looksLikeJson(f.text) || /\{"/.test(f.text)
      ? { ...f, text: humaniseJsonBlob(f.text.includes('{') ? f.text.slice(f.text.indexOf('{')) : f.text) || f.text }
      : f,
  );
  return next;
}
