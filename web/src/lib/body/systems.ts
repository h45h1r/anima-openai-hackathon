// Body systems: how the record maps onto the body. Each system owns a set of
// lab analytes, condition terms, medicine terms and an anchor on the 3D figure.
// Status is computed from the live record; nothing here is patient-specific.

import type { AppState, Category, Condition, LabResult, Medication } from "../types";
import { canAccess } from "../types";

export type SystemId = "heart" | "kidneys" | "metabolic" | "blood" | "liver" | "lungs" | "gut" | "joints" | "mind";

export interface SystemDef {
  id: SystemId;
  label: string;
  short: string;
  blurb: string;
  analytes: string[]; // analyte ids from the sim's blood panels
  conditions: RegExp;
  medicines: RegExp;
  category: Category; // consent category that gates the lab part
  anchor: [number, number, number]; // x, y, z on the figure (height ≈ 1.8)
  radius: number;
  marker?: boolean; // false = no pulse marker on the figure (default true)
}

export const SYSTEMS: SystemDef[] = [
  { id: "heart", label: "Heart & circulation", short: "Heart", blurb: "Blood pressure, heart failure, cholesterol", analytes: ["total-cholesterol", "hdl-cholesterol", "ldl-cholesterol", "triglycerides"], conditions: /heart|hypertension|blood pressure|atrial|cardiac|angina|cholesterol/i, medicines: /bisoprolol|ramipril|losartan|furosemide|amlodipine|atorvastatin|apixaban|statin/i, category: "lab_results", anchor: [-0.05, 1.28, 0.06], radius: 0.16 },
  { id: "lungs", label: "Lungs & breathing", short: "Lungs", blurb: "Asthma, COPD, breathlessness", analytes: [], conditions: /asthma|copd|respirat|breath|lung|pulmon|oxygen/i, medicines: /salbutamol|beclometasone|tiotropium|inhaler|budesonide/i, category: "conditions", anchor: [0.09, 1.3, 0.02], radius: 0.18 },
  { id: "kidneys", label: "Kidneys & fluids", short: "Kidneys", blurb: "Kidney function, salts and fluid balance", analytes: ["creatinine", "egfr", "urea", "sodium", "potassium"], conditions: /kidney|ckd|renal|nephro/i, medicines: /ramipril|losartan|furosemide/i, category: "lab_results", anchor: [0, 1.02, -0.08], radius: 0.16 },
  { id: "metabolic", label: "Blood sugar & metabolism", short: "Sugar", blurb: "Diabetes control over the last three months", analytes: ["hba1c"], conditions: /diabet|glucose|sugar|thyroid|weight|obes/i, medicines: /metformin|gliclazide|insulin|dapagliflozin/i, category: "lab_results", anchor: [0, 1.12, 0.09], radius: 0.14 },
  { id: "liver", label: "Liver", short: "Liver", blurb: "Liver enzymes and protein", analytes: ["alt", "alp", "alkaline-phosphatase", "bilirubin", "albumin", "ggt"], conditions: /liver|hepat|gallbladder|biliary/i, medicines: /ursodeoxycholic/i, category: "lab_results", anchor: [-0.1, 1.14, 0.07], radius: 0.13 },
  { id: "blood", label: "Blood & immunity", short: "Blood", blurb: "Blood counts, infection and inflammation", analytes: ["haemoglobin", "white-cell-count", "neutrophils", "platelets", "mcv", "crp"], conditions: /anaemi|infection|immun|inflamm|sepsis/i, medicines: /ferrous|folic|b12/i, category: "lab_results", anchor: [0.27, 1.3, 0.02], radius: 0.12, marker: false },
  { id: "gut", label: "Gut & digestion", short: "Gut", blurb: "Stomach, bowel and appetite", analytes: [], conditions: /bowel|stomach|reflux|constipat|coeliac|ibs|digest|diverticul|gastro|appetite/i, medicines: /omeprazole|lansoprazole|laxido|macrogol|senna|loperamide/i, category: "conditions", anchor: [0, 1.0, 0.05], radius: 0.16 },
  { id: "joints", label: "Bones & joints", short: "Joints", blurb: "Arthritis, mobility, frailty and falls", analytes: [], conditions: /arthrit|musculoskel|joint|frail|fall|mobility|osteo|back pain|fracture/i, medicines: /paracetamol|alendronic|colecalciferol|naproxen|ibuprofen|diclofenac/i, category: "conditions", anchor: [0.11, 0.48, 0.02], radius: 0.2 },
  { id: "mind", label: "Mind & sleep", short: "Mind", blurb: "Mood, memory and sleep", analytes: [], conditions: /sleep|mood|anxiet|depress|mental|memory|dementia|stress|wellbeing|loneli/i, medicines: /sertraline|citalopram|mirtazapine|zopiclone|donepezil/i, category: "mental_health", anchor: [0, 1.62, 0.02], radius: 0.13 },
];

