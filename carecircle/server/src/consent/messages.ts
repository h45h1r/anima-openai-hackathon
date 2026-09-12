/**
 * Portable user-facing consent / disclosure copy.
 * Reason codes and topic slugs stay in PolicyDecision for judges/tools —
 * never surface them in answer or policyNotice shown to end users.
 */

import type { ConsentOutcome, InformationClass } from '../types/domain.js';
import type { AskIntent } from '../agent/intent.js';

export function patientFirstName(displayName?: string): string {
  const first = String(displayName || '')
    .trim()
    .split(/\s+/)[0];
  return first || 'the patient';
}

export function buildUserFacingPolicyNotice(input: {
  outcome: ConsentOutcome;
  reasonCodes: string[];
  deniedInformationClasses: InformationClass[];
  /** When known, shapes whether a partial catalogue omission is relevant. */
  intent?: AskIntent;
  patientFirstName?: string;
}): string {
  const { outcome, reasonCodes, deniedInformationClasses, intent } = input;
  if (outcome === 'allow') return '';

  const name = input.patientFirstName || 'the patient';
  const held = reasonCodes.includes('RESULT_HELD_FOR_DISCLOSURE');
  const notGranted =
    reasonCodes.includes('TOPIC_NOT_GRANTED') ||
    reasonCodes.includes('GRANT_EXPIRED') ||
    reasonCodes.includes('VIEWER_MISMATCH') ||
    reasonCodes.includes('PATIENT_MISMATCH');

  if (reasonCodes.includes('VIEWER_MISMATCH') || reasonCodes.includes('PATIENT_MISMATCH')) {
    return 'This viewer is not authorised for this patient.';
  }

  if (outcome === 'hold' || (held && !reasonCodes.includes('ACTIVE_GRANT') && outcome !== 'partial')) {
    return `I can't show that yet — it's waiting for ${name} to release it.`;
  }

  if (outcome === 'deny') {
    return "That isn't shared with your role.";
  }

  // partial — only mention when the ask actually needed blocked clinical topics
  if (intent === 'share_consent' || intent === 'appointment' || intent === 'vitals_bp') {
    // BP empty-state answers are enough; suppress unrelated catalogue omissions.
    // Only surface a hold notice if results are held and the viewer might otherwise expect labs.
    if (intent === 'vitals_bp' && held && deniedInformationClasses.includes('laboratory_results')) {
      return `I can't show that yet — it's waiting for ${name} to release it.`;
    }
    return '';
  }

  const needsLabs = intent === 'lab' || intent === undefined;
  const labsBlocked =
    deniedInformationClasses.includes('laboratory_results') ||
    deniedInformationClasses.includes('clinical_documents');

  if (needsLabs && labsBlocked) {
    if (held) {
      return `I can't show that yet — it's waiting for ${name} to release it.`;
    }
    if (notGranted) {
      return "That isn't shared with your role.";
    }
  }

  if (intent === 'general' || intent === 'document') {
    return '';
  }

  if (held) {
    return `I can't show that yet — it's waiting for ${name} to release it.`;
  }
  if (notGranted && labsBlocked) {
    return "That isn't shared with your role.";
  }
  return '';
}

/** Guard: user-facing strings must never include raw policy enums or topic slugs. */
export function assertHumanPolicyCopy(text: string): boolean {
  if (!text) return true;
  return !/(TOPIC_NOT_GRANTED|RESULT_HELD_FOR_DISCLOSURE|GRANT_EXPIRED|SELF_ACCESS|ACTIVE_GRANT|VIEWER_MISMATCH|laboratory_results|clinical_documents|private_notes|treatment_summary)/.test(
    text,
  );
}
