/**
 * Portable Ask intent classifier — shared by CareCircle Express and Kindred/SSE ports.
 * Keep regexes here so answer routing stays deterministic and model-independent.
 */

export type AskIntent =
  | 'share_consent'
  | 'companion'
  | 'vitals_bp'
  | 'appointment'
  | 'lab'
  | 'document'
  | 'general';

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

const SHARE_CONSENT_Q =
  /\b(share|sharing|shared with|consent|who (?:can|has|have) access|access (?:for|to)|permission|daughter|son|spouse|partner|family|people(?:\s+page)?|care\s*proxy|grant|revoke|who can see)\b/i;

/** Kindred companion abilities that clinical Ask did not fully cover. */
const COMPANION_Q =
  /\b(let \w+ see|share everything|only practical|important updates|who can see what|who can see|who has access|request access|ask (?:her|him|them) to share|please ask (?:her|him)|next actions?|outstanding(?:\s+actions?)?|what matters|my goals?|recorded needs|personal context|post to (?:the )?family|sharing level|stop sharing|share (?:my )?(?:test results|labs?|medications?) with)\b/i;

const VITALS_BP_Q =
  /\b(bp|b\.p\.|blood\s*pressure|systolic|diastolic|mm\s*hg|mmhg)\b/i;

const LAB_Q =
  /\b(result|results|blood|lab|labs|lft|egfr|alt|alp|hba1c|haemoglobin|hemoglobin|panel|analyte|creatinine|sodium|potassium|kidney|renal|u&e|electrolyte|fbc|wbc|platelet|bilirubin|albumin|gfr)\b/i;

/** Appointment booking/slots — not preference memory keywords alone. */
const APPT_Q = /\b(appoint(ment)?s?|book(ing)?|slots?|diary|schedule)\b/i;

const DOC_Q =
  /\b(discharge|handover|document|letter|summary|care\s*plan|next step|need to do next|do next|follow.?up task|what should i do)\b/i;

const FOLLOWUP_Q =
  /^(what about|how about|and (?:the |my |what about )?|explain (?:that|this|it)|tell me more|why (?:is|was|that)|simpler|more simply|in plain|can you (?:clarify|expand)|also[, ]|what does that)/i;

export function isShareConsentIntent(question: string): boolean {
  return SHARE_CONSENT_Q.test(question);
}

/** Route to Kindred companion tools (Circle mutations, next actions, goals/needs, access requests). */
export function isCompanionAskIntent(question: string): boolean {
  // Intentionally narrower than isShareConsentIntent — avoid stealing clinical asks that
  // merely mention family/daughter/share in passing.
  return COMPANION_Q.test(question);
}

export function isVitalsBpIntent(question: string): boolean {
  return VITALS_BP_Q.test(question);
}

export function isLabIntent(question: string, history?: ChatTurn[]): boolean {
  if (isShareConsentIntent(question) || isVitalsBpIntent(question)) return false;
  if (LAB_Q.test(question)) return true;
  if (isFollowUpQuestion(question, history) && LAB_Q.test((history || []).map((t) => t.content).join(' '))) {
    return true;
  }
  return false;
}

export function isAppointmentIntent(question: string): boolean {
  if (isShareConsentIntent(question) || isVitalsBpIntent(question)) return false;
  return APPT_Q.test(question);
}

export function isDocumentIntent(question: string): boolean {
  if (isShareConsentIntent(question)) return false;
  return DOC_Q.test(question);
}

export function isFollowUpQuestion(question: string, history?: ChatTurn[]): boolean {
  const q = question.trim();
  if (!q) return false;
  // Sharing / consent / BP are never "continue the prior lab dump".
  if (isShareConsentIntent(q) || isVitalsBpIntent(q)) return false;
  if (FOLLOWUP_Q.test(q)) return true;
  if (
    history &&
    history.length > 0 &&
    q.length < 48 &&
    !/\b(explain|latest|blood|appoint|book|share|consent|bp|pressure)\b/i.test(q)
  ) {
    return true;
  }
  return false;
}

export function classifyAskIntent(question: string, history?: ChatTurn[]): AskIntent {
  if (isCompanionAskIntent(question)) return 'companion';
  if (isShareConsentIntent(question)) return 'share_consent';
  if (isVitalsBpIntent(question)) return 'vitals_bp';
  if (isAppointmentIntent(question) && !LAB_Q.test(question)) return 'appointment';
  if (isLabIntent(question, history)) return 'lab';
  if (isDocumentIntent(question)) return 'document';
  return 'general';
}

export function intentNeedsLaboratory(intent: AskIntent): boolean {
  return intent === 'lab' || intent === 'vitals_bp';
}
