#!/usr/bin/env node
/**
 * Kindred demo enrichment for the Anima NHS-SIM copy.
 *
 * Rewrites the synthetic blood histories of the demo cohort so every analyte
 * tells one clinically coherent story (eGFR coupled to creatinine through
 * CKD-EPI 2021), adds repeat medicines and active problems that match the
 * coded conditions, books one story appointment per patient through the local
 * action API, and gives Amira Khan a home-monitoring device with ten days of
 * readings. Idempotent: running it twice leaves the database unchanged.
 *
 * Usage (from sim-app):
 *   node enrich/enrich.mjs [--patients SIM-000001,...] [--dry-run] [--verify]
 *                          [--api http://localhost:4192] [--sex SIM-000001=female]
 *                          [--no-tests]
 *   node --env-file=.env.neon.development enrich/enrich.mjs ...   (Neon)
 *
 * The database is chosen exactly as sim-app/store.mjs does: DIRECT_DATABASE_URL
 * or DATABASE_URL when set, otherwise APP_DATABASE (default
 * anima_sim_app_20260912) through the PostgreSQL socket at PGHOST (default /tmp).
 * The archival replica is refused. Connection strings are never printed.
 */
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIM_APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENRICHMENT_VERSION = 'kindred-v1';
const ACTOR = { kind: 'team', name: 'Kindred enrichment' };
const ACTION = 'enrich_demo_data';
const SITES = ['gp', 'hospital', 'community', 'pharmacy', 'diagnostics', 'referrals', 'wearables', 'patient'];
const COHORT = ['SIM-000001', 'SIM-000514', 'SIM-000511', 'SIM-000244', 'SIM-000204', 'SIM-000107', 'SIM-000011', 'SIM-000006'];
const REFERENCE_PATIENT = 'SIM-000001';
const FALLBACK_DATES = [1757664000000, 1768464000000, 1778832000000, 1784016000000, 1787990400000, 1789113600000];
const LABORATORY = 'Northbank training laboratory';
const MINUTE = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const REPORT_VISIBLE_TO = ['gp', 'hospital', 'diagnostics'];
const WEARABLE_VISIBLE_TO = ['wearables', 'community', 'patient'];
const MAX_MEDICINES = 6;

// ---------------------------------------------------------------------------
// Panels: identical ids, names, units and reference ranges to the sim's own
// `blood-v1-*` reports. Last column is the number of decimal places.
const PANELS = {
  fbc: { name: 'Full blood count (FBC)', analytes: [
    ['haemoglobin', 'Haemoglobin', 'g/L', 115, 165, 0],
    ['white-cell-count', 'White cell count', '×10⁹/L', 4, 11, 1],
    ['platelets', 'Platelets', '×10⁹/L', 150, 400, 0],
    ['mcv', 'Mean cell volume', 'fL', 80, 100, 1],
    ['neutrophils', 'Neutrophils', '×10⁹/L', 2, 7.5, 1],
  ] },
  ue: { name: 'Urea & electrolytes (U&E)', analytes: [
    ['sodium', 'Sodium', 'mmol/L', 133, 146, 0],
    ['potassium', 'Potassium', 'mmol/L', 3.5, 5.3, 1],
    ['urea', 'Urea', 'mmol/L', 2.5, 7.8, 1],
    ['creatinine', 'Creatinine', 'µmol/L', 45, 110, 0],
    ['egfr', 'eGFR', 'mL/min/1.73m²', 60, 120, 0],
  ] },
  hba1c: { name: 'HbA1c', analytes: [['hba1c', 'HbA1c', 'mmol/mol', 20, 41, 0]] },
  lft: { name: 'Liver function tests (LFT)', analytes: [
    ['alt', 'ALT', 'U/L', 0, 40, 0],
    ['alp', 'Alkaline phosphatase', 'U/L', 30, 130, 0],
    ['bilirubin', 'Bilirubin', 'µmol/L', 0, 21, 0],
    ['albumin', 'Albumin', 'g/L', 35, 50, 0],
  ] },
  crp: { name: 'C-reactive protein (CRP)', analytes: [['crp', 'C-reactive protein', 'mg/L', 0, 5, 1]] },
  lipids: { name: 'Lipid profile', analytes: [
    ['total-cholesterol', 'Total cholesterol', 'mmol/L', 0, 5, 1],
    ['hdl', 'HDL cholesterol', 'mmol/L', 1, 2.5, 1],
    ['triglycerides', 'Triglycerides', 'mmol/L', 0, 1.7, 1],
  ] },
};
const PANEL_IDS = ['fbc', 'ue', 'hba1c', 'lft', 'crp', 'lipids'];

