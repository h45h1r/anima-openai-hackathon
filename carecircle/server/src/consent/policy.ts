import { nanoid } from 'nanoid';
import type {
  ConsentGrant,
  ConsentOutcome,
  DisclosureEvent,
  DisclosureState,
  InformationClass,
  Measurement,
  NormalisedEvent,
  PolicyDecision,
  Relationship,
  Viewer,
} from '../types/domain.js';

export const INFORMATION_CLASSES: InformationClass[] = [
  'appointments',
  'logistics',
  'tasks',
  'treatment_summary',
  'symptoms',
  'laboratory_results',
  'clinical_documents',
  'medications',
  'private_notes',
];

export interface ConsentPolicyState {
  patientId: string;
  policyVersion: number;
  viewers: Viewer[];
  grants: ConsentGrant[];
  disclosures: DisclosureEvent[];
  audit: { at: string; actor: string; message: string; policyVersion: number }[];
}

const DEFAULT_MATRIX: Record<Relationship, Partial<Record<InformationClass, boolean>>> = {
  self: Object.fromEntries(INFORMATION_CLASSES.map((c) => [c, true])) as Record<InformationClass, boolean>,
  full_care_proxy: {
    appointments: true,
    logistics: true,
    tasks: true,
    treatment_summary: true,
    symptoms: true,
    laboratory_results: true,
    clinical_documents: true,
    medications: true,
    private_notes: false,
  },
  practical_supporter: {
    appointments: true,
    logistics: true,
    tasks: true,
    treatment_summary: false,
    symptoms: true,
    laboratory_results: false,
    clinical_documents: false,
    medications: true,
    private_notes: false,
  },
  family_member: {
    appointments: true,
    logistics: true,
    tasks: false,
    treatment_summary: false,
    symptoms: false,
    laboratory_results: false,
    clinical_documents: false,
    medications: false,
    private_notes: false,
  },
  clinician_reviewer: Object.fromEntries(INFORMATION_CLASSES.map((c) => [c, true])) as Record<InformationClass, boolean>,
};

export function createDefaultPolicy(patientId: string, patientName: string): ConsentPolicyState {
  const viewers: Viewer[] = [
    { viewerId: 'patient', patientId, displayName: patientName, relationship: 'self', status: 'active' },
    { viewerId: 'sarah', patientId, displayName: 'Sarah (care proxy)', relationship: 'full_care_proxy', status: 'active' },
    { viewerId: 'john', patientId, displayName: 'John (practical support)', relationship: 'practical_supporter', status: 'active' },
    { viewerId: 'tom', patientId, displayName: 'Tom (extended family)', relationship: 'family_member', status: 'active' },
  ];
  const grants: ConsentGrant[] = [];
  let version = 1;
  for (const viewer of viewers) {
    const matrix = DEFAULT_MATRIX[viewer.relationship];
    for (const infoClass of INFORMATION_CLASSES) {
      grants.push({
        grantId: nanoid(8),
        patientId,
        viewerId: viewer.viewerId,
        informationClass: infoClass,
        purpose: 'understand',
        scope: 'class',
        startsAt: new Date().toISOString(),
        version,
        allowed: Boolean(matrix[infoClass]),
      });
    }
  }
  return {
    patientId,
    policyVersion: version,
    viewers,
    grants,
    disclosures: [],
    audit: [
      {
        at: new Date().toISOString(),
        actor: 'system',
        message: 'Initial CareCircle demo consent presets created (editable prototype data).',
        policyVersion: version,
      },
    ],
  };
}

export function getDisclosureState(policy: ConsentPolicyState, resourceId: string): DisclosureState {
  const events = policy.disclosures.filter((d) => d.resourceId === resourceId);
  if (!events.length) return 'cleared'; // existing historical resources default cleared unless held
  return events.sort((a, b) => a.changedAt.localeCompare(b.changedAt)).at(-1)!.state;
}

export function holdResource(policy: ConsentPolicyState, resourceId: string, actor: string): ConsentPolicyState {
  const event: DisclosureEvent = {
    patientId: policy.patientId,
    resourceId,
    state: 'held',
    changedBy: actor,
    changedAt: new Date().toISOString(),
    evidence: 'CareCircle disclosure gate — newly detected result held until patient communication state is known.',
  };
  return {
    ...policy,
    disclosures: [...policy.disclosures, event],
    audit: [
      ...policy.audit,
      {
        at: event.changedAt,
        actor,
        message: `Held resource ${resourceId} for disclosure`,
        policyVersion: policy.policyVersion,
      },
    ],
  };
}

export function clearResource(policy: ConsentPolicyState, resourceId: string, actor: string): ConsentPolicyState {
  const event: DisclosureEvent = {
    patientId: policy.patientId,
    resourceId,
    state: 'cleared',
    changedBy: actor,
    changedAt: new Date().toISOString(),
    evidence: 'Explicit CareCircle demo release (Anima has no patient-informed signal).',
  };
  return {
    ...policy,
    disclosures: [...policy.disclosures, event],
    audit: [
      ...policy.audit,
      {
        at: event.changedAt,
        actor,
        message: `Cleared disclosure for ${resourceId}`,
        policyVersion: policy.policyVersion,
      },
    ],
  };
}

