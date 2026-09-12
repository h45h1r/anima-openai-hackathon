import { getConsentSnapshot, consentRequest } from '@/lib/consent-store';
import { careStore } from '../store/runtime';
import { INFORMATION_CLASSES, type ConsentPolicyState } from './policy';
import type { InformationClass } from '../types/domain';

const categories: Record<string, InformationClass[]> = {
  appointments: ['appointments', 'logistics', 'tasks'], medications: ['medications'],
  results: ['laboratory_results'], conditions: ['treatment_summary', 'symptoms'],
  care_notes: ['clinical_documents'], mental_health: ['private_notes'],
};

export async function canonicalPolicy(patientId: string, patientName: string): Promise<ConsentPolicyState> {
  const snapshot = await getConsentSnapshot(patientId);
  if (snapshot.patient.id !== patientId) throw new Error('Consent belongs to a different patient.');
  const previous = careStore().ensurePolicy(patientId, patientName);
  const now = new Date().toISOString();
  const viewers: ConsentPolicyState['viewers'] = [
    { viewerId: 'patient', patientId, displayName: patientName, relationship: 'self', status: 'active' },
    ...snapshot.members.map(member => ({ viewerId: member.externalId || `family-${member.id}`, patientId,
      displayName: member.name, relationship: member.role === 'clinician' ? 'clinician_reviewer' as const : 'family_member' as const, status: member.status })),
  ];
  const grants = viewers.flatMap(viewer => {
    const member = snapshot.members.find(m => (m.externalId || `family-${m.id}`) === viewer.viewerId);
    const allowed = new Set(viewer.viewerId === 'patient' ? INFORMATION_CLASSES : member?.status === 'active' ? member.categories.flatMap(c => categories[c] || []) : []);
    return INFORMATION_CLASSES.map(informationClass => ({ grantId: `${viewer.viewerId}:${informationClass}`, patientId, viewerId: viewer.viewerId,
      informationClass, purpose: 'understand', scope: 'class' as const, startsAt: now, version: snapshot.revision,
      allowed: allowed.has(informationClass) }));
  });
  return careStore().savePolicy({ ...previous, canonicalRevision: snapshot.revision, policyVersion: Math.max(previous.policyVersion, snapshot.revision), viewers, grants, sharingLevels: {} });
}

export async function saveCanonicalPolicy(next: ConsentPolicyState): Promise<void> {
  const snapshot = await getConsentSnapshot(next.patientId);
  const previous = careStore().getPolicy(next.patientId);
  if (previous?.canonicalRevision !== snapshot.revision) throw new Error('Sharing changed in another window. Refresh and try again.');
  for (const member of snapshot.members.filter(member => member.status === 'active')) {
    const viewerId = member.externalId || `family-${member.id}`;
    const allowed = new Set(next.grants.filter(g => g.viewerId === viewerId && g.allowed && !g.revokedAt).map(g => g.informationClass));
    const shared = Object.entries(categories).filter(([, classes]) => allowed.has(classes[0])).map(([category]) => category);
    if (shared.length === member.categories.length && shared.every(category => member.categories.includes(category))) continue;
    await consentRequest(next.patientId, `/members/${member.id}`, 'PATCH', { ...member, expectedVersion: member.version, categories: shared });
  }
  careStore().savePolicy(next);
  await canonicalPolicy(next.patientId, next.viewers.find(viewer => viewer.viewerId === 'patient')?.displayName || next.patientId);
}