// ---------------------------------------------------------------------------
// Stories. Six values per analyte, one per collection date (oldest first).
// `egfr` is the target; creatinine is solved from it with CKD-EPI 2021 and the
// stored eGFR is recomputed from the rounded creatinine. `ureaRatio` is
// urea / creatinine (mmol/L per µmol/L), which lets urea track creatinine.
const STORIES = {
  'SIM-000001': {
    summary: 'Heart failure with CKD: eGFR drifting from ~58 to ~46 with a step down at the last two draws around a heart-failure admission; potassium creeping up on heart-failure medicines; CRP spike on the final draw; mild anaemia.',
    egfr: [58, 56, 55, 53, 48, 46],
    ureaRatio: [0.062, 0.062, 0.063, 0.064, 0.072, 0.076],
    series: {
      sodium: [139, 138, 138, 137, 136, 135], potassium: [5.0, 5.1, 5.2, 5.3, 5.5, 5.6],
      haemoglobin: [118, 117, 116, 115, 113, 112], 'white-cell-count': [6.2, 6.4, 6.1, 6.5, 7.8, 8.4], platelets: [240, 236, 232, 228, 244, 251], mcv: [88.1, 88.4, 88.9, 89.2, 89.6, 90.0], neutrophils: [3.8, 3.9, 3.7, 4.0, 5.2, 5.8],
      hba1c: [38, 38, 39, 39, 40, 40],
      alt: [18, 17, 19, 18, 22, 24], alp: [74, 76, 75, 78, 84, 88], bilirubin: [9, 10, 9, 10, 12, 13], albumin: [40, 40, 39, 39, 36, 35],
      crp: [3.2, 3.6, 4.1, 4.4, 9.5, 28.4],
      'total-cholesterol': [4.6, 4.5, 4.5, 4.4, 4.4, 4.3], hdl: [1.2, 1.2, 1.2, 1.1, 1.1, 1.1], triglycerides: [1.5, 1.5, 1.6, 1.6, 1.7, 1.7],
    },
    appointment: { title: 'Heart failure review after discharge', clinician: 'Dr Maya Shah', mode: 'in-person', day: 0 },
    monitoring: {
      summary: 'Home activity watch after a heart-failure admission: steps falling from ~3200 to 1400 and resting heart rate rising from 72 to 88 over the last four days; sleep shortening.',
      battery: 81,
      steps: [3250, 3300, 3180, 3220, 3150, 3200, 2700, 2200, 1750, 1400],
      'heart-rate': [72, 71, 73, 72, 72, 73, 76, 80, 84, 88],
      sleep: [6.5, 6.6, 6.4, 6.5, 6.3, 6.5, 6.1, 5.8, 5.5, 5.2],
      baseline: 3200,
    },
  },
  'SIM-000514': {
    summary: 'COPD: pre-diabetes brought under control (HbA1c 55 to 42), cholesterol rising, kidney function stable, CRP mildly raised with COPD.',
    egfr: [78, 79, 77, 78, 78, 77],
    ureaRatio: 0.055,
    series: {
      sodium: [140, 141, 140, 140, 139, 140], potassium: [4.2, 4.3, 4.2, 4.3, 4.3, 4.4],
      haemoglobin: [146, 145, 147, 146, 148, 147], 'white-cell-count': [8.2, 8.6, 9.1, 8.4, 8.8, 9.3], platelets: [262, 258, 271, 265, 268, 274], mcv: [91.2, 91.5, 91.8, 92.0, 92.3, 92.6], neutrophils: [5.4, 5.7, 6.1, 5.6, 5.9, 6.3],
      hba1c: [55, 52, 48, 45, 43, 42],
      alt: [24, 26, 25, 27, 26, 28], alp: [78, 80, 79, 82, 81, 83], bilirubin: [10, 11, 10, 11, 11, 12], albumin: [42, 42, 41, 42, 41, 41],
      crp: [6.4, 7.1, 8.2, 6.8, 7.6, 8.9],
      'total-cholesterol': [5.0, 5.3, 5.6, 5.9, 6.1, 6.3], hdl: [1.1, 1.1, 1.0, 1.0, 1.0, 1.0], triglycerides: [1.8, 1.9, 2.0, 2.1, 2.1, 2.2],
    },
    appointment: { title: 'COPD annual review', clinician: 'Nurse Alex Morgan', mode: 'in-person', day: 0 },
  },
  'SIM-000511': {
    summary: 'Arthritis and frailty at 89: stable CKD 3a, haemoglobin slowly falling, albumin at the low edge, low-grade CRP.',
    egfr: [52, 53, 52, 51, 52, 52],
    ureaRatio: 0.058,
    series: {
      sodium: [138, 139, 138, 138, 137, 138], potassium: [4.3, 4.4, 4.3, 4.4, 4.5, 4.5],
      haemoglobin: [118, 116, 115, 113, 112, 110], 'white-cell-count': [5.8, 5.6, 5.9, 5.7, 5.5, 5.6], platelets: [310, 305, 298, 302, 295, 290], mcv: [87.5, 87.0, 86.6, 86.2, 85.8, 85.4], neutrophils: [3.5, 3.4, 3.6, 3.5, 3.3, 3.4],
      hba1c: [37, 37, 38, 38, 38, 39],
      alt: [15, 14, 16, 15, 14, 15], alp: [88, 90, 92, 91, 94, 95], bilirubin: [8, 8, 9, 8, 9, 9], albumin: [36, 36, 35, 35, 34, 34],
      crp: [3.4, 4.1, 4.8, 5.2, 5.6, 5.9],
      'total-cholesterol': [4.9, 4.8, 4.9, 4.8, 4.7, 4.7], hdl: [1.5, 1.5, 1.5, 1.4, 1.4, 1.4], triglycerides: [1.2, 1.2, 1.3, 1.2, 1.3, 1.3],
    },
    appointment: { title: 'Frailty review', clinician: 'Dr Daniel Brooks', mode: 'telephone', day: 1 },
  },
  'SIM-000244': {
    summary: 'Diabetes and heart failure improving on treatment: HbA1c 68 to 50, kidney function recovering, anaemia resolving, CRP settling; potassium creeping up.',
    egfr: [44, 47, 51, 54, 57, 58],
    ureaRatio: [0.068, 0.066, 0.064, 0.062, 0.061, 0.060],
    series: {
      sodium: [138, 139, 139, 140, 140, 140], potassium: [5.2, 5.2, 5.3, 5.4, 5.4, 5.5],
      haemoglobin: [118, 121, 124, 128, 130, 132], 'white-cell-count': [7.4, 7.1, 6.9, 6.8, 6.6, 6.5], platelets: [232, 236, 240, 238, 244, 246], mcv: [86.5, 87.0, 87.6, 88.0, 88.4, 88.8], neutrophils: [4.6, 4.4, 4.2, 4.1, 4.0, 3.9],
      hba1c: [68, 63, 58, 54, 51, 50],
      alt: [32, 30, 28, 26, 25, 24], alp: [92, 90, 88, 86, 85, 84], bilirubin: [8, 8, 9, 9, 9, 10], albumin: [38, 39, 39, 40, 40, 41],
      crp: [8.0, 6.2, 4.5, 3.4, 2.6, 2.0],
      'total-cholesterol': [5.4, 5.1, 4.8, 4.5, 4.3, 4.2], hdl: [0.9, 1.0, 1.0, 1.1, 1.1, 1.1], triglycerides: [2.4, 2.2, 2.0, 1.8, 1.7, 1.6],
    },
    appointment: { title: 'Diabetes review', clinician: 'Nurse Alex Morgan', mode: 'in-person', day: 1 },
  },
  'SIM-000204': {
    summary: 'Hypertension with CKD: eGFR falling from 60 to 47 as creatinine rises, HbA1c in the diabetic range although diabetes is not coded, white cells rising on the last two draws.',
    egfr: [60, 57, 54, 51, 49, 47],
    ureaRatio: [0.058, 0.059, 0.060, 0.061, 0.062, 0.063],
    series: {
      sodium: [140, 139, 139, 138, 138, 137], potassium: [4.6, 4.7, 4.8, 4.9, 5.0, 5.1],
      haemoglobin: [124, 123, 123, 122, 121, 120], 'white-cell-count': [8.9, 9.1, 9.3, 9.6, 11.6, 12.1], platelets: [255, 250, 258, 252, 262, 268], mcv: [89.0, 89.3, 89.5, 89.8, 90.1, 90.3], neutrophils: [5.8, 6.0, 6.2, 6.4, 8.3, 8.8],
      hba1c: [60, 59, 58, 57, 55, 54],
      alt: [16, 17, 16, 18, 17, 18], alp: [84, 86, 85, 88, 87, 89], bilirubin: [9, 9, 10, 9, 10, 10], albumin: [39, 39, 38, 38, 38, 37],
      crp: [4.2, 4.6, 5.1, 5.5, 8.7, 9.8],
      'total-cholesterol': [5.6, 5.5, 5.5, 5.4, 5.4, 5.3], hdl: [1.3, 1.3, 1.3, 1.2, 1.2, 1.2], triglycerides: [1.6, 1.6, 1.7, 1.7, 1.8, 1.8],
    },
    appointment: { title: 'Kidney function review', clinician: 'Dr Maya Shah', mode: 'in-person', day: 2 },
  },
  'SIM-000107': {
    summary: 'Diabetes, hypertension, CKD and heart failure at 95: sodium and potassium falling together on diuretics, kidney function declining, HbA1c stable.',
    egfr: [55, 53, 51, 48, 46, 44],
    ureaRatio: [0.068, 0.070, 0.073, 0.076, 0.080, 0.084],
    series: {
      sodium: [137, 136, 134, 133, 131, 130], potassium: [4.0, 3.9, 3.7, 3.5, 3.3, 3.2],
      haemoglobin: [121, 120, 120, 119, 118, 118], 'white-cell-count': [6.6, 6.8, 6.5, 6.9, 7.0, 7.2], platelets: [218, 214, 222, 216, 210, 208], mcv: [92.0, 92.4, 92.8, 93.1, 93.5, 93.8], neutrophils: [4.1, 4.3, 4.0, 4.4, 4.5, 4.6],
      hba1c: [58, 57, 58, 59, 58, 58],
      alt: [14, 15, 14, 16, 15, 16], alp: [96, 98, 97, 100, 102, 104], bilirubin: [7, 8, 8, 9, 9, 10], albumin: [37, 37, 36, 36, 35, 35],
      crp: [5.0, 5.4, 4.8, 5.6, 6.1, 6.6],
      'total-cholesterol': [4.4, 4.3, 4.3, 4.2, 4.2, 4.1], hdl: [1.4, 1.4, 1.3, 1.3, 1.3, 1.3], triglycerides: [1.4, 1.5, 1.5, 1.6, 1.6, 1.6],
    },
    appointment: { title: 'Medication review', clinician: 'Dr Daniel Brooks', mode: 'telephone', day: 2 },
  },
  'SIM-000011': {
    summary: 'Hypertension and heart failure at 91: potassium persistently low on diuretics, kidney function drifting down, CRP rising.',
    egfr: [52, 50, 49, 47, 46, 45],
    ureaRatio: [0.064, 0.065, 0.066, 0.067, 0.068, 0.069],
    series: {
      sodium: [138, 137, 137, 136, 136, 135], potassium: [3.4, 3.3, 3.2, 3.1, 3.2, 3.1],
      haemoglobin: [122, 121, 121, 120, 119, 118], 'white-cell-count': [7.0, 7.2, 7.5, 7.8, 8.1, 8.4], platelets: [236, 240, 244, 248, 252, 256], mcv: [90.5, 90.8, 91.0, 91.3, 91.6, 91.8], neutrophils: [4.4, 4.6, 4.8, 5.0, 5.3, 5.5],
      hba1c: [39, 39, 40, 40, 40, 41],
      alt: [19, 20, 19, 21, 20, 22], alp: [90, 92, 91, 94, 96, 98], bilirubin: [11, 11, 12, 12, 13, 13], albumin: [38, 38, 37, 37, 36, 36],
      crp: [6.0, 6.8, 7.9, 8.8, 9.9, 11.0],
      'total-cholesterol': [4.8, 4.8, 4.7, 4.7, 4.6, 4.6], hdl: [1.3, 1.3, 1.3, 1.2, 1.2, 1.2], triglycerides: [1.3, 1.4, 1.4, 1.5, 1.5, 1.5],
    },
    appointment: { title: 'Blood pressure review', clinician: 'Nurse Alex Morgan', mode: 'in-person', day: 3 },
  },
  'SIM-000006': {
    summary: 'Frailty at 83: HbA1c at the pre-diabetic edge, kidney function normal for age, haemoglobin slowly falling, mildly raised bilirubin (Gilbert-like), normal white cells.',
    egfr: [66, 67, 68, 69, 70, 70],
    ureaRatio: 0.054,
    series: {
      sodium: [139, 140, 139, 140, 139, 139], potassium: [4.1, 4.2, 4.1, 4.2, 4.3, 4.2],
      haemoglobin: [130, 129, 128, 127, 125, 124], 'white-cell-count': [6.4, 6.2, 6.5, 6.3, 6.1, 6.4], platelets: [246, 242, 250, 244, 238, 240], mcv: [89.4, 89.7, 90.0, 90.3, 90.6, 90.9], neutrophils: [3.9, 3.8, 4.0, 3.9, 3.7, 3.9],
      hba1c: [51, 50, 50, 49, 48, 48],
      alt: [17, 16, 18, 17, 18, 17], alp: [72, 74, 73, 75, 74, 76], bilirubin: [19, 21, 20, 23, 22, 24], albumin: [41, 41, 40, 40, 39, 39],
      crp: [2.1, 2.6, 2.3, 3.0, 2.8, 3.4],
      'total-cholesterol': [5.2, 5.1, 5.2, 5.0, 5.1, 5.0], hdl: [1.6, 1.6, 1.5, 1.6, 1.5, 1.5], triglycerides: [1.1, 1.2, 1.1, 1.2, 1.2, 1.3],
    },
    appointment: { title: 'Falls and mobility review', clinician: 'Dr Maya Shah', mode: 'in-person', day: 3 },
  },
};

