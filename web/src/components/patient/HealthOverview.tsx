"use client";

import { useState } from "react";
import type { AppState, LabResult } from "@/lib/types";
import type { ReadingLevel } from "@/lib/reading-level";

// Plain-English health overview. One tile per body system, a simple status and
// a percentage of measurements inside their usual range. Tap a tile to see how
// the percentage was reached, measurement by measurement. No diagnoses: the
// wording only says whether a number is inside or outside its usual range and
// which way it moved since last time.

const SYSTEMS: Record<string, { label: string; plain: string }> = {
  "Full blood count (FBC)": { label: "Blood and immune system", plain: "The cells in your blood: the ones that carry oxygen, fight infection and help clotting." },
  "HbA1c": { label: "Blood sugar", plain: "Your average blood sugar over the last two to three months." },
  "Liver function tests (LFT)": { label: "Liver", plain: "How well your liver is working." },
  "Urea & electrolytes (U&E)": { label: "Kidneys and salts", plain: "How well your kidneys are filtering, and the balance of salts in your blood." },
  "C-reactive protein (CRP)": { label: "Inflammation", plain: "A sign of inflammation or infection somewhere in the body." },
  "Lipid profile": { label: "Cholesterol", plain: "The fats in your blood that affect heart health." },
};

const PLAIN: Record<string, string> = {
  "White cell count": "infection-fighting cells",
  "Neutrophils": "the main infection-fighting cells",
  "Haemoglobin": "oxygen-carrying cells",
  "Platelets": "clotting cells",
  "Mean cell volume": "size of your red blood cells",
  "HbA1c": "average blood sugar",
  "Bilirubin": "a waste product the liver clears",
  "Albumin": "a protein the liver makes",
  "ALT": "a liver enzyme",
  "Alkaline phosphatase": "a liver and bone enzyme",
  "Sodium": "salt balance",
  "Potassium": "a salt your heart and muscles need",
  "Urea": "a waste product the kidneys clear",
  "Creatinine": "a waste product the kidneys clear",
  "eGFR": "how fast your kidneys filter",
  "C-reactive protein": "inflammation marker",
  "Total cholesterol": "total blood fats",
  "HDL cholesterol": "the helpful kind of cholesterol",
  "Triglycerides": "fats from food stored in the blood",
};

type Tone = "moss" | "amber" | "rust";
const TONE: Record<Tone, string> = { moss: "border-moss/30 bg-moss-soft", amber: "border-amber/40 bg-amber-soft", rust: "border-rust/40 bg-[#FBE9E2]" };
const DOT: Record<Tone, string> = { moss: "bg-moss", amber: "bg-amber", rust: "bg-rust" };
const WORD: Record<Tone, string> = { moss: "All good", amber: "Worth watching", rust: "Talk to your practice" };

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });

// Did the value move towards or away from its usual range since last time?
export function direction(l: LabResult): "better" | "worse" | "same" | null {
  if (!l.previous || l.refLow == null || l.refHigh == null) return null;
  const mid = (l.refLow + l.refHigh) / 2;
  const now = Math.abs(l.value - mid), before = Math.abs(l.previous.value - mid);
  if (Math.abs(now - before) < 1e-9) return "same";
  return now < before ? "better" : "worse";
}

interface SystemTile {
  panel: string;
  label: string;
  plain: string;
  items: LabResult[];
  inRange: number;
  pct: number;
  tone: Tone;
  summary: string;
  date: string;
}

function buildTiles(labs: LabResult[]): SystemTile[] {
  const byPanel = new Map<string, LabResult[]>();
  for (const l of labs) byPanel.set(l.panel, [...(byPanel.get(l.panel) ?? []), l]);
  return [...byPanel.entries()].map(([panel, items]) => {
    const meta = SYSTEMS[panel] ?? { label: panel.replace(/\s*\(.*\)\s*$/, ""), plain: "" };
    const out = items.filter((l) => l.flag !== "normal");
    const inRange = items.length - out.length;
    const pct = Math.round((inRange / items.length) * 100);
    const worsening = out.filter((l) => direction(l) === "worse");
    const tone: Tone = out.length === 0 ? "moss" : worsening.length ? "rust" : "amber";
    const first = out[0];
    const summary =
      out.length === 0
        ? "Everything measured here is inside its usual range."
        : `${first.name}${PLAIN[first.name] ? ` (${PLAIN[first.name]})` : ""} is ${first.flag === "high" ? "higher" : "lower"} than usual${
            direction(first) === "better" ? " but moving the right way" : direction(first) === "worse" ? " and moving further away" : ""
          }${out.length > 1 ? `, and ${out.length - 1} other measurement${out.length > 2 ? "s are" : " is"} outside range too` : ""}.`;
    const date = items.reduce((d, l) => (l.date > d ? l.date : d), items[0].date);
    return { panel, label: meta.label, plain: meta.plain, items, inRange, pct, tone, summary, date };
  });
}