export type SystemState = "out" | "watch" | "ok" | "none" | "locked";

export interface AnalyteView {
  lab: LabResult;
  trend: "up" | "down" | "flat";
  changePct: number;
}

export interface SystemStatus {
  def: SystemDef;
  state: SystemState;
  analytes: AnalyteView[];
  outOfRange: number;
  conditions: Condition[];
  medicines: Medication[];
  mental: { title: string; detail: string }[];
  summary: string;
}

function trendOf(lab: LabResult): { trend: AnalyteView["trend"]; changePct: number } {
  const h = lab.history;
  if (!h || h.length < 2) return { trend: "flat", changePct: 0 };
  const a = h[0].value;
  const b = h[h.length - 1].value;
  if (a === 0) return { trend: "flat", changePct: 0 };
  const pct = ((b - a) / Math.abs(a)) * 100;
  return { trend: pct > 8 ? "up" : pct < -8 ? "down" : "flat", changePct: Math.round(pct) };
}

export function computeSystems(state: AppState, viewerId: string): SystemStatus[] {
  return SYSTEMS.map((def) => {
    const labsAllowed = canAccess(state, viewerId, "lab_results");
    const condAllowed = canAccess(state, viewerId, "conditions");
    const medsAllowed = canAccess(state, viewerId, "medications");
    const mindAllowed = canAccess(state, viewerId, "mental_health");

    const analytes: AnalyteView[] = labsAllowed
      ? state.labs.filter((l) => def.analytes.includes(l.code)).map((lab) => ({ lab, ...trendOf(lab) }))
      : [];
    const conditions = condAllowed ? state.conditions.filter((c) => def.conditions.test(c.name)) : [];
    const medicines = medsAllowed ? state.medications.filter((m) => def.medicines.test(`${m.name} ${m.purpose}`)) : [];
    const mental = def.id === "mind" && mindAllowed ? state.mentalHealth.map((m) => ({ title: m.title, detail: m.detail })) : [];
    const outOfRange = analytes.filter((a) => a.lab.flag !== "normal").length;
    const moving = analytes.filter((a) => a.trend !== "flat").length;

    const gatedOut = (def.analytes.length > 0 && !labsAllowed) || (def.id === "mind" && !mindAllowed) || (def.analytes.length === 0 && def.id !== "mind" && !condAllowed);
    let state_: SystemState;
    if (gatedOut && analytes.length === 0 && conditions.length === 0 && mental.length === 0) state_ = "locked";
    else if (outOfRange > 0) state_ = "out";
    else if (moving > 0 || conditions.length > 0 || mental.length > 0) state_ = "watch";
    else if (analytes.length > 0 || medicines.length > 0) state_ = "ok";
    else state_ = "none";

    const parts: string[] = [];
    if (outOfRange) parts.push(`${outOfRange} result${outOfRange > 1 ? "s" : ""} outside range`);
    else if (analytes.length) parts.push(`${analytes.length} result${analytes.length > 1 ? "s" : ""} in range`);
    if (conditions.length) parts.push(conditions.map((c) => c.name).join(", "));
    if (medicines.length) parts.push(`${medicines.length} medicine${medicines.length > 1 ? "s" : ""}`);
    if (mental.length) parts.push(mental.map((m) => m.title).join(", "));
    const summary = state_ === "locked" ? "Not shared with you" : parts.join(" · ") || "Nothing on record";

    return { def, state: state_, analytes, outOfRange, conditions, medicines, mental, summary };
  });
}

export const STATE_LABEL: Record<SystemState, string> = { out: "Outside range", watch: "Watch", ok: "In range", none: "No data", locked: "Not shared" };
