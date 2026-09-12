// Manifest of licensed 3D assets under public/models (see LICENSES.md there).
// Written by the asset pipeline; optional per-model tuning fields are read here.

import type { SystemId } from "./systems";

export interface ModelEntry {
  id: string;
  file: string; // relative to /models/
  kind: "body" | "organ";
  system?: SystemId | "digestive";
  source?: string;
  author?: string;
  license?: string;
  triangles?: number;
  bbox?: { x: number; y: number; z: number };
  bboxMin?: [number, number, number];
  bboxMax?: [number, number, number];
  center?: [number, number, number];
  units?: string;
  up?: string;
  notes?: string;
  // Optional integrator overrides
  rotation?: [number, number, number]; // degrees, applied after Y-up normalisation
  offset?: [number, number, number]; // metres, added to the system anchor
  scale?: number; // multiplier on the normalised size
  height?: number; // body only: target height in metres (default 1.8)
}

/**
 * The NIH Human Reference Atlas organs share one body-centred frame in metres:
 * origin at the pelvis, feet near y = -0.79, top of head near y = 0.90.
 * Organs with bboxMin/bboxMax are mapped from that frame into the normalised
 * figure (feet at 0, BODY_HEIGHT tall) with a single scale.
 */
export const ORGAN_FRAME = { feetY: -0.79, height: 1.69 };
export const BODY_HEIGHT = 1.8;

export function manifestSystem(entry: ModelEntry): string | undefined {
  return entry.system === "digestive" ? "gut" : entry.system;
}

export async function loadManifest(): Promise<ModelEntry[]> {
  try {
    const res = await fetch("/models/manifest.json", { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    return Array.isArray(data) ? (data as ModelEntry[]) : [];
  } catch {
    return [];
  }
}