/** Coherent fallback for a patient outside the scripted cohort, derived from coded conditions. */
function genericStory(patient) {
  const conditions = patient.conditions.map(c => c.toLowerCase());
  const has = re => conditions.some(c => re.test(c));
  const age = patient.ageNow, diabetic = has(/diabet/), ckd = has(/ckd|kidney/), hf = has(/heart failure/), copd = has(/copd|asthma/), old = age >= 85;
  const base = ckd ? 50 : old ? 60 : age >= 75 ? 68 : 82;
  const drift = (start, step, dp = 0) => [0, 1, 2, 3, 4, 5].map(i => round(start + step * i, dp));
  return {
    summary: `Stable long-term conditions (${patient.conditions.join(', ') || 'none coded'}): every analyte follows one gentle trajectory that agrees with kidney function.`,
    egfr: drift(base, ckd ? -1 : -0.4),
    ureaRatio: hf || ckd ? 0.062 : 0.052,
    series: {
      sodium: [139, 140, 139, 139, 138, 139], potassium: hf || ckd ? drift(4.7, 0.06, 1) : drift(4.1, 0.04, 1),
      haemoglobin: drift(old ? 126 : 138, -0.6), 'white-cell-count': drift(copd ? 8.0 : 6.3, 0.1, 1), platelets: drift(250, -2), mcv: drift(89.0, 0.2, 1), neutrophils: drift(copd ? 5.2 : 3.9, 0.06, 1),
      hba1c: diabetic ? drift(58, -0.8) : drift(37, 0.4),
      alt: drift(18, 0.4), alp: drift(80, 1), bilirubin: drift(9, 0.4), albumin: drift(41, -0.4),
      crp: drift(copd ? 6.0 : 2.4, 0.3, 1),
      'total-cholesterol': drift(diabetic || ckd ? 4.4 : 5.0, -0.06, 1), hdl: drift(1.3, -0.02, 1), triglycerides: drift(1.3, 0.04, 1),
    },
    appointment: { title: 'Long-term condition review', clinician: 'Nurse Alex Morgan', mode: 'in-person', day: hash(patient.id) % 5 },
  };
}

