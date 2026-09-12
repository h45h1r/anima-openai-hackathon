// Shared domain types. Shapes are FHIR-adjacent (Patient, RelatedPerson,
// Appointment, Observation, Consent). All health data is loaded from the
// NHS-SIM at runtime (see lib/sim/mapper.ts); nothing here is seeded.

export type Category =
  | "appointments"
  | "medications"
  | "lab_results"
  | "conditions"
  | "care_notes"
  | "mental_health";

export const CATEGORIES: { id: Category; label: string; blurb: string; fhir: string }[] = [
  { id: "appointments", label: "Appointments", blurb: "Dates, places and what to bring", fhir: "Appointment" },
  { id: "medications", label: "Medications", blurb: "What I take and when", fhir: "MedicationStatement" },
  { id: "lab_results", label: "Test results", blurb: "Blood tests, with trends", fhir: "Observation (laboratory)" },
  { id: "conditions", label: "Conditions", blurb: "Problems on my GP record", fhir: "Condition" },
  { id: "care_notes", label: "Care notes", blurb: "Consultation notes and personal context", fhir: "Encounter / DocumentReference" },
  { id: "mental_health", label: "Mood & wellbeing", blurb: "Sleep, mood and mental health entries", fhir: "Observation (survey)" },
];

/** The three sharing levels a patient assigns to people in their circle. */
export type SharingLevel = "everything" | "practical" | "updates";
export type LevelDefinitions = Record<SharingLevel, Category[]>;

export type PersonRole = "patient" | "family" | "carer" | "clinician" | "agent";

export interface Person {
  id: string;
  name: string;
  shortName: string;
  role: PersonRole;
  relation: string; // "Daughter", "GP", "Patient, 83"
  color: string;
  initials: string;
  org?: string;
  simId?: string;
  birthDate?: string;
  consentMemberId?: string;
  consentVersion?: number;
  accessStatus?: 'active' | 'revoked';
}

export interface PatientMeta {
  simId: string;
  name: string;
  birthDate: string;
  age: number;
  practice: string;
  practiceId?: string;
  localId?: string;
  needs: string[];
  goals: string[];
  context?: string; // "What matters to me" / personal context from the record
}

export interface Appointment {
  id: string;
  title: string;
  specialty: string;
  clinicianId: string;
  location: string;
  start: string; // ISO
  durationMin: number;
  purpose: string;
  prep: string[];
  mode?: string;
  announcedToFamily: boolean;
  simVersion?: number;
}

export interface LabResult {
  id: string;
  code: string;
  name: string;
  panel: string;
  value: number;
  unit: string;
  date: string;
  refLow?: number;
  refHigh?: number;
  refRange: string;
  flag: "normal" | "high" | "low";
  previous?: { value: number; date: string };
  history: { value: number; date: string }[];
}

export interface Medication {
  id: string;
  name: string;
  dose: string;
  schedule: string;
  purpose: string;
}

export interface Condition {
  id: string;
  name: string;
  since: string;
  status: string;
  code?: string;
}

export interface CareNote {
  id: string;
  date: string;
  authorId: string;
  title: string;
  text: string;
  /** Present for hospital letters: the structured sections of the discharge correspondence. */
  sections?: { reason?: string; course?: string; results?: string; diagnoses?: string; followUp?: string; gpActions?: string; medicationChanges?: string };
  kind?: "letter" | "note";
}

export interface MentalHealthEntry {
  id: string;
  date: string;
  title: string;
  detail: string;
}

export interface NextAction {
  id: string;
  text: string;
  due?: string;
  owner: "patient" | "family" | "clinic";
  done: boolean;
  source?: string;
}

export type ConsentMap = Record<string, Record<Category, boolean>>;

export interface ConsentRequest {
  id: string;
  requesterId: string;
  category: Category;
  reason: string;
  status: "pending" | "approved" | "declined";
  createdAt: string;
}

