import type { AppState, Category, Person } from './types';
import { CATEGORIES, firstName, initialsOf } from './types';

const base = (process.env.COMPANION_BASE_URL || 'http://localhost:4192').replace(/\/$/, '');
const publicBase = (process.env.COMPANION_PUBLIC_URL || base).replace(/\/$/, '');
export interface ConsentMember {
  id: string; externalId: string | null; role: 'family' | 'carer' | 'clinician'; name: string;
  relationship: string; email: string; categories: string[]; status: 'active' | 'revoked'; version: number;
}
interface Snapshot {
  patient: { id: string }; revision: number; updatedAt: string | null;
  members: ConsentMember[];
  audit: { id: string; action: string; detail: string; createdAt: string; memberName: string }[];
  sync: { resourceId: string | null };
}
let session: { patientId: string; cookie: string } | undefined;
export async function consentRequest<T>(patientId: string, path: string, method = 'GET', input?: unknown): Promise<T> {
  if (!session || session.patientId !== patientId) {
    const response = await fetch(`${base}/api/companion/patient/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ patientId }), cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('The local consent database is unavailable. Start sim-app on port 4192.');
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    if (!cookie) throw new Error('The consent service did not create a session.');
    session = { patientId, cookie };
  }
  const response = await fetch(`${base}/api/companion/patient${path}?patientId=${encodeURIComponent(patientId)}`, { method, headers: { Cookie: session.cookie, 'Content-Type': 'application/json' }, ...(input === undefined ? {} : { body: JSON.stringify(input) }), cache: 'no-store', signal: AbortSignal.timeout(10000) });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) session = undefined;
    throw Object.assign(new Error(result.error || 'Could not save consent.'), { status: response.status });
  }
  return result as T;
}
export const toStoredCategory = (id: Category) => id === 'lab_results' ? 'results' : id;
export async function getConsentSnapshot(patientId: string) { return consentRequest<Snapshot>(patientId, '/state'); }

export function applyConsentSnapshot(state: AppState, snapshot: Snapshot): AppState {
  if (snapshot.patient.id !== state.patient.simId) throw new Error('Consent belongs to a different patient.');
  if (state.ehr.persistent && snapshot.revision < state.ehr.consentVersion) return state;
  const people = [...state.people];
  const consent: AppState['consent'] = {};
  const threads = { ...state.threads };
  for (const [index, member] of snapshot.members.entries()) {
    const id = member.externalId || `family-${member.id}`;
    const old = people.find(p => p.id === id);
    const person: Person = {
      ...old, id, name: member.name, shortName: old?.shortName || firstName(member.name), initials: initialsOf(member.name),
      role: member.role, relation: member.relationship, color: old?.color || ['#C2572F', '#3B6EA8', '#8A6D2F', '#526F5D'][index % 4],
      consentMemberId: member.id, consentVersion: member.version, accessStatus: member.status,
    };
    const position = people.findIndex(p => p.id === id);
    if (position < 0) people.push(person); else people[position] = person;
    consent[id] = Object.fromEntries(CATEGORIES.map(c => [c.id, member.status === 'active' && member.categories.includes(toStoredCategory(c.id))])) as Record<Category, boolean>;
    if (member.role !== 'clinician' && !threads[`${id}-kindred`]) threads[`${id}-kindred`] = { id: `${id}-kindred`, title: 'Kindred', memberIds: [id, state.agentId], kind: 'direct' };
  }
  const memberIds = new Set(snapshot.members.map(m => m.externalId || `family-${m.id}`));
  for (const p of people) if (['family', 'carer', 'clinician'].includes(p.role) && !memberIds.has(p.id)) p.accessStatus = 'revoked';
  if (threads['family-group']) threads['family-group'] = { ...threads['family-group'], memberIds: [state.patientId, ...people.filter(p => ['family', 'carer'].includes(p.role) && p.accessStatus !== 'revoked').map(p => p.id), state.agentId] };
  const persistedAudit = snapshot.audit.map(a => ({ id: `consent-db-${a.id}`, ts: a.createdAt, kind: 'consent.update' as const, actorId: state.patientId, summary: a.detail, ok: true }));
  return { ...state, people, consent, threads, audit: [...persistedAudit, ...state.audit.filter(a => !a.id.startsWith('consent-db-'))].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 300),
    ehr: { consentVersion: snapshot.revision, lastSyncedAt: snapshot.updatedAt, lastResourceId: snapshot.sync.resourceId || undefined, gpConsentUrl: `${publicBase}/gp/consent/?patient=${encodeURIComponent(state.patient.simId)}`, persistent: true },
  };
}
