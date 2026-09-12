/** Shared CareCircle domain types */

export type InformationClass =
  | 'appointments'
  | 'logistics'
  | 'tasks'
  | 'treatment_summary'
  | 'symptoms'
  | 'laboratory_results'
  | 'clinical_documents'
  | 'medications'
  | 'private_notes';

export type Relationship =
  | 'self'
  | 'full_care_proxy'
  | 'practical_supporter'
  | 'family_member'
  | 'clinician_reviewer';

export type ConsentOutcome = 'allow' | 'partial' | 'deny' | 'hold';

export type DisclosureState = 'held' | 'cleared';

export type ViewerId = string;

export interface PatientSummary {
  id: string;
  name: string;
  birthDate: string;
  synthetic: true;
  conditions: string[];
  needs: string[];
  goals: string[];
  localIds: Record<string, string>;
}

export interface AnimaResource {
  id: string;
  patientId?: string;
  kind: string;
  title: string;
  status: string;
  owner: string;
  visibleTo: string[];
  priority: 'routine' | 'urgent';
  createdAt: number;
  dueAt?: number;
  data: Record<string, unknown>;
  version: number;
  provenance?: {
    created: unknown;
    changes: unknown[];
    recovery?: Record<string, unknown>;
  };
}

export interface Measurement {
  evidenceId: string;
  resourceId: string;
  patientId: string;
  panelId: string;
  analyteId: string;
  displayName: string;
  value: number;
  unit: string;
  sampledAt: string;
  referenceLow?: number;
  referenceHigh?: number;
  referenceLabel?: string;
  service: string;
  sourceVersion: number;
  informationClass: InformationClass;
}

export interface NormalisedEvent {
  evidenceId: string;
  resourceId: string;
  patientId: string;
  kind: string;
  title: string;
  status: string;
  at: string;
  summary: string;
  informationClass: InformationClass;
  service: string;
  sourceVersion: number;
  rawSnippet?: string;
  fields: Record<string, unknown>;
}

export interface ClinicalContext {
  patientId: string;
  sites: string[];
  fetchedAt: string;
  simulationNowMs?: number;
  resources: AnimaResource[];
  measurements: Measurement[];
  events: NormalisedEvent[];
  recordClasses: InformationClass[];
  sparse: boolean;
  errors: { site: string; message: string }[];
}

export interface Viewer {
  viewerId: ViewerId;
  patientId: string;
  displayName: string;
  relationship: Relationship;
  status: 'active' | 'revoked';
}

export interface ConsentGrant {
  grantId: string;
  patientId: string;
  viewerId: ViewerId;
  informationClass: InformationClass;
  purpose: string;
  scope: 'class' | 'record' | 'fields';
  startsAt: string;
  expiresAt?: string;
  revokedAt?: string;
  version: number;
  allowed: boolean;
}

export interface DisclosureEvent {
  patientId: string;
  resourceId: string;
  state: DisclosureState;
  changedBy: string;
  changedAt: string;
  evidence?: string;
}

export interface PolicyDecision {
  decisionId: string;
  outcome: ConsentOutcome;
  allowedEvidenceIds: string[];
  allowedFieldsByEvidence: Record<string, string[]>;
  deniedInformationClasses: InformationClass[];
  reasonCodes: string[];
  userNotice: string;
  policyVersion: number;
}

export interface Citation {
  evidenceId: string;
  resourceId: string;
  title: string;
  date?: string;
  service: string;
  kind: string;
}

export interface VisualisationSpec {
  type: 'result_trend' | 'care_timeline';
  evidenceIds: string[];
  title: string;
  unit?: string;
  points?: { date: string; value: number; label: string; evidenceId: string }[];
  referenceLow?: number;
  referenceHigh?: number;
  referenceLabel?: string;
}

export interface AgentAnswer {
  answer: string;
  facts: { text: string; evidenceIds: string[] }[];
  uncertainty?: string;
  recordedNextStep?: { text: string; evidenceIds: string[] };
  policyNotice?: string;
  escalation?: string;
  citations: Citation[];
  visualisationSpec?: VisualisationSpec;
  appointmentAssist?: AppointmentAssist;
}

export interface AppointmentAssist {
  stage:
    | 'preference'
    | 'request'
    | 'slots'
    | 'awaiting_confirmation'
    | 'confirmed'
    | 'unsupported';
  preferenceSummary?: string;
  requestSummary?: string;
  availableSlots?: {
    startsAt: string;
    sessionId?: string;
    sessionVersion?: number;
    clinician?: string;
    title?: string;
  }[];
  confirmed?: { startsAt: string; resourceId: string };
  notice: string;
}

export interface ToolObservation {
  tool: string;
  status: 'ok' | 'error' | 'skipped';
  latencyMs: number;
  detail: string;
  evidenceCount?: number;
}

export interface AgentRunResult {
  runId: string;
  queryId: string;
  patientId: string;
  viewerId: ViewerId;
  answer: AgentAnswer;
  policy: PolicyDecision;
  tools: ToolObservation[];
  model: string;
  promptVersion: string;
  latencyMs: number;
}
