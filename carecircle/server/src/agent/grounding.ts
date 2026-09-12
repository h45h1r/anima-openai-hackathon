/**
 * Deterministic grounding helpers — citations, visualisation, appointment stages.
 * Safety-critical booking rules live here (slots ≠ booked).
 */
import type { AnimaClient } from '../anima/client.js';
import type {
  AgentAnswer,
  AppointmentAssist,
  Citation,
  ClinicalContext,
  Measurement,
  NormalisedEvent,
  VisualisationSpec,
} from '../types/domain.js';
import type { EvidenceItem } from '../consent/policy.js';

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
  return {
    patientId: input.patientId,
    viewerId: input.viewerId,
    outcome: input.outcome,
    measurements: input.measurements.slice(0, 20).map((m) => ({
      evidenceId: m.evidenceId,
      name: m.displayName,
      value: m.value,
      unit: m.unit,
      sampledAt: m.sampledAt,
    })),
    events: input.events.slice(0, 12).map((e) => ({
      evidenceId: e.evidenceId,
      title: e.title,
      status: e.status,
      summary: truncate(e.summary, 300),
    })),
    allowedEvidenceIds: input.allowedEvidenceIds,
    filteredCount: input.filteredCount,
  };
}

export function buildVisualisation(question: string, measurements: Measurement[]): VisualisationSpec | undefined {
  if (!measurements.length) return undefined;
  const q = question.toLowerCase();
  const byAnalyte = new Map<string, Measurement[]>();
  for (const m of measurements) {
    const list = byAnalyte.get(m.analyteId) || [];
    list.push(m);
    byAnalyte.set(m.analyteId, list);
  }
  let chosen: Measurement[] | undefined;
  for (const [, series] of byAnalyte) {
    if (q.includes(series[0].analyteId) || q.includes(series[0].displayName.toLowerCase())) {
      chosen = series;
      break;
    }
  }
  if (!chosen) {
    chosen = [...byAnalyte.values()].sort((a, b) => b.length - a.length)[0];
  }
  if (!chosen || chosen.length < 1) return undefined;
  if (!/trend|chart|graph|changed|over time|explain|result|blood|lft|compare/.test(q) && chosen.length < 2) {
    if (!/explain|result|blood|latest|what/.test(q)) return undefined;
  }
  const sorted = [...chosen].sort((a, b) => a.sampledAt.localeCompare(b.sampledAt));
  const unit = sorted[0].unit;
  return {
    type: 'result_trend',
    title: `${sorted[0].displayName} (${unit})`,
    unit,
    evidenceIds: sorted.map((m) => m.evidenceId),
    points: sorted.map((m) => ({
      date: m.sampledAt,
      value: m.value,
      label: m.displayName,
      evidenceId: m.evidenceId,
    })),
    referenceLow: sorted.find((m) => m.referenceLow !== undefined)?.referenceLow,
    referenceHigh: sorted.find((m) => m.referenceHigh !== undefined)?.referenceHigh,
    referenceLabel: sorted.find((m) => m.referenceLabel)?.referenceLabel || 'Illustrative simulator interval',
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
}): AgentAnswer {
  if (input.outcome === 'hold') {
    return {
      answer:
        'I cannot confirm whether a new result exists or what it shows. It is held until the patient communication state is recorded in CareCircle.',
      facts: [],
      policyNotice: input.policyNotice,
      citations: [],
      escalation: 'Please check with the patient or the clinical team for disclosure status.',
    };
  }
  if (input.outcome === 'deny') {
    return {
      answer:
        'That clinical detail is outside your current CareCircle access. I can help with topics the patient has shared with you.',
      facts: [],
      policyNotice: input.policyNotice,
      citations: [],
      escalation: 'Ask the patient to review People and access if they want to share more.',
    };
  }

  const facts: { text: string; evidenceIds: string[] }[] = [];
  const citations: Citation[] = [];
  const cite = (title: string, evidenceId: string, resourceId: string, service: string, kind: string, date?: string) => {
    if (citations.some((c) => c.evidenceId === evidenceId)) return;
    citations.push({ evidenceId, resourceId, title, date, service, kind });
  };

  if (input.measurements.length && /result|blood|lft|egfr|trend|explain|alt|alp|hba1c/i.test(input.question)) {
    const byAnalyte = new Map<string, Measurement[]>();
    for (const m of input.measurements) {
      const list = byAnalyte.get(m.analyteId) || [];
      list.push(m);
      byAnalyte.set(m.analyteId, list);
    }
    const series = [...byAnalyte.values()].sort((a, b) => b.length - a.length)[0];
    const sorted = [...series].sort((a, b) => a.sampledAt.localeCompare(b.sampledAt));
    const latest = sorted[sorted.length - 1];
    facts.push({
      text: `Latest ${latest.displayName} is ${latest.value} ${latest.unit} (sampled ${formatDate(latest.sampledAt)}).`,
      evidenceIds: [latest.evidenceId],
    });
    cite(latest.displayName, latest.evidenceId, latest.resourceId, latest.service, 'measurement', latest.sampledAt);
    if (sorted.length >= 2) {
      const prev = sorted[sorted.length - 2];
      facts.push({
        text: `Previous value was ${prev.value} ${prev.unit} on ${formatDate(prev.sampledAt)}.`,
        evidenceIds: [prev.evidenceId],
      });
      cite(prev.displayName, prev.evidenceId, prev.resourceId, prev.service, 'measurement', prev.sampledAt);
    }
    if (latest.referenceLow !== undefined || latest.referenceHigh !== undefined) {
      facts.push({
        text: `Simulator illustrative interval: ${latest.referenceLow ?? '—'} to ${latest.referenceHigh ?? '—'} ${latest.unit}. This is not a universal clinical threshold.`,
        evidenceIds: [latest.evidenceId],
      });
    }
  }

  const relevantEvents = rankEvents(input.question, input.events).slice(0, 5);
  for (const ev of relevantEvents) {
    facts.push({
      text: `${ev.title} (${ev.status}) — ${truncate(ev.summary, 220)}`,
      evidenceIds: [ev.evidenceId],
    });
    cite(ev.title, ev.evidenceId, ev.resourceId, ev.service, ev.kind, ev.at);
  }

  let recordedNextStep: AgentAnswer['recordedNextStep'];
  const next = input.events.find((e) => /follow|task|appoint|action|review/i.test(`${e.title} ${e.summary} ${e.status}`));
  if (next) {
    recordedNextStep = {
      text: `Recorded next step from source: ${next.title} — ${truncate(next.summary, 180)} (status: ${next.status}).`,
      evidenceIds: [next.evidenceId],
    };
    cite(next.title, next.evidenceId, next.resourceId, next.service, next.kind, next.at);
  }

  if (!facts.length) {
    return {
      answer:
        input.memoriesHint ||
        'The retrieved record for this patient does not contain enough permitted evidence to answer that question. Try another topic from the suggestions, or refresh after selecting a patient with supporting records.',
      facts: [],
      uncertainty: 'No matching permitted evidence was available for this query.',
      policyNotice: input.policyNotice,
      citations: [],
      appointmentAssist: input.appointmentAssist,
    };
  }

  const answerLead =
    input.appointmentAssist && /appoint|book|slot|afternoon/i.test(input.question)
      ? input.appointmentAssist.notice
      : facts[0].text;

  return {
    answer: answerLead,
    facts,
    uncertainty:
      'This explanation restates what the synthetic record shows. It is not a diagnosis or treatment recommendation.',
    recordedNextStep,
    policyNotice: input.policyNotice || undefined,
    citations,
    visualisationSpec: input.visualisationSpec,
    appointmentAssist: input.appointmentAssist,
  };
}