function Spark({ l }: { l: LabResult }) {
  const values = [...l.history].sort((a, b) => a.date.localeCompare(b.date)).map((h) => h.value);
  if (values.length < 2) return null;
  const W = 140, H = 34;
  const band = l.refLow != null && l.refHigh != null ? [l.refLow, l.refHigh] : [];
  const all = [...values, ...band];
  const lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * 0.15 || 1;
  const y = (v: number) => H - 3 - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * (H - 6);
  const x = (i: number) => 3 + (i / (values.length - 1)) * (W - 6);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-8 w-[140px] shrink-0 text-ink" aria-hidden="true">
      {band.length === 2 && <rect x="3" y={y(band[1])} width={W - 6} height={Math.max(1, y(band[0]) - y(band[1]))} fill="#2F6B4F" opacity="0.12" />}
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.7" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="2.6" fill={l.flag === "normal" ? "#2F6B4F" : "#C2572F"} />
    </svg>
  );
}

export default function HealthOverview({ state, onAsk, level = "standard" }: { state: AppState; onAsk: () => void; level?: ReadingLevel }) {
  const [open, setOpen] = useState<string | null>(null);
  const tiles = buildTiles(state.labs);
  const outOfRange = state.labs.filter((l) => l.flag !== "normal").length;
  const active = open ? tiles.find((t) => t.panel === open) : null;

  return (
    <div className="md:col-span-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <div className="font-display text-lg font-bold">Your body</div>
        {level !== "simple" && <span className="text-sm text-muted">{outOfRange ? `${outOfRange} of ${state.labs.length} measurements outside the usual range` : "All measurements in range"}</span>}
      </div>
      <p className="mt-0.5 text-[15px] text-muted">{level === "simple" ? "From your blood tests. Tap a box to see more." : "From your blood tests. Tap a box to see what is behind it."}</p>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4">
        {tiles.map((t) => {
          const isOpen = open === t.panel;
          return (
            <button
              key={t.panel}
              onClick={() => setOpen(isOpen ? null : t.panel)}
              aria-expanded={isOpen}
              className={`flex aspect-square flex-col rounded-2xl border p-3 text-left transition hover:brightness-[0.98] sm:aspect-auto sm:min-h-[9rem] ${TONE[t.tone]} ${isOpen ? "ring-2 ring-plum" : ""}`}
            >
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[t.tone]}`} />
                <span className="truncate">{t.label}</span>
              </div>
              <div className="mt-auto">
                <div className="font-display text-[19px] font-bold leading-tight sm:text-[21px]">{WORD[t.tone]}</div>
                {level === "simple" ? (
                  <div className="mt-1 text-[14px] leading-snug text-muted">{t.items.length - t.inRange === 0 ? "Nothing to worry about" : t.items.length - t.inRange === 1 ? "One thing being watched" : `${t.items.length - t.inRange} things being watched`}</div>
                ) : level === "detailed" ? (
                  <div className="mt-1 text-[12px] leading-snug text-muted">{t.items.filter((l) => l.flag !== "normal").map((l) => `${l.name} ${l.value} ${l.unit} (${l.refRange})`).join(" · ") || `All ${t.items.length} in range`}</div>
                ) : (
                  <div className="mt-1 text-[13px] leading-snug text-muted">{t.items.length - t.inRange === 0 ? `All ${t.items.length} in the usual range` : `${t.items.length - t.inRange} of ${t.items.length} outside the usual range`}</div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {active && (
        <div className="rise mt-3 rounded-2xl border border-plum/30 bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-display text-lg font-bold leading-tight">{active.label}</div>
              {active.plain && <p className="mt-0.5 text-[15px] text-muted">{active.plain}</p>}
            </div>
            <button onClick={() => setOpen(null)} className="rounded-full border border-line px-3 py-1 text-sm text-muted hover:bg-paper" aria-label="Close">Close</button>
          </div>

          <p className="mt-3 text-[16px] leading-snug">{active.summary}</p>

          <ul className="mt-3 divide-y divide-line">
            {active.items.map((l) => {
              const dir = direction(l);
              const ok = l.flag === "normal";
              return (
                <li key={l.id} className="flex items-center gap-3 py-2.5">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${ok ? "bg-moss" : "bg-rust"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold leading-tight">
                      {PLAIN[l.name] ? PLAIN[l.name].charAt(0).toUpperCase() + PLAIN[l.name].slice(1) : l.name}
                      <span className="ml-1.5 text-[13px] font-normal text-muted">{PLAIN[l.name] ? l.name : ""}</span>
                    </div>
                    <div className="text-[13px] text-muted">
                      <span className="font-mono">{l.value} {l.unit}</span> · usual range <span className="font-mono">{l.refRange}</span>
                      {" · "}
                      {ok ? "inside" : l.flag === "high" ? "above" : "below"}
                      {dir === "better" && ", moving the right way since last time"}
                      {dir === "worse" && ", moving the wrong way since last time"}
                      {dir === "same" && ", same as last time"}
                    </div>
                  </div>
                  <Spark l={l} />
                </li>
              );
            })}
          </ul>

          <div className="mt-3 rounded-xl bg-paper p-3 text-[13px] leading-snug text-muted">
            <b className="text-ink">How we worked this out.</b> {active.inRange} of {active.items.length} measurements from your {fmtDay(active.date)} blood test are inside the usual range printed on your laboratory report, which is {active.pct}%. The status word looks at whether anything is outside its range and which way it has moved since your previous test. This is not a diagnosis; your practice reads these results with the rest of your record.
          </div>
          <button onClick={onAsk} className="mt-3 w-full rounded-full bg-plum px-4 py-2.5 text-[15px] font-semibold text-white hover:brightness-95">Ask Kindred what this means for me</button>
        </div>
      )}
    </div>
  );
}
