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
  Viewer,
} from '../types/domain.js';
import { buildUserFacingPolicyNotice, patientFirstName } from './messages.js';
import {
  classesForLevel,
  DEMO_CUSTOM_CLASS_SETS,
  DEMO_VIEWER_LEVELS,
  levelForClasses,
  levelLabel,
  type KindredSharingLevel,
} from './kindredBridge.js';

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
  /** Kindred sharing level per family viewer — authority model for access. */
  sharingLevels?: Record<string, KindredSharingLevel>;
}

const SELF_MATRIX = Object.fromEntries(INFORMATION_CLASSES.map((c) => [c, true])) as Record<
  InformationClass,
  boolean
>;

export function createDefaultPolicy(patientId: string, patientName: string): ConsentPolicyState {
  const viewers: Viewer[] = [
    { viewerId: 'patient', patientId, displayName: patientName, relationship: 'self', status: 'active' },
    {
      viewerId: 'sarah',
      patientId,
      displayName: `Sarah · ${levelLabel('everything')}`,
      relationship: 'full_care_proxy',
      status: 'active',
    },
    {
      viewerId: 'john',
      patientId,
      displayName: `John · ${levelLabel('practical')}`,
      relationship: 'practical_supporter',
      status: 'active',
    },
    {
      viewerId: 'tom',
      patientId,
      displayName: 'Tom · Custom',
      relationship: 'family_member',
      status: 'active',
    },
  ];
  const sharingLevels: Record<string, KindredSharingLevel> = {};
  for (const [id, level] of Object.entries(DEMO_VIEWER_LEVELS)) {
    if (level) sharingLevels[id] = level;
  }
  const grants: ConsentGrant[] = [];
  let version = 1;
  for (const viewer of viewers) {
    let matrix: Record<InformationClass, boolean>;
    if (viewer.relationship === 'self') {
      matrix = SELF_MATRIX;
    } else if (sharingLevels[viewer.viewerId]) {
      matrix = classesForLevel(sharingLevels[viewer.viewerId]);
    } else {
      const custom = new Set(DEMO_CUSTOM_CLASS_SETS[viewer.viewerId] || []);
      matrix = Object.fromEntries(INFORMATION_CLASSES.map((c) => [c, custom.has(c)])) as Record<
        InformationClass,
        boolean
      >;
    }
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
    sharingLevels,
    audit: [
      {
        at: new Date().toISOString(),
        actor: 'system',
        message:
          'Kindred-aligned sharing levels seeded for Ask filtering (Everything / Only practical / Important updates). Edit access in Kindred Circle; use Circle here only for the Ask demo filter.',
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
  const allowed = grants
    .filter((g) => g.viewerId === viewerId && g.allowed && !g.revokedAt)
    .map((g) => g.informationClass);
  const inferred = levelForClasses(allowed);
  const sharingLevels = { ...(policy.sharingLevels || {}) };
  if (inferred === 'everything' || inferred === 'practical' || inferred === 'updates') {
    sharingLevels[viewerId] = inferred;
  } else {
    delete sharingLevels[viewerId];
  }
  return {
    ...policy,
    policyVersion: nextVersion,
    grants,
    sharingLevels,
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

/** Primary access write path: Kindred sharing level → CareCircle class grants. */
export function updateSharingLevel(
  policy: ConsentPolicyState,
  viewerId: string,
  level: KindredSharingLevel,
  expectedVersion: number,
  actor: string,
): ConsentPolicyState {
  if (viewerId === 'patient') {
    throw new Error('Cannot set a sharing level on the patient self viewer.');
  }
  if (!policy.viewers.some((v) => v.viewerId === viewerId && v.status === 'active')) {
    throw new Error('Unknown viewer for this CareCircle.');
  }
  const updates = classesForLevel(level);
  const next = updateGrants(policy, viewerId, updates, expectedVersion, actor);
  const viewers = next.viewers.map((v) =>
    v.viewerId === viewerId ? { ...v, displayName: `${v.displayName.split(' · ')[0]} · ${levelLabel(level)}` } : v,
  );
  return {
    ...next,
    viewers,
    sharingLevels: { ...(next.sharingLevels || {}), [viewerId]: level },
    audit: [
      ...next.audit.slice(0, -1),
      {
        at: new Date().toISOString(),
        actor,
        message: `Set Kindred sharing level for ${viewerId} to ${levelLabel(level)}`,
        policyVersion: next.policyVersion,
      },
    ],
  };
}

export function viewerSharingLevel(
  policy: ConsentPolicyState,
  viewerId: string,
): ReturnType<typeof levelForClasses> {
  if (viewerId === 'patient') return 'everything';
  const stored = policy.sharingLevels?.[viewerId];
  if (stored) return stored;
  const allowed = policy.grants
    .filter((g) => g.viewerId === viewerId && g.allowed && !g.revokedAt)
    .map((g) => g.informationClass);
  return levelForClasses(allowed);
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

  const selfViewer = input.policy.viewers.find((v) => v.relationship === 'self');
  // Default notice (intent-agnostic). Harness may refine with classifyAskIntent.
  const userNotice = buildUserFacingPolicyNotice({
    outcome,
    reasonCodes: [...reasonCodes],
    deniedInformationClasses: [...denied],
    patientFirstName: patientFirstName(selfViewer?.displayName),
  });
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

export function filterEvidence<T extends { evidenceId: string }>(items: T[], decision: PolicyDecision): T[] {
  const allowed = new Set(decision.allowedEvidenceIds);
  return items.filter((i) => allowed.has(i.evidenceId));
}
