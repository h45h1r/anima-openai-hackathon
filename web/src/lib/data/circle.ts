// The patient's circle. The sim has no family / RelatedPerson concept, so this
// is the one piece of Kindred-owned configuration: WHICH sim people are in the
// circle and what each may see by default. Names, dates of birth and
// clinicians all come from the sim at load time.
//
// Eleanor Chen (SIM-000006, b. 1943) is the sim's own elderly persona; her
// record says she lives with her husband. The relatives below are other
// SIM patients with the same surname and plausible ages.

import type { Category } from "../types";

export interface CircleMember {
  simId: string;
  relation: string;
  role: "family" | "carer";
  color: string;
  consent: Category[];
}

export const PATIENT_SIM_ID = process.env.SIM_PATIENT_ID ?? "SIM-000006";

export const FAMILY: CircleMember[] = [
  { simId: "SIM-000066", relation: "Daughter", role: "family", color: "#C2572F", consent: ["appointments", "medications", "conditions", "care_notes"] },
  { simId: "SIM-000009", relation: "Son", role: "family", color: "#3B6EA8", consent: ["appointments"] },
  { simId: "SIM-000140", relation: "Husband", role: "family", color: "#8A6D2F", consent: ["appointments", "medications", "lab_results", "conditions", "care_notes"] },
];

export const CLINICIAN_DEFAULTS: Record<"practice" | "hospital", Category[]> = {
  practice: ["appointments", "medications", "lab_results", "conditions", "care_notes", "mental_health"],
  hospital: ["appointments", "medications", "lab_results", "conditions"],
};

export const AGENT = { id: "kindred", name: "Kindred", color: "#6D2E5B" };
