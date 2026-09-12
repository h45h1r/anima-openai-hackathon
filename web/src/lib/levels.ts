// Sharing levels: three patient-friendly buckets that map onto the six record
// categories. The patient edits what each level means; every person on that
// level is re-applied. Enforcement still happens per category in tools.ts.

import { CATEGORIES, type Category, type LevelDefinitions, type SharingLevel } from "./types";

export const LEVELS: { id: SharingLevel; label: string; blurb: string }[] = [
  { id: "everything", label: "Everything", blurb: "The whole record, including mood and wellbeing" },
  { id: "practical", label: "Only practical", blurb: "What someone needs to help day to day" },
  { id: "updates", label: "Important updates", blurb: "The big things, without the day-to-day detail" },
];

export const DEFAULT_LEVELS: LevelDefinitions = {
  everything: CATEGORIES.map((c) => c.id),
  practical: ["appointments", "medications", "care_notes"],
  updates: ["appointments", "lab_results", "conditions"],
};

export type LevelOrState = SharingLevel | "custom" | "none";

const same = (a: Category[], b: Category[]) => a.length === b.length && a.every((x) => b.includes(x));

export function allowedCategories(scopes: Record<Category, boolean> | undefined): Category[] {
  return CATEGORIES.filter((c) => scopes?.[c.id]).map((c) => c.id);
}

/** Which level a person's current categories correspond to. */
export function levelFor(defs: LevelDefinitions | undefined, scopes: Record<Category, boolean> | undefined): LevelOrState {
  const d = defs ?? DEFAULT_LEVELS;
  const on = allowedCategories(scopes);
  if (on.length === 0) return "none";
  for (const l of LEVELS) if (same(d[l.id], on)) return l.id;
  return "custom";
}

export function levelLabel(level: LevelOrState): string {
  if (level === "custom") return "Custom";
  if (level === "none") return "Nothing shared";
  return LEVELS.find((l) => l.id === level)!.label;
}

export function categoryLabels(ids: Category[]): string[] {
  return CATEGORIES.filter((c) => ids.includes(c.id)).map((c) => c.label);
}