// ---------------------------------------------------------------------------
// Medicines and problems by coded condition.
const MEDICINES = {
  bisoprolol: { term: 'Bisoprolol 2.5mg tablets', route: 'oral', note: 'Titrated to heart rate and blood pressure.' },
  ramipril: { term: 'Ramipril 5mg capsules', route: 'oral', note: 'Potassium and kidney function checked at each review.' },
  losartan: { term: 'Losartan 50mg tablets', route: 'oral', note: 'Used instead of an ACE inhibitor at this stage of kidney disease.' },
  furosemide: { term: 'Furosemide 40mg tablets', route: 'oral', note: 'Dose adjusted to weight and ankle swelling.' },
  atorvastatin: { term: 'Atorvastatin 20mg tablets', route: 'oral', note: 'Taken at night.' },
  metformin: { term: 'Metformin 500mg tablets', route: 'oral', note: 'Taken with meals; kidney function checked before each issue.' },
  amlodipine: { term: 'Amlodipine 5mg tablets', route: 'oral', note: 'Once daily in the morning.' },
  salbutamol: { term: 'Salbutamol 100micrograms/dose inhaler', route: 'inhaled', note: 'As required for breathlessness.' },
  tiotropium: { term: 'Tiotropium 18micrograms inhalation powder', route: 'inhaled', note: 'Once daily maintenance inhaler.' },
  beclometasone: { term: 'Beclometasone 200micrograms/dose inhaler', route: 'inhaled', note: 'Twice daily preventer inhaler.' },
  paracetamol: { term: 'Paracetamol 500mg tablets', route: 'oral', note: 'Regular for joint pain, up to four times a day.' },
  alendronic: { term: 'Alendronic acid 70mg tablets', route: 'oral', note: 'Once weekly, first thing with a glass of water.' },
  colecalciferol: { term: 'Colecalciferol 800unit capsules', route: 'oral', note: 'Once daily for bone health.' },
};
const CONDITION_MEDICINES = [
  [/heart failure/i, ['bisoprolol', 'raas', 'furosemide']],
  [/\bckd\b|kidney/i, ['raas', 'atorvastatin']],
  [/diabet/i, ['metformin', 'atorvastatin']],
  [/hypertension/i, ['amlodipine', 'raas']],
  [/copd/i, ['tiotropium', 'salbutamol']],
  [/asthma/i, ['beclometasone', 'salbutamol']],
  [/arthritis/i, ['paracetamol']],
  [/frail/i, ['colecalciferol', 'alendronic']],
];

// ---------------------------------------------------------------------------
// Small utilities.
const round = (value, dp) => Number(value.toFixed(dp));
const isoDate = ms => new Date(ms).toISOString().slice(0, 10);
const dayStartOf = ms => Math.floor(ms / DAY) * DAY;
function hash(text) { let h = 0x811c9dc5; for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h; }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function ageAt(birthDate, at) {
  const born = new Date(birthDate), date = new Date(at);
  let age = date.getUTCFullYear() - born.getUTCFullYear();
  const months = date.getUTCMonth() - born.getUTCMonth();
  if (months < 0 || (months === 0 && date.getUTCDate() < born.getUTCDate())) age -= 1;
  return age;
}

/** CKD-EPI 2021 creatinine equation (race-free). Creatinine in µmol/L, age in years. */
export function ckdEpi2021(creatinineUmol, age, sex) {
  const scr = creatinineUmol / 88.42;
  const female = sex === 'female';
  const kappa = female ? 0.7 : 0.9, alpha = female ? -0.241 : -0.302;
  const ratio = scr / kappa;
  return 142 * Math.min(ratio, 1) ** alpha * Math.max(ratio, 1) ** -1.2 * 0.9938 ** age * (female ? 1.012 : 1);
}
/** Integer creatinine (µmol/L) whose CKD-EPI eGFR is closest to the target. */
function creatinineFor(egfr, age, sex) {
  let low = 20, high = 1500;
  for (let i = 0; i < 60; i++) { const mid = (low + high) / 2; if (ckdEpi2021(mid, age, sex) > egfr) low = mid; else high = mid; }
  return Math.round((low + high) / 2);
}

const FEMALE_NAMES = new Set(['amira', 'iris', 'zara', 'freya', 'eleanor', 'aisha', 'sofia', 'grace', 'olivia', 'amelia', 'isla', 'ava', 'mia', 'emily', 'sophia', 'ella', 'lily', 'isabella', 'poppy', 'charlotte', 'evie', 'florence', 'alice', 'maya', 'ruby', 'esme', 'sienna', 'matilda', 'ivy', 'hannah', 'sarah', 'emma', 'fatima', 'priya', 'anya', 'margaret', 'mary', 'elizabeth', 'susan', 'patricia', 'nadia', 'layla', 'chloe', 'rosie', 'ada']);
const MALE_NAMES = new Set(['arthur', 'daniel', 'samuel', 'idris', 'thomas', 'oliver', 'george', 'noah', 'harry', 'jack', 'leo', 'charlie', 'jacob', 'oscar', 'alfie', 'henry', 'freddie', 'archie', 'theo', 'william', 'james', 'muhammad', 'mohammed', 'ethan', 'joshua', 'max', 'isaac', 'david', 'john', 'michael', 'robert', 'peter', 'paul', 'omar', 'ahmed', 'ali', 'ravi', 'raj', 'arjun', 'edward', 'albert', 'frank', 'ronald', 'kenneth', 'liam', 'hugo', 'felix']);
function resolveSex(patient, overrides) {
  const override = overrides[patient.id];
  if (override) return override;
  const gender = patient.demographics?.gender;
  if (gender === 'female' || gender === 'male') return gender;
  const first = (patient.name || '').split(/\s+/)[0].toLowerCase();
  if (FEMALE_NAMES.has(first)) return 'female';
  if (MALE_NAMES.has(first)) return 'male';
  throw new Error(`Cannot determine sex for ${patient.id} (${patient.name}): no FHIR gender and name not recognised. Pass --sex ${patient.id}=female|male.`);
}