function rankEvents(question: string, events: NormalisedEvent[]): NormalisedEvent[] {
  const tokens = question.toLowerCase().split(/\W+/).filter((t) => t.length > 3);
  return [...events].sort((a, b) => score(b, tokens) - score(a, tokens));
}

function score(ev: NormalisedEvent, tokens: string[]): number {
  const hay = `${ev.title} ${ev.summary} ${ev.kind} ${ev.status}`.toLowerCase();
  let s = 0;
  for (const t of tokens) if (hay.includes(t)) s += 2;
  if (/appoint|task|discharge|handover|result|pharmac|follow/i.test(hay)) s += 1;
  return s;
}

export async function clarifyAppointment(
  client: AnimaClient,
  events: NormalisedEvent[],
  question: string,
): Promise<AppointmentAssist> {
  const preference = events.find((e) => /afternoon|prefer|preference/i.test(`${e.title} ${e.summary}`));
  const booked = events.find((e) => /appoint/i.test(e.kind + e.title) && /book|confirm|scheduled|arrived/i.test(e.status + e.summary));
  const request = events.find((e) => /appoint/i.test(e.kind + e.title) && /request|waiting|pending/i.test(e.status + e.summary));
  const wantsNewBooking = /book|find (an |a )?afternoon|find (an |a )?appointment|available slot/i.test(question);

  const preferenceSummary = preference
    ? truncate(`${preference.title}: ${preference.summary}`, 200)
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
        ? truncate(`${request.title}: ${request.summary}`, 200)
        : booked
          ? `Existing recorded booking: ${booked.title} (${booked.status}). This is not a new CareCircle booking.`
          : undefined,
      availableSlots: slots.slice(0, 8),
      notice:
        'No booking was submitted. CareCircle distinguishes preference, request, available slots, and confirmed bookings. Confirm an exact patient and slot before book_appointment.',
    };
  }

  if (booked) {
    return {
      stage: 'confirmed',
      preferenceSummary,
      requestSummary: request ? truncate(request.summary, 180) : undefined,
      availableSlots: slots.slice(0, 8),
      confirmed: { startsAt: booked.at, resourceId: booked.resourceId },
      notice: `A booked follow-up appears in the record (${booked.title}, status ${booked.status}${booked.at ? `, ${formatDate(booked.at)}` : ''}). ${
        preferenceSummary ? `Preference note: ${preferenceSummary}. ` : ''
      }An afternoon preference is not itself a booking.`,
    };
  }

  if (slots.length) {
    return {
      stage: 'slots',
      preferenceSummary,
      requestSummary: request ? truncate(request.summary, 180) : undefined,
      availableSlots: slots.slice(0, 8),
      notice:
        'Available diary slots were retrieved from the GP appointment book. No booking has been made. Confirm an exact patient and slot before any book_appointment action.',
    };
  }

  if (request || preferenceSummary) {
    return {
      stage: request ? 'request' : 'preference',
      preferenceSummary,
      requestSummary: request ? truncate(`${request.title}: ${request.summary}`, 200) : undefined,
      notice:
        'CareCircle can clarify preferences and recorded requests. Live open slots were not returned for the queried dates, so no booking is offered.',
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
        sessionVersion: typeof o.sessionVersion === 'number' ? o.sessionVersion : typeof o.version === 'number' ? o.version : undefined,
        clinician: typeof o.clinician === 'string' ? o.clinician : typeof o.practitioner === 'string' ? o.practitioner : undefined,
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
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

export function sanitizeAnswerCitations(
  answer: AgentAnswer,
  allowedIds: Set<string>,
): AgentAnswer {
  const next = { ...answer };
  next.citations = (answer.citations || []).filter((c) => allowedIds.has(c.evidenceId));
  next.facts = (answer.facts || []).filter((f) => f.evidenceIds.every((id) => allowedIds.has(id)));
  if (next.visualisationSpec) {
    next.visualisationSpec = {
      ...next.visualisationSpec,
      evidenceIds: next.visualisationSpec.evidenceIds.filter((id) => allowedIds.has(id)),
      points: next.visualisationSpec.points?.filter((p) => allowedIds.has(p.evidenceId)),
    };
  }
  return next;
}
