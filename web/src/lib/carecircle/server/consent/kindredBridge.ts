/**
 * Kindred owns people / access / control (circle + three sharing levels).
 * CareCircle Ask still needs a runtime filter over Anima information classes —
 * this adapter maps Kindred levels onto those classes so CareCircle does not
 * ship a competing class-matrix UX as the primary control surface.
 *
 * Kindred categories (web/src/lib/types.ts + levels.ts):
 *   everything → all six categories
 *   practical  → appointments, medications, care_notes
 *   updates    → appointments, lab_results, conditions
 */

import type { InformationClass } from '../types/domain';

const ALL_CLASSES: InformationClass[] = [
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

export type KindredSharingLevel = 'everything' | 'practical' | 'updates';
export type KindredLevelOrNone = KindredSharingLevel | 'none' | 'custom';

export const KINDRED_LEVELS: {
  id: KindredSharingLevel;
  label: string;
  blurb: string;
}[] = [
  { id: 'everything', label: 'Everything', blurb: 'The whole shared record' },
  { id: 'practical', label: 'Only practical', blurb: 'Day-to-day help without test results' },
  { id: 'updates', label: 'Important updates', blurb: 'The big things — appointments and results' },
];

/** Kindred category → CareCircle information classes used by Ask filtering. */
const CATEGORY_TO_CLASSES: Record<string, InformationClass[]> = {
  appointments: ['appointments', 'logistics', 'tasks'],
  medications: ['medications'],
  lab_results: ['laboratory_results'],
  conditions: ['treatment_summary', 'symptoms'],
  care_notes: ['clinical_documents'],
  mental_health: ['private_notes'],
};

/** Default Kindred level definitions, expressed as CareCircle class sets. */
export const KINDRED_LEVEL_CLASSES: Record<KindredSharingLevel, InformationClass[]> = {
  everything: ALL_CLASSES.filter((c) => c !== 'private_notes'),
  practical: unique([
    ...CATEGORY_TO_CLASSES.appointments,
    ...CATEGORY_TO_CLASSES.medications,
    ...CATEGORY_TO_CLASSES.care_notes,
  ]),
  updates: unique([
    ...CATEGORY_TO_CLASSES.appointments.filter((c) => c !== 'tasks'),
    ...CATEGORY_TO_CLASSES.lab_results,
    ...CATEGORY_TO_CLASSES.conditions,
  ]),
};

/** Demo circle members aligned to Kindred levels (not a class matrix). */
export const DEMO_VIEWER_LEVELS: Partial<Record<string, KindredSharingLevel>> = {
  sarah: 'everything',
  john: 'practical',
  // Tom starts custom/minimal so Ask still has a clear denied-results path;
  // the patient can promote him to a Kindred level from Circle.
};

/** Non-level starter grants for demo personas that begin outside the three buckets. */
export const DEMO_CUSTOM_CLASS_SETS: Record<string, InformationClass[]> = {
  tom: ['appointments', 'logistics'],
};

export function classesForLevel(level: KindredSharingLevel): Record<InformationClass, boolean> {
  const allowed = new Set(KINDRED_LEVEL_CLASSES[level]);
  return Object.fromEntries(ALL_CLASSES.map((c) => [c, allowed.has(c)])) as Record<InformationClass, boolean>;
}

export function levelForClasses(
  allowed: Iterable<InformationClass>,
): KindredLevelOrNone {
  const on = new Set([...allowed]);
  if (on.size === 0) return 'none';
  for (const level of KINDRED_LEVELS) {
    const target = new Set(KINDRED_LEVEL_CLASSES[level.id]);
    if (sameSet(on, target)) return level.id;
  }
  return 'custom';
}

export function levelLabel(level: KindredLevelOrNone): string {
  if (level === 'none') return 'Nothing shared';
  if (level === 'custom') return 'Custom';
  return KINDRED_LEVELS.find((l) => l.id === level)!.label;
}

function unique(items: InformationClass[]): InformationClass[] {
  return [...new Set(items)];
}

function sameSet(a: Set<InformationClass>, b: Set<InformationClass>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