// ---------------------------------------------------------------------------
// Command line.
function usage() {
  console.log(`Usage: node enrich/enrich.mjs [--patients SIM-000001,...] [--dry-run] [--verify] [--api URL] [--sex SIM-000001=female,...] [--no-tests]

  --patients   Comma-separated patient ids (default: the eight demo candidates).
  --dry-run    Print the plan; write nothing and book nothing.
  --verify     Check the enriched state instead of writing (exit 1 on failure).
  --api URL    Local action/read API bound to the same database (default http://localhost:4192, or SIM_API_URL).
  --sex        Override sex used by CKD-EPI when the record has no gender and the first name is unknown.
  --no-tests   Skip "npm test" during --verify.`);
}
function parseArgs(argv) {
  const options = { patients: COHORT, dryRun: false, verify: false, api: process.env.SIM_API_URL || 'http://localhost:4192', sex: {}, tests: true };
  const args = argv.flatMap(arg => (arg.startsWith('--') && arg.includes('=') && !arg.startsWith('--sex=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg]));
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = () => { if (i + 1 >= args.length) throw new Error(`${arg} needs a value`); return args[++i]; };
    if (arg === '--patients') options.patients = next().split(',').map(s => s.trim()).filter(Boolean);
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--verify') options.verify = true;
    else if (arg === '--api') options.api = next().replace(/\/+$/, '');
    else if (arg === '--sex' || arg.startsWith('--sex=')) for (const pair of (arg === '--sex' ? next() : arg.slice(6)).split(',')) { const [id, sex] = pair.split('='); if (!['female', 'male'].includes((sex || '').trim().toLowerCase())) throw new Error(`--sex expects SIM-xxxxxx=female|male, got "${pair}"`); options.sex[id.trim()] = sex.trim().toLowerCase(); }
    else if (arg === '--no-tests') options.tests = false;
    else if (arg === '--help' || arg === '-h') { usage(); process.exit(0); }
    else throw new Error(`Unknown argument ${arg}`);
  }
  if (!options.patients.length) throw new Error('No patients given.');
  return options;
}

// ---------------------------------------------------------------------------
// Database access, mirroring sim-app/store.mjs.
function openPool() {
  const connectionString = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
  const database = connectionString ? decodeURIComponent(new URL(connectionString).pathname.slice(1)) : process.env.APP_DATABASE || 'anima_sim_app_20260912';
  if (database === 'anima_sim_replica_20260912') throw new Error('Use a separate app database, not the archival replica.');
  const config = connectionString
    ? { connectionString, ssl: { rejectUnauthorized: true } } // an sslmode in the URL takes precedence (pg parses it)
    : { database, host: process.env.PGHOST || '/tmp' };
  const pool = new pg.Pool({ ...config, max: 4, connectionTimeoutMillis: 30000, idleTimeoutMillis: 10000 });
  return { pool, database, source: connectionString ? (process.env.DIRECT_DATABASE_URL ? 'DIRECT_DATABASE_URL' : 'DATABASE_URL') : 'local socket' };
}

async function loadClock(pool, worldId) {
  // sim.local_clock only exists once the app has started against this database; fall back to the world clock.
  const local = await pool.query('SELECT sim_time, paused FROM sim.local_clock WHERE world_id=$1', [worldId]).catch(() => ({ rows: [] }));
  if (local.rows[0]) return { now: Number(local.rows[0].sim_time), paused: local.rows[0].paused, source: 'sim.local_clock' };
  const world = (await pool.query("SELECT (COALESCE(clock_end,clock_start)->>'now')::double precision AS now FROM sim.worlds WHERE world_id=$1", [worldId])).rows[0];
  return { now: Number(world.now), paused: true, source: 'sim.worlds' };
}

async function loadPatients(pool, worldId, ids, sexOverrides, now) {
  const rows = (await pool.query('SELECT patient_id, directory, demographics FROM sim.patients WHERE world_id=$1 AND patient_id=ANY($2::text[])', [worldId, ids])).rows;
  return ids.map(id => {
    const row = rows.find(r => r.patient_id === id);
    if (!row?.directory) throw new Error(`Patient ${id} not found in sim.patients.`);
    const patient = { id, name: row.directory.name, birthDate: row.directory.birthDate || row.demographics?.birthDate, conditions: row.directory.conditions || [], needs: row.directory.needs || [], demographics: row.demographics };
    if (!patient.birthDate) throw new Error(`Patient ${id} has no birth date.`);
    patient.ageNow = ageAt(patient.birthDate, now);
    patient.sex = resolveSex(patient, sexOverrides);
    return patient;
  });
}

async function getResource(db, worldId, id) {
  const result = await db.query('SELECT body FROM sim.resources WHERE world_id=$1 AND resource_id=$2', [worldId, id]);
  return result.rows[0]?.body || null;
}
async function listPatientResources(db, worldId, patientId, kind, site) {
  const params = [worldId, patientId, kind];
  let sql = 'SELECT body FROM sim.resource_projections WHERE world_id=$1 AND patient_id=$2 AND kind=$3';
  if (site) { params.push(site); sql += ` AND site=$${params.length}`; }
  return (await db.query(sql, params)).rows.map(r => r.body);
}

/** Exactly store.mjs save(): delete every projection of the resource, then insert one row per visible site. */
async function save(db, worldId, resource) {
  await db.query('DELETE FROM sim.resource_projections WHERE world_id=$1 AND resource_id=$2', [worldId, resource.id]);
  for (const site of SITES.filter(site => resource.visibleTo.includes(site) || resource.owner === site)) {
    await db.query('INSERT INTO sim.resource_projections(world_id,site,resource_id,patient_id,kind,status,owner,version,body,captured_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now())', [worldId, site, resource.id, resource.patientId || null, resource.kind, resource.status, resource.owner, resource.version, resource]);
  }
}
/** Exactly store.mjs makeContext().event. */
async function event(db, worldId, resource, now) {
  const body = { id: randomUUID(), time: now, type: ACTION, actor: ACTOR.name, resourceId: resource.id, patientId: resource.patientId, detail: `${ACTION}: ${resource.title}`, visibleTo: resource.visibleTo };
  await db.query('INSERT INTO sim.events(world_id,event_id,body) VALUES($1,$2,$3)', [worldId, body.id, body]);
}

const COMPARED = ['kind', 'title', 'status', 'owner', 'visibleTo', 'priority', 'patientId', 'dueAt', 'data'];
const pick = (object, keys) => Object.fromEntries(keys.filter(k => object[k] !== undefined).map(k => [k, object[k]]));

/**
 * Create the resource if it does not exist, update it (version + 1, provenance change appended)
 * only when its compared content differs, otherwise leave it untouched.
 */
async function upsert(db, ctx, target, stats) {
  const existing = await getResource(db, ctx.worldId, target.id);
  if (existing) {
    if (canonical(pick(existing, COMPARED)) === canonical(pick(target, COMPARED))) { stats.unchanged += 1; return existing; }
    const version = existing.version + 1;
    const updated = { ...existing, ...pick(target, COMPARED), id: existing.id, version, provenance: { ...existing.provenance, created: existing.provenance?.created || null, changes: [...(existing.provenance?.changes || []), { time: ctx.now, actor: ACTOR, source: target.owner, action: ACTION, version }] } };
    if (!ctx.dryRun) { await save(db, ctx.worldId, updated); await event(db, ctx.worldId, updated, ctx.now); }
    stats.updated += 1; return updated;
  }
  const created = { id: target.id, kind: target.kind, title: target.title, status: target.status, owner: target.owner, visibleTo: target.visibleTo, priority: target.priority || 'routine', createdAt: target.createdAt ?? ctx.now, data: target.data, version: 1, ...(target.patientId ? { patientId: target.patientId } : {}), ...(target.dueAt !== undefined ? { dueAt: target.dueAt } : {}) };
  created.provenance = { created: { time: ctx.now, actor: ACTOR, source: target.owner, action: ACTION, version: 1 }, changes: [] };
  if (!ctx.dryRun) { await save(db, ctx.worldId, created); await event(db, ctx.worldId, created, ctx.now); }
  stats.created += 1; return created;
}

// ---------------------------------------------------------------------------
// 1. Blood histories.
async function collectionDates(db, worldId, patientId) {
  for (const id of [patientId, REFERENCE_PATIENT]) {
    const rows = await db.query("SELECT DISTINCT (body#>>'{data,collectedAt}')::numeric AS at FROM sim.resource_projections WHERE world_id=$1 AND site='gp' AND kind='report' AND patient_id=$2 AND resource_id LIKE 'blood-v1-%' ORDER BY at", [worldId, id]);
    if (rows.rows.length === 6) return rows.rows.map(r => Number(r.at));
  }
  return FALLBACK_DATES;
}

function bloodValues(patient, story, dates) {
  const ratio = i => (Array.isArray(story.ureaRatio) ? story.ureaRatio[i] : story.ureaRatio);
  for (const [id, values] of Object.entries(story.series)) if (!Array.isArray(values) || values.length !== 6) throw new Error(`${patient.id}: series ${id} must have six values`);
  if (story.egfr.length !== 6) throw new Error(`${patient.id}: egfr must have six values`);
  return dates.map((at, i) => {
    const age = ageAt(patient.birthDate, at);
    const creatinine = creatinineFor(story.egfr[i], age, patient.sex);
    const values = { creatinine, egfr: Math.round(ckdEpi2021(creatinine, age, patient.sex)), urea: round(creatinine * ratio(i), 1) };
    for (const [id, series] of Object.entries(story.series)) values[id] = series[i];
    for (const panel of Object.values(PANELS)) for (const [id, , , , , dp] of panel.analytes) { if (values[id] === undefined) throw new Error(`${patient.id}: no value for ${id}`); values[id] = round(values[id], dp); }
    return values;
  });
}

async function enrichReports(db, ctx, patient, story, stats) {
  const dates = await collectionDates(db, ctx.worldId, patient.id);
  const values = bloodValues(patient, story, dates);
  for (const panelId of PANEL_IDS) {
    const panel = PANELS[panelId];
    for (let i = 0; i < 6; i++) {
      const id = `blood-v1-${patient.id}-${panelId}-${i}`;
      const existing = await getResource(db, ctx.worldId, id);
      const analytes = panel.analytes.map(([aid, name, unit, referenceLow, referenceHigh]) => ({ id: aid, name, unit, value: values[i][aid], referenceLow, referenceHigh }));
      await upsert(db, ctx, {
        id, kind: 'report', title: `${panel.name} · synthetic blood results`, status: 'available', owner: 'diagnostics', visibleTo: REPORT_VISIBLE_TO, priority: 'routine', patientId: patient.id,
        createdAt: existing?.createdAt ?? dates[i] + HOUR,
        data: { kind: 'blood-result', panel: { id: panelId, name: panel.name }, analytes, synthetic: true, laboratory: LABORATORY, collectedAt: dates[i], enrichment: { version: ENRICHMENT_VERSION, story: story.summary } },
      }, stats);
    }
  }
  return values;
}

// ---------------------------------------------------------------------------
// 2. Medicines and problems.
const genericName = term => String(term || '').trim().split(/\s+/)[0].toLowerCase();

function planMedicines(patient, latestEgfr, existingMedicines) {
  const current = existingMedicines.filter(m => m.isCurrent !== false);
  const present = new Set(current.map(m => genericName(m.term)));
  const raas = latestEgfr < 30 ? 'losartan' : 'ramipril';
  const additions = [];
  for (const condition of patient.conditions) {
    for (const [pattern, keys] of CONDITION_MEDICINES) {
      if (!pattern.test(condition)) continue;
      for (let key of keys) {
        if (key === 'raas') key = raas;
        if (key === 'metformin' && latestEgfr < 30) continue;
        if (present.has(key) || current.length + additions.length >= MAX_MEDICINES) continue;
        present.add(key);
        const medicine = MEDICINES[key];
        const h = hash(`${patient.id}:${key}`);
        additions.push({
          note: medicine.note, term: medicine.term, route: medicine.route, isCurrent: true,
          issueDate: isoDate(patient.dayStart - (3 + (h % 85)) * DAY), synthetic: true, indication: condition,
          reviewDate: isoDate(patient.dayStart + (25 + ((h >>> 8) % 150)) * DAY), supplyStatus: 'dispensed', prescriptionType: 'repeat',
        });
      }
    }
  }
  return additions;
}

function planProblems(patient, existingProblems) {
  const additions = [];
  let n = existingProblems.filter(p => /^SIM-KINDRED-\d+$/.test(p.code || '')).length;
  for (const condition of patient.conditions) {
    if (existingProblems.some(p => p.status === 'active' && String(p.term).toLowerCase() === condition.toLowerCase())) continue;
    const h = hash(`${patient.id}:problem:${condition}`);
    const years = 2 + (h % 6), extraDays = (h >>> 8) % 300;
    additions.push({ code: `SIM-KINDRED-${++n}`, date: isoDate(patient.dayStart - Math.round(years * 365.25 + extraDays) * DAY), term: condition, status: 'active' });
  }
  return additions;
}

async function enrichRecord(db, ctx, patient, latestEgfr, stats) {
  const records = await listPatientResources(db, ctx.worldId, patient.id, 'ehr-record', 'gp');
  if (!records.length) { stats.note = 'no ehr-record'; return { medicines: [], problems: [] }; }
  const record = records.sort((a, b) => b.version - a.version)[0];
  const medicines = planMedicines(patient, latestEgfr, record.data.medications || []);
  const problems = planProblems(patient, record.data.problems || []);
  const data = { ...record.data, medications: [...(record.data.medications || []), ...medicines], problems: [...(record.data.problems || []), ...problems], enrichment: { version: ENRICHMENT_VERSION, story: `Repeat medicines and active problems aligned with the coded conditions (${patient.conditions.join(', ') || 'none'}).` } };
  await upsert(db, ctx, { ...pick(record, [...COMPARED, 'createdAt']), id: record.id, data }, stats);
  return { medicines, problems, record };
}

// ---------------------------------------------------------------------------
// 4. Home monitoring (device + daily observations), same JSON as the sim's wearables history.
const METRICS = { steps: { title: 'Daily activity', unit: 'steps/day' }, 'heart-rate': { title: 'Resting heart rate', unit: 'bpm' }, sleep: { title: 'Sleep duration', unit: 'h' } };

async function enrichMonitoring(db, ctx, patient, monitoring, stats) {
  const anchor = patient.dayStart + 8 * HOUR, dueAt = anchor + DAY;
  const base = { owner: 'wearables', visibleTo: WEARABLE_VISIBLE_TO, priority: 'routine', patientId: patient.id, dueAt };
  const enrichment = { version: ENRICHMENT_VERSION, story: monitoring.summary };
  await upsert(db, ctx, { ...base, id: `${ENRICHMENT_VERSION}-${patient.id}-watch`, kind: 'device', title: 'Home activity watch', status: 'active', createdAt: anchor, data: { battery: monitoring.battery, quality: 'good', lastSyncedAt: anchor, enrichment } }, stats);
  const days = monitoring.steps.length;
  for (const [metric, { title, unit }] of Object.entries(METRICS)) {
    const series = monitoring[metric];
    if (!Array.isArray(series) || series.length !== days) throw new Error(`${patient.id}: monitoring ${metric} must have ${days} values`);
    for (let i = 0; i < days; i++) {
      const observedAt = patient.dayStart - (days - i) * DAY;
      await upsert(db, ctx, { ...base, id: `${ENRICHMENT_VERSION}-${patient.id}-${metric}-${days - i}`, kind: 'observation', title, status: 'available', createdAt: observedAt, data: { unit, value: series[i], metric, quality: 'good', observedAt, enrichment } }, stats);
    }
  }
  await upsert(db, ctx, { ...base, id: `${ENRICHMENT_VERSION}-${patient.id}-steps-trend`, kind: 'observation', title: 'Activity trend below personal baseline', status: 'available', createdAt: anchor, data: { unit: 'steps/day', value: monitoring.steps.at(-1), metric: 'steps', quality: 'good', baseline: monitoring.baseline, observedAt: anchor, enrichment } }, stats);
}

// ---------------------------------------------------------------------------
// 3. Appointments through the local action API.
async function api(ctx, path, init) {
  let response;
  try { response = await fetch(`${ctx.api}${path}`, init); } catch (error) { throw new Error(`Local API ${ctx.api} unreachable (${error.cause?.code || error.message}). Start sim-app against this database or pass --api.`); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(body.error || `HTTP ${response.status}`); error.status = response.status; throw error; }
  return body;
}
const actionHeaders = () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer local-demo', 'Idempotency-Key': randomUUID() });
const overlaps = (start, end, otherStart, otherEnd) => start < otherEnd && end > otherStart;

function freeSlot(session, appointments, patientId, now) {
  const { startsAt, endsAt, slotMinutes, clinician, blockedSlots = [] } = session.data;
  const duration = slotMinutes * MINUTE, slots = [];
  for (let t = startsAt; t + duration <= endsAt; t += duration) slots.push(t);
  if (!slots.length) return null;
  const offset = hash(patientId) % slots.length;
  for (let k = 0; k < slots.length; k++) {
    const t = slots[(offset + k) % slots.length];
    if (t <= now || blockedSlots.some(slot => slot.startsAt === t)) continue;
    const busy = appointments.some(a => !['cancelled', 'rejected'].includes(a.status) && (a.data.clinician === clinician || a.patientId === patientId) && overlaps(t, t + duration, Number(a.data.startsAt), Number(a.data.startsAt) + Number(a.data.durationMinutes) * MINUTE));
    if (!busy) return t;
  }
  return null;
}

async function bookAppointment(db, ctx, patient, plan) {
  const existing = await listPatientResources(db, ctx.worldId, patient.id, 'appointment', 'gp');
  const match = existing.find(a => a.title === plan.title && ['booked', 'arrived'].includes(a.status) && Number(a.data?.startsAt) >= patient.dayStart);
  if (match) return { status: 'exists', appointment: match };
  const offsets = [3, 4, 5, 6, 7, 2, 1];
  const dates = offsets.map((_, k) => offsets[(k + plan.day) % offsets.length]).map(offset => isoDate(patient.dayStart + offset * DAY));
  for (let attempt = 0; attempt < 4; attempt++) {
    let chosen = null;
    for (const date of dates) {
      const day = await api(ctx, `/api/sites/gp/appointments?date=${date}`);
      for (const session of day.sessions.filter(s => s.status === 'open' && s.data.clinician === plan.clinician && s.data.mode === plan.mode)) {
        const startsAt = freeSlot(session, day.appointments, patient.id, ctx.now);
        if (startsAt) { chosen = { session, startsAt }; break; }
      }
      if (chosen) break;
    }
    if (!chosen) {
      const start = dayStartOf(patient.dayStart + offsets[plan.day % offsets.length] * DAY) + 8 * HOUR;
      const request = { type: 'create_appointment_session', title: `${plan.mode === 'telephone' ? 'Telephone surgery' : 'Main surgery'} · Kindred demo`, clinician: plan.clinician, location: plan.mode === 'telephone' ? 'Telephone hub' : 'Room 1', startsAt: start, endsAt: start + 4 * HOUR, slotMinutes: 15, mode: plan.mode };
      if (ctx.dryRun) return { status: 'would-create-session', plan, request };
      const session = await api(ctx, '/api/sites/gp/actions', { method: 'POST', headers: actionHeaders(), body: JSON.stringify(request) });
      chosen = { session, startsAt: freeSlot(session, [], patient.id, ctx.now) };
    }
    if (ctx.dryRun) return { status: 'would-book', plan, sessionId: chosen.session.id, startsAt: chosen.startsAt };
    try {
      const appointment = await api(ctx, '/api/sites/gp/actions', { method: 'POST', headers: actionHeaders(), body: JSON.stringify({ type: 'book_appointment', patientId: patient.id, sessionId: chosen.session.id, sessionVersion: chosen.session.version, startsAt: chosen.startsAt, title: plan.title }) });
      const stored = await getResource(db, ctx.worldId, appointment.id);
      if (!stored) throw new Error(`Appointment ${appointment.id} was booked by ${ctx.api} but is not in this database: the API is bound to a different database.`);
      return { status: 'booked', appointment };
    } catch (error) { if (error.status !== 409 || attempt === 3) throw error; }
  }
  throw new Error('Could not book after repeated slot conflicts.');
}

// ---------------------------------------------------------------------------
// Verification.
async function verify(pool, ctx, patients, options) {
  const checks = [];
  const check = (ok, text) => { checks.push(ok); console.log(`  [${ok ? 'ok' : 'FAIL'}] ${text}`); return ok; };
  for (const patient of patients) {
    console.log(`${patient.id} ${patient.name} (${patient.ageNow}, ${patient.sex}; ${patient.conditions.join(', ') || 'no coded conditions'})`);
    const reports = (await listPatientResources(pool, ctx.worldId, patient.id, 'report', 'gp')).filter(r => r.id.startsWith(`blood-v1-${patient.id}-`));
    const dates = new Set(reports.map(r => r.data.collectedAt));
    check(reports.length === 36 && dates.size === 6, `${reports.length} blood reports on the gp site, ${dates.size} distinct collection dates`);
    const ue = reports.filter(r => r.data.panel?.id === 'ue');
    let worst = 0, okCount = 0;
    for (const report of ue) {
      const value = id => report.data.analytes.find(a => a.id === id)?.value;
      const expected = ckdEpi2021(value('creatinine'), ageAt(patient.birthDate, report.data.collectedAt), patient.sex);
      const delta = Math.abs(value('egfr') - expected);
      worst = Math.max(worst, delta); if (delta <= 2) okCount += 1;
    }
    check(ue.length === 6 && okCount === 6, `eGFR within ±2 of CKD-EPI 2021 on ${okCount}/${ue.length} U&E reports (max Δ ${worst.toFixed(2)})`);
    const enriched = reports.filter(r => r.data.enrichment?.version === ENRICHMENT_VERSION).length;
    check(enriched === 36, `${enriched}/36 reports carry enrichment ${ENRICHMENT_VERSION}`);
    const record = (await listPatientResources(pool, ctx.worldId, patient.id, 'ehr-record', 'gp')).sort((a, b) => b.version - a.version)[0];
    const medicines = (record?.data.medications || []).filter(m => m.isCurrent !== false);
    check(medicines.length >= 2 && medicines.length <= MAX_MEDICINES, `${medicines.length} current medicines: ${medicines.map(m => m.term).join('; ') || 'none'}`);
    const problems = record?.data.problems || [];
    const missing = patient.conditions.filter(c => !problems.some(p => p.status === 'active' && String(p.term).toLowerCase() === c.toLowerCase()));
    check(missing.length === 0, missing.length ? `active problems missing for ${missing.join(', ')}` : 'every coded condition has an active problem');
    const future = (await listPatientResources(pool, ctx.worldId, patient.id, 'appointment', 'gp')).filter(a => ['booked', 'arrived'].includes(a.status) && Number(a.data?.startsAt) > ctx.now).sort((a, b) => a.data.startsAt - b.data.startsAt);
    check(future.length > 0, future.length ? `future appointment: ${future.map(a => `${a.title} · ${new Date(a.data.startsAt).toISOString().replace('.000Z', 'Z')} · ${a.data.clinician} (${a.data.mode})`).join(' | ')}` : 'no future appointment');
    let apiCount = null, apiError = null;
    try {
      let offset = 0, total = Infinity; apiCount = 0;
      while (offset < total) { const page = await api(ctx, `/api/sites/gp/view?patient=${patient.id}&limit=500&offset=${offset}`); total = page.resourceTotal; apiCount += page.resources.filter(r => r.kind === 'report' && r.id.startsWith('blood-v1-')).length; offset += page.resourceLimit; if (!page.resources.length) break; }
    } catch (error) { apiError = error.message; }
    check(apiCount === 36, apiError ? `local API check failed: ${apiError}` : `local API ${ctx.api} returns ${apiCount} blood reports`);
    const story = STORIES[patient.id];
    if (story?.monitoring) {
      const devices = (await listPatientResources(pool, ctx.worldId, patient.id, 'device', 'wearables')).filter(d => d.id.startsWith(`${ENRICHMENT_VERSION}-`));
      const observations = (await listPatientResources(pool, ctx.worldId, patient.id, 'observation', 'wearables')).filter(o => o.id.startsWith(`${ENRICHMENT_VERSION}-`));
      const expected = story.monitoring.steps.length * 3 + 1;
      check(devices.length === 1 && observations.length === expected, `home monitoring: ${devices.length} device, ${observations.length}/${expected} observations on the wearables site`);
    }
  }
  const duplicates = (await pool.query('SELECT site, resource_id FROM sim.resource_projections WHERE world_id=$1 GROUP BY site, resource_id HAVING count(*) > 1', [ctx.worldId])).rows;
  console.log('World');
  check(duplicates.length === 0, duplicates.length ? `${duplicates.length} duplicate (site, resource_id) rows` : 'no duplicate (site, resource_id) rows');
  if (options.tests) {
    const result = spawnSync('npm', ['test', '--prefix', SIM_APP_DIR], { encoding: 'utf8' });
    const count = label => Number((result.stdout.match(new RegExp(`ℹ ${label} (\\d+)`)) || [])[1] ?? NaN);
    check(result.status === 0 && count('fail') === 0, `npm test --prefix sim-app: ${count('pass')} passed, ${count('fail')} failed (exit ${result.status})`);
  }
  const failed = checks.filter(ok => !ok).length;
  console.log(`RESULT: ${failed ? 'FAIL' : 'PASS'} (${checks.length - failed}/${checks.length} checks passed)`);
  return failed === 0;
}

// ---------------------------------------------------------------------------
async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { pool, database, source } = openPool();
  try {
    const worldId = (await pool.query('SELECT world_id FROM sim.worlds ORDER BY started_at DESC LIMIT 1')).rows[0]?.world_id;
    if (!worldId) throw new Error('No world in sim.worlds.');
    const clock = await loadClock(pool, worldId);
    const ctx = { worldId, now: clock.now, dryRun: options.dryRun, api: options.api };
    const mode = options.verify ? 'VERIFY' : options.dryRun ? 'DRY RUN' : 'ENRICH';
    console.log(`${mode} database=${database} (${source}) world=${worldId} sim_now=${new Date(clock.now).toISOString()} (${clock.source}${clock.paused ? ', paused' : ''}) api=${options.api}`);
    const patients = await loadPatients(pool, worldId, options.patients, options.sex, clock.now);
    for (const patient of patients) patient.dayStart = dayStartOf(clock.now);
    if (options.verify) { const ok = await verify(pool, ctx, patients, options); process.exitCode = ok ? 0 : 1; return; }

    const totals = { reports: { created: 0, updated: 0, unchanged: 0 }, records: { created: 0, updated: 0, unchanged: 0 }, monitoring: { created: 0, updated: 0, unchanged: 0 }, appointments: { booked: 0, exists: 0, planned: 0 } };
    for (const patient of patients) {
      const story = STORIES[patient.id] || genericStory(patient);
      const stats = { reports: { created: 0, updated: 0, unchanged: 0 }, records: { created: 0, updated: 0, unchanged: 0 }, monitoring: { created: 0, updated: 0, unchanged: 0 } };
      const db = await pool.connect();
      let values, record;
      try {
        if (!ctx.dryRun) { await db.query('BEGIN'); await db.query('SELECT world_id FROM sim.worlds WHERE world_id=$1 FOR UPDATE', [worldId]); }
        values = await enrichReports(db, ctx, patient, story, stats.reports);
        record = await enrichRecord(db, ctx, patient, values[5].egfr, stats.records);
        if (story.monitoring) await enrichMonitoring(db, ctx, patient, story.monitoring, stats.monitoring);
        if (!ctx.dryRun) await db.query('COMMIT');
      } catch (error) { if (!ctx.dryRun) await db.query('ROLLBACK').catch(() => {}); throw error; } finally { db.release(); }

      const booking = await bookAppointment(pool, ctx, patient, story.appointment);
      const fmt = s => `created ${s.created}, updated ${s.updated}, unchanged ${s.unchanged}`;
      const egfr = values.map(v => v.egfr).join('→'), creatinine = values.map(v => v.creatinine).join('→');
      const bookingText = booking.status === 'exists' ? `appointment already booked: ${booking.appointment.title} at ${new Date(booking.appointment.data.startsAt).toISOString()}`
        : booking.status === 'booked' ? `booked "${booking.appointment.title}" ${new Date(booking.appointment.data.startsAt).toISOString()} with ${booking.appointment.data.clinician} (${booking.appointment.data.mode}, ${booking.appointment.id})`
        : booking.status === 'would-book' ? `would book "${booking.plan.title}" ${new Date(booking.startsAt).toISOString()} in ${booking.sessionId}`
        : `would create a session for ${booking.plan.clinician} and book "${booking.plan.title}"`;
      console.log(`${patient.id} ${patient.name} (${patient.ageNow}, ${patient.sex}; ${patient.conditions.join(', ') || 'no coded conditions'})`);
      console.log(`  reports: ${fmt(stats.reports)}; eGFR ${egfr}; creatinine ${creatinine}`);
      console.log(`  ehr-record: ${record.record ? fmt(stats.records) : 'none found'}; +${record.medicines.length} medicines (${record.medicines.map(m => m.term).join('; ') || 'none'}); +${record.problems.length} problems (${record.problems.map(p => p.term).join('; ') || 'none'})`);
      if (story.monitoring) console.log(`  home monitoring: ${fmt(stats.monitoring)}`);
      console.log(`  ${bookingText}`);
      for (const key of ['reports', 'records', 'monitoring']) for (const k of Object.keys(totals[key])) totals[key][k] += stats[key][k];
      totals.appointments[booking.status === 'booked' ? 'booked' : booking.status === 'exists' ? 'exists' : 'planned'] += 1;
    }
    const fmt = s => Object.entries(s).map(([k, v]) => `${k} ${v}`).join(', ');
    console.log(`TOTAL reports: ${fmt(totals.reports)} | ehr-records: ${fmt(totals.records)} | monitoring: ${fmt(totals.monitoring)} | appointments: ${fmt(totals.appointments)}${ctx.dryRun ? ' (dry run: nothing written)' : ''}`);
  } finally { await pool.end(); }
}

main().catch(error => { console.error(`enrich: ${error.message}`); process.exitCode = 1; });