export function updateGrants(
  policy: ConsentPolicyState,
  viewerId: string,
  updates: Partial<Record<InformationClass, boolean>>,
  expectedVersion: number,
  actor: string,
): ConsentPolicyState {
  if (expectedVersion !== policy.policyVersion) {
    throw new Error(`CONSENT_VERSION_CONFLICT: expected ${expectedVersion}, current ${policy.policyVersion}`);
  }
  const nextVersion = policy.policyVersion + 1;
  const grants = policy.grants.map((g) => {
    if (g.viewerId !== viewerId) return g;
    if (!(g.informationClass in updates)) return g;
    return {
      ...g,
      allowed: Boolean(updates[g.informationClass]),
      version: nextVersion,
      revokedAt: updates[g.informationClass] === false ? new Date().toISOString() : undefined,
    };
  });
  return {
    ...policy,
    policyVersion: nextVersion,
    grants,
    audit: [
      ...policy.audit,
      {
        at: new Date().toISOString(),
        actor,
        message: `Updated consent for ${viewerId}: ${JSON.stringify(updates)}`,
        policyVersion: nextVersion,
      },
    ],
  };
}

export interface EvidenceItem {
  evidenceId: string;
  resourceId: string;
  informationClass: InformationClass;
  fields: string[];
  payload: Measurement | NormalisedEvent;
  kind: 'measurement' | 'event';
}

export function evaluateConsent(input: {
  policy: ConsentPolicyState;
  viewerId: string;
  purpose?: string;
  evidence: EvidenceItem[];
}): PolicyDecision {
  const viewer = input.policy.viewers.find((v) => v.viewerId === input.viewerId && v.status === 'active');
  const decisionId = nanoid(10);
  if (!viewer) {
    return {
      decisionId,
      outcome: 'deny',
      allowedEvidenceIds: [],
      allowedFieldsByEvidence: {},
      deniedInformationClasses: INFORMATION_CLASSES,
      reasonCodes: ['VIEWER_MISMATCH'],
      userNotice: 'This viewer is not authorised for this patient.',
      policyVersion: input.policy.policyVersion,
    };
  }
  if (viewer.patientId !== input.policy.patientId) {
    return {
      decisionId,
      outcome: 'deny',
      allowedEvidenceIds: [],
      allowedFieldsByEvidence: {},
      deniedInformationClasses: INFORMATION_CLASSES,
      reasonCodes: ['PATIENT_MISMATCH'],
      userNotice: 'Patient context does not match this viewer.',
      policyVersion: input.policy.policyVersion,
    };
  }

  const allowedEvidenceIds: string[] = [];
  const allowedFieldsByEvidence: Record<string, string[]> = {};
  const denied = new Set<InformationClass>();
  const reasonCodes = new Set<string>();
  let heldCount = 0;
  let deniedCount = 0;
  let allowedCount = 0;

  for (const item of input.evidence) {
    if (viewer.relationship === 'self') {
      allowedEvidenceIds.push(item.evidenceId);
      allowedFieldsByEvidence[item.evidenceId] = item.fields;
      allowedCount++;
      reasonCodes.add('SELF_ACCESS');
      continue;
    }

    const disclosure = getDisclosureState(input.policy, item.resourceId);
    if (disclosure === 'held' && item.informationClass === 'laboratory_results') {
      heldCount++;
      denied.add(item.informationClass);
      reasonCodes.add('RESULT_HELD_FOR_DISCLOSURE');
      continue;
    }

    const grant = input.policy.grants.find(
      (g) =>
        g.viewerId === viewer.viewerId &&
        g.informationClass === item.informationClass &&
        !g.revokedAt &&
        g.allowed,
    );
    if (!grant) {
      deniedCount++;
      denied.add(item.informationClass);
      reasonCodes.add('TOPIC_NOT_GRANTED');
      continue;
    }
    if (grant.expiresAt && Date.parse(grant.expiresAt) < Date.now()) {
      deniedCount++;
      denied.add(item.informationClass);
      reasonCodes.add('GRANT_EXPIRED');
      continue;
    }
    allowedEvidenceIds.push(item.evidenceId);
    allowedFieldsByEvidence[item.evidenceId] = item.fields;
    allowedCount++;
    reasonCodes.add('ACTIVE_GRANT');
  }

  let outcome: ConsentOutcome = 'allow';
  if (heldCount && !allowedCount) outcome = 'hold';
  else if (!allowedCount) outcome = 'deny';
  else if (deniedCount || heldCount) outcome = 'partial';

  const userNotice = buildNotice(outcome, [...denied], [...reasonCodes]);
  return {
    decisionId,
    outcome,
    allowedEvidenceIds,
    allowedFieldsByEvidence,
    deniedInformationClasses: [...denied],
    reasonCodes: [...reasonCodes],
    userNotice,
    policyVersion: input.policy.policyVersion,
  };
}

function buildNotice(outcome: ConsentOutcome, denied: InformationClass[], reasons: string[]): string {
  if (outcome === 'allow') return '';
  if (outcome === 'hold') {
    return 'A result is waiting for patient communication before it can be shared with family. No result details are shown.';
  }
  if (outcome === 'deny') {
    return 'CareCircle cannot share that clinical detail with your current access. Ask the patient to update People and access if appropriate.';
  }
  return `Some topics were omitted (${denied.join(', ') || 'restricted'}). Reasons: ${reasons.filter((r) => r !== 'ACTIVE_GRANT' && r !== 'SELF_ACCESS').join(', ') || 'partial grant'}.`;
}

export function filterEvidence<T extends { evidenceId: string }>(items: T[], decision: PolicyDecision): T[] {
  const allowed = new Set(decision.allowedEvidenceIds);
  return items.filter((i) => allowed.has(i.evidenceId));
}
