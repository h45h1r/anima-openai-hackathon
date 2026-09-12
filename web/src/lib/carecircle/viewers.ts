import type { AppState, Person } from "@/lib/types";
import { personById } from "@/lib/types";
import { levelFor, type LevelOrState } from "@/lib/levels";

/** CareCircle Ask filter personas (server policy IDs). */
export type CareViewerId = string;

export function careViewerForKindred(state: AppState, kindredPersonId: string): CareViewerId {
  return kindredPersonId === state.patientId ? 'patient' : kindredPersonId;
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
