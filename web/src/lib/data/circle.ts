// The patient's circle. The sim has no family / RelatedPerson concept, so this
// is the one piece of Kindred-owned configuration: WHICH people are in the
// circle and what each may see by default. Clinicians and clinical facts still
// come from the sim at load time.
//
// Members with a simId are looked up in the NHS-SIM directory. Members with
// only a name are Kindred synthetic demo people (clearly demo, not EHR fact).

import type { Category } from "../types";

export interface CircleMember {
  /** NHS-SIM patient id when the relative is also a sim patient. */
  simId?: string;
  /** Display name for pure synthetic members (no sim record). */
  name?: string;
  relation: string;
  role: "family" | "carer";
  color: string;
  consent: Category[];
}

export interface DemoPatient {
  simId: string;
  name: string;
  blurb: string;
  family: CircleMember[];
}

const EVERYTHING: Category[] = ["appointments", "medications", "lab_results", "conditions", "care_notes", "mental_health"];
const PRACTICAL: Category[] = ["appointments", "medications", "care_notes"];
const UPDATES: Category[] = ["appointments", "lab_results", "conditions"];
const APPOINTMENTS_ONLY: Category[] = ["appointments"];

/** Hackathon demo cohort — shortlist from docs/demo-patients.md. */
export const DEMO_PATIENTS: DemoPatient[] = [
  {
    simId: "SIM-000001",
    name: "Amira Khan",
    blurb: "Heart failure · CKD · post-discharge",
    family: [
      { simId: "SIM-000308", relation: "Daughter", role: "family", color: "#C2572F", consent: PRACTICAL },
      { simId: "SIM-000454", relation: "Son", role: "family", color: "#3B6EA8", consent: UPDATES },
    ],
  },
  {
    simId: "SIM-000006",
    name: "Eleanor Chen",
    blurb: "Frailty · wearables · community",
    family: [
      { simId: "SIM-000066", relation: "Daughter", role: "family", color: "#C2572F", consent: ["appointments", "medications", "conditions", "care_notes"] },
      { simId: "SIM-000009", relation: "Son", role: "family", color: "#3B6EA8", consent: APPOINTMENTS_ONLY },
      { simId: "SIM-000140", relation: "Husband", role: "family", color: "#8A6D2F", consent: ["appointments", "medications", "lab_results", "conditions", "care_notes"] },
    ],
  },
  {
    simId: "SIM-000514",
    name: "Arthur Green",
    blurb: "COPD · patient-first consent",
    family: [
      { name: "Helen Green", relation: "Daughter", role: "family", color: "#C2572F", consent: UPDATES },
    ],
  },
  {
    simId: "SIM-000511",
    name: "Iris Walker",
    blurb: "Frailty · neighbour support",
    family: [
      { name: "Margaret Shaw", relation: "Neighbour", role: "carer", color: "#526F5D", consent: PRACTICAL },
    ],
  },
  {
    simId: "SIM-000244",
    name: "Daniel Patel",
    blurb: "Diabetes · heart failure",
    family: [
      { name: "Priya Patel", relation: "Daughter", role: "family", color: "#C2572F", consent: EVERYTHING.filter((c) => c !== "mental_health") },
      { name: "Ravi Patel", relation: "Son", role: "family", color: "#3B6EA8", consent: PRACTICAL },
    ],
  },
  {
    simId: "SIM-000011",
    name: "Zara Khan",
    blurb: "Hypertension · pairs with Amira",
    family: [
      { simId: "SIM-000001", relation: "Daughter", role: "family", color: "#C2572F", consent: PRACTICAL },
      { name: "Omar Khan", relation: "Grandson", role: "family", color: "#8A6D2F", consent: APPOINTMENTS_ONLY },
    ],
  },
];

export const DEFAULT_PATIENT_SIM_ID = process.env.SIM_PATIENT_ID ?? "SIM-000006";

/** Active default used when no switch has been made yet. */
export const PATIENT_SIM_ID = DEFAULT_PATIENT_SIM_ID;

export function circleFor(patientSimId: string): DemoPatient {
  const known = DEMO_PATIENTS.find((p) => p.simId === patientSimId);
  if (known) return known;
  return {
    simId: patientSimId,
    name: patientSimId,
    blurb: "Live sim patient",
    family: [
      { name: "Alex Taylor", relation: "Daughter", role: "family", color: "#C2572F", consent: PRACTICAL },
      { name: "Sam Taylor", relation: "Son", role: "family", color: "#3B6EA8", consent: APPOINTMENTS_ONLY },
    ],
  };
}

/** @deprecated Prefer circleFor(patientSimId).family — kept for older imports. */
export const FAMILY: CircleMember[] = circleFor(PATIENT_SIM_ID).family;

export const CLINICIAN_DEFAULTS: Record<"practice" | "hospital", Category[]> = {
  practice: ["appointments", "medications", "lab_results", "conditions", "care_notes", "mental_health"],
  hospital: ["appointments", "medications", "lab_results", "conditions"],
};

export const AGENT = { id: "kindred", name: "Kindred", color: "#6D2E5B" };
