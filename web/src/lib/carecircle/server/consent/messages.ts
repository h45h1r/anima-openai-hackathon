/**
 * Portable user-facing consent / disclosure copy.
 * Reason codes and topic slugs stay in PolicyDecision for judges/tools —
 * never surface them in answer or policyNotice shown to end users.
 */

import type { ConsentOutcome, InformationClass } from '../types/domain';

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
  patientFirstName?: string;
}): string {
  const { outcome, reasonCodes, deniedInformationClasses } = input;
  if (outcome === 'allow') return '';

  const name = input.patientFirstName || 'the patient';
  const held = reasonCodes.includes('RESULT_HELD_FOR_DISCLOSURE');
  const notGranted =
    reasonCodes.includes('TOPIC_NOT_GRANTED') ||
    reasonCodes.includes('GRANT_EXPIRED') ||
    reasonCodes.includes('VIEWER_MISMATCH') ||
    reasonCodes.includes('PATIENT_MISMATCH');

  if (reasonCodes.includes('VIEWER_MISMATCH') || reasonCodes.includes('PATIENT_MISMATCH')) {
    return 'This view isn’t set up for that person. Open Circle to check who’s linked.';
  }

  if (outcome === 'hold' || (held && !reasonCodes.includes('ACTIVE_GRANT') && outcome !== 'partial')) {
    return `I can’t show that yet — it’s waiting for ${name} to release it. You can ask them in Circle.`;
  }

  if (outcome === 'deny') {
    return "That isn’t shared with you yet. Ask them to open Circle if they’d like to share more.";
  }


  if (held) {
    return `I can’t show that yet — it’s waiting for ${name} to release it. You can ask them in Circle.`;
  }
  if (notGranted && deniedInformationClasses.length > 0) {
    return "That isn’t shared with you yet. Ask them to open Circle if they’d like to share more.";
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
