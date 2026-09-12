import type { ClinicalContext } from '../types/domain';
import type { EvidenceItem } from '../consent/policy';

export function catalogueEvidence(ctx: ClinicalContext): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  for (const m of ctx.measurements) {
    items.push({
      evidenceId: m.evidenceId,
      resourceId: m.resourceId,
      informationClass: m.informationClass,
      fields: ['value', 'unit', 'sampledAt', 'displayName', 'referenceLow', 'referenceHigh'],
      payload: m,
      kind: 'measurement',
    });
  }
  for (const e of ctx.events) {
    items.push({
      evidenceId: e.evidenceId,
      resourceId: e.resourceId,
      informationClass: e.informationClass,
      fields: Object.keys(e.fields),
      payload: e,
      kind: 'event',
    });
  }
  return items;
}

