import { AnimaClientError, type AnimaErrorKind } from './anima/client.js';

/** Short, judge-friendly copy for API + WebSocket surfaces. */
export const HUMAN_MESSAGES = {
  missing_session: 'Connect to Anima first.',
  disconnected: 'Not connected — reconnect to Anima.',
  missing_key: 'No Anima key — paste a team key or set ANIMA_API_KEY.',
  unauthorized: 'Permission denied — check your Anima API key.',
  forbidden: 'Permission denied for this Anima action.',
  not_found: 'Patient or resource not found in live Anima.',
  patient_not_in_world: 'Patient not found in live Anima search. Return to search.',
  patient_mismatch: 'Selected patient does not match this request.',
  viewer_mismatch: 'Wrong viewer — use the viewer switcher (identity claims are ignored).',
  question_required: 'Enter a question before asking.',
  no_patient: 'Select a patient first.',
  unknown_viewer: 'Unknown viewer for this CareCircle.',
  only_patient_may_edit_consent: 'Consent blocks this — only the patient viewer can edit access.',
  consent_conflict: 'Consent update conflict — refresh and try again.',
  consent_blocks: 'Consent blocks this for the current viewer.',
  held_result: 'Result is held for disclosure — clear it in Results first.',
  bad_request: 'Invalid request.',
  conflict: 'Conflict with the current Anima or CareCircle state.',
  unavailable: 'Anima unreachable — retry.',
  malformed: 'Anima returned an unexpected response — retry.',
  booking_not_submitted: 'Booking not submitted (API limitation or rejected slot).',
  unsupported_action: 'That action is not supported.',
  unsupported_message: 'Unsupported WebSocket message.',
  internal: 'Something went wrong in CareCircle — retry.',
} as const;

export type CareCircleErrorCode = keyof typeof HUMAN_MESSAGES | AnimaErrorKind | string;

export function humanMessage(code: CareCircleErrorCode, fallback?: string): string {
  if (code && code in HUMAN_MESSAGES) {
    return HUMAN_MESSAGES[code as keyof typeof HUMAN_MESSAGES];
  }
  if (fallback && looksHuman(fallback)) return fallback;
  return HUMAN_MESSAGES.internal;
}

function looksHuman(text: string): boolean {
  if (!text || text.length > 180) return false;
  if (/^[a-z0-9_.-]+$/i.test(text) && text.includes('_')) return false;
  if (/^(Error|TypeError|fetch failed)/i.test(text)) return false;
  if (/at\s+\S+\s+\(/.test(text) || text.includes('\n    at ')) return false;
  return true;
}

/** Map raw Anima / network errors into crisp CareCircle copy. */
export function humanizeAnimaError(err: AnimaClientError): string {
  const raw = (err.message || '').trim();
  const lower = raw.toLowerCase();

  if (err.kind === 'unauthorized' || /api key|unauthorized|401/.test(lower)) {
    return HUMAN_MESSAGES.unauthorized;
  }
  if (err.kind === 'forbidden' || /forbidden|403|permission/.test(lower)) {
    return HUMAN_MESSAGES.forbidden;
  }
  if (err.kind === 'not_found' || /not found|404/.test(lower)) {
    return HUMAN_MESSAGES.not_found;
  }
  if (err.kind === 'conflict' || /conflict|409|version/.test(lower)) {
    return HUMAN_MESSAGES.conflict;
  }
  if (
    /book_appointment|booking|unsupported|unknown action|invalid action|not supported/.test(lower) ||
    (err.kind === 'bad_request' && /action|book|slot/.test(lower))
  ) {
    return HUMAN_MESSAGES.booking_not_submitted;
  }
  if (err.kind === 'unavailable' || /abort|timeout|econnrefused|enotfound|fetch failed|unreachable|network/.test(lower)) {
    return HUMAN_MESSAGES.unavailable;
  }
  if (err.kind === 'malformed') {
    return HUMAN_MESSAGES.malformed;
  }
  if (err.kind === 'bad_request') {
    return looksHuman(raw) ? raw : HUMAN_MESSAGES.bad_request;
  }
  if (looksHuman(raw)) return raw;
  return HUMAN_MESSAGES.unavailable;
}

export function animaStatusForKind(kind: AnimaErrorKind): number {
  switch (kind) {
    case 'unauthorized':
      return 401;
    case 'forbidden':
      return 403;
    case 'not_found':
      return 404;
    case 'conflict':
      return 409;
    case 'bad_request':
      return 400;
    case 'malformed':
      return 502;
    case 'unavailable':
      return 503;
    default:
      return 503;
  }
}
