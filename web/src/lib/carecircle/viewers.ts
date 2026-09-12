import type { AppState, Person } from "@/lib/types";
import { personById } from "@/lib/types";
import { levelFor, type LevelOrState } from "@/lib/levels";

/** CareCircle Ask filter personas (server policy IDs). */
export type CareViewerId = "patient" | "sarah" | "john" | "tom";

/**
 * Map Kindred `?as=` personas onto CareCircle Ask viewers.
 * Circle membership and levels stay Kindred-owned; this only picks the Ask filter identity.
 */
export function careViewerForKindred(state: AppState, kindredPersonId: string): CareViewerId {
  if (kindredPersonId === state.patientId) return "patient";
  const person = personById(state, kindredPersonId);
  const name = person.shortName.toLowerCase();
  if (name === "sarah") return "sarah";
  if (name === "john") return "john";
  if (name === "tom") return "tom";
  if (/daughter/i.test(person.relation)) return "sarah";
  if (/husband|spouse|partner|wife/i.test(person.relation)) return "john";
  if (/son/i.test(person.relation)) return "tom";

  const family = state.people.filter((p) => p.role === "family" || p.role === "carer");
  const idx = family.findIndex((p) => p.id === kindredPersonId);
  const order: CareViewerId[] = ["sarah", "john", "tom"];
  return order[idx] ?? "tom";
}

export function kindredLevelForPerson(state: AppState, personId: string): LevelOrState {
  return levelFor(state.levels, state.consent[personId]);
}

export function familyForLevelSync(state: AppState): { person: Person; careViewerId: CareViewerId; level: LevelOrState }[] {
  return state.people
    .filter((p) => p.role === "family" || p.role === "carer")
    .map((person) => ({
      person,
      careViewerId: careViewerForKindred(state, person.id),
      level: kindredLevelForPerson(state, person.id),
    }));
}