export interface ConsentCheck {
  granteeId: string;
  category: Category;
  allowed: boolean;
}

export interface ToolTrace {
  callId?: string;
  source?: 'model';
  name: string;
  input: unknown;
  summary: string;
  ok: boolean;
  consentCheck?: ConsentCheck;
  ms: number;
}

export interface Message {
  id: string;
  threadId: string;
  senderId: string;
  text: string;
  ts: string;
  kind: "chat" | "notification" | "system";
  clinicalAnswer?: import('./carecircle/server/types/domain').AgentAnswer;
  trace?: ToolTrace[];
  streaming?: boolean;
  audience?: string[]; // if set, only these person ids (plus the patient) can see it
}

export type AuditKind =
  | "consent.check"
  | "consent.update"
  | "consent.request"
  | "ehr.sync"
  | "tool.call"
  | "notification.sent"
  | "agent.turn"
  | "system";

export interface AuditEntry {
  id: string;
  ts: string;
  kind: AuditKind;
  actorId: string;
  summary: string;
  detail?: unknown;
  ok?: boolean;
}

export interface Thread {
  id: string;
  title: string;
  memberIds: string[];
  kind: "direct" | "group";
}

export type AgentMode = "openai" | "claude" | "scripted";

export interface AppState {
  loaded: boolean;
  loadError?: string;
  source: { kind: "nhs-sim"; baseUrl: string; world?: string; fetchedAt: string };
  patientId: string;
  agentId: string;
  patient: PatientMeta;
  now: string; // sim clock (ISO)
  people: Person[];
  appointments: Appointment[];
  labs: LabResult[];
  medications: Medication[];
  conditions: Condition[];
  careNotes: CareNote[];
  mentalHealth: MentalHealthEntry[];
  nextActions: NextAction[];
  consent: ConsentMap;
  levels: LevelDefinitions; // what each sharing level means, patient-editable
  consentRequests: ConsentRequest[];
  threads: Record<string, Thread>;
  messages: Message[];
  audit: AuditEntry[];
  ehr: { consentVersion: number; lastSyncedAt: string | null; lastResourceId?: string; gpConsentUrl?: string; syncError?: string; persistent?: boolean };
  busyThreads: string[];
  agentMode: AgentMode;
  agentModel: string;
}

export function personById(state: AppState, id: string): Person {
  const p = state.people.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown person ${id}`);
  return p;
}

export function threadFor(state: AppState, a: string, b: string): Thread | undefined {
  return Object.values(state.threads).find((t) => t.kind === "direct" && t.memberIds.includes(a) && t.memberIds.includes(b));
}

/** Can `viewerId` see `category` of the patient's record? Patient always can. */
export function canAccess(state: AppState, viewerId: string, category: Category): boolean {
  // The patient sees everything. Kindred acting on its own (scheduled checks)
  // acts for the patient; when it acts for a family member the tool context
  // carries that member's id, so this branch is never reached for them.
  if (viewerId === state.patientId || viewerId === state.agentId) return true;
  if (state.ehr.syncError) return false;
  return Boolean(state.consent[viewerId]?.[category]);
}

/** Messages `viewerId` is allowed to see in a thread. */
export function visibleMessages(state: AppState, threadId: string, viewerId: string): Message[] {
  return state.messages.filter((m) => m.threadId === threadId && (!m.audience || viewerId === state.patientId || m.audience.includes(viewerId)));
}

export function firstName(full: string) {
  return full.replace(/^(Dr|Nurse|Mr|Mrs|Ms|Miss)\s+/i, "").split(" ")[0];
}

export function initialsOf(full: string) {
  const parts = full.replace(/^(Dr|Nurse|Mr|Mrs|Ms|Miss)\s+/i, "").split(" ").filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}

export function ageAt(birthDate: string, at: string) {
  const b = new Date(birthDate);
  const n = new Date(at);
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a -= 1;
  return a;
}
