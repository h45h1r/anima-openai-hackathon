"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { AppState } from "@/lib/types";
import { personById } from "@/lib/types";
import { computeSystems, STATE_LABEL, type SystemId, type SystemState, type SystemStatus } from "@/lib/body/systems";
import { LockIcon } from "../ui";

const BodyScene = dynamic(() => import("./BodyScene"), { ssr: false, loading: () => <div className="absolute inset-0 flex items-center justify-center text-xs text-muted">Building the figure…</div> });

const STATE_HEX: Record<SystemState, string> = { out: "#c2572f", watch: "#c98a1e", ok: "#2f6b4f", none: "#9aa8a1", locked: "#6d2e5b" };
const STATE_CLASS: Record<SystemState, string> = { out: "bg-rust", watch: "bg-amber", ok: "bg-moss", none: "bg-line", locked: "bg-plum" };

export default function BodyView({ state, viewerId, onAsk, embedded = false }: { state: AppState; viewerId: string; onAsk: (q: string) => void; embedded?: boolean }) {
  const patient = personById(state, state.patientId);
  const isPatient = viewerId === state.patientId;
  const systems = useMemo(() => computeSystems(state, viewerId), [state, viewerId]);
  const [focus, setFocus] = useState<SystemId | null>(null);
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      const h = (e: MediaQueryListEvent) => setReduced(e.matches);
      mq.addEventListener("change", h);
      return () => mq.removeEventListener("change", h);
    } catch {
      /* ignore */
    }
  }, []);
  const tint = useMemo(() => Object.fromEntries(systems.map((s) => [s.def.id, STATE_HEX[s.state]])) as Partial<Record<SystemId, string>>, [systems]);
  const sel = systems.find((s) => s.def.id === focus) ?? null;
  const latest = state.labs.map((l) => l.date).sort().pop();
  const outCount = systems.filter((s) => s.state === "out").length;
  const watchCount = systems.filter((s) => s.state === "watch").length;
  const poss = isPatient ? "Your" : `${patient.shortName}’s`;

  return (
    <div className="space-y-4">
      {embedded ? (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="font-display text-lg font-bold">{poss} body</div>
          <span className="text-sm text-muted">{outCount ? `${outCount} of ${systems.filter((s) => s.state !== "none" && s.state !== "locked").length} systems have something outside the usual range` : "Everything measured is in its usual range"} · tap a part to see what is behind it</span>
        </div>
      ) : (
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[26px] font-bold leading-tight sm:text-3xl">{poss} body, right now</h1>
          <p className="mt-1 max-w-xl text-[15px] text-muted">Each part of the record mapped onto the body. Tap a system to see what’s behind it. Nothing here is a diagnosis; it is the record, arranged.</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[10.5px] uppercase tracking-wider text-muted sm:grid-cols-3">
          <Meta k="Health data" v={`${state.labs.length} analytes`} />
          <Meta k="Last bloods" v={latest ? new Date(latest).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—"} />
          <Meta k="Problems" v={String(state.conditions.length)} />
          <Meta k="Medicines" v={String(state.medications.length)} />
          <Meta k="Outside range" v={String(outCount)} tone={outCount ? "rust" : undefined} />
          <Meta k="Source" v="NHS-SIM · live" tone="moss" />
        </dl>
      </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className={`relative overflow-hidden rounded-3xl border border-line bg-[radial-gradient(ellipse_at_50%_35%,#ffffff_0%,#eef4f6_45%,#e3ecf0_100%)] ${embedded ? "h-[52vh] min-h-[400px]" : "h-[62vh] min-h-[440px]"}`}>
          <BodyScene focus={focus} tint={tint} onPick={(id) => setFocus((f) => (f === id ? null : id))} reducedMotion={reduced} />
          <div className="pointer-events-none absolute left-4 top-4 font-mono text-[10.5px] uppercase tracking-wider text-muted">
            <div>{patient.name} · {state.patient.age}</div>
            <div className="mt-0.5">{outCount} outside range · {watchCount} to watch</div>
          </div>
          <div className="pointer-events-none absolute bottom-4 left-4 right-4 flex flex-wrap items-end justify-between gap-2">
            <div className="min-h-[3.5rem]">
              {sel ? (
                <div className="rise">
                  <div className="font-display text-2xl font-bold leading-none" style={{ color: STATE_HEX[sel.state] }}>{sel.def.label}</div>
                  <div className="mt-1 text-sm text-muted">{sel.summary}</div>
                </div>
              ) : (
                <div className="text-sm text-muted">Drag to rotate · tap a glowing point or a system on the right</div>
              )}
            </div>
            <ul className="flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-wider text-muted">
              {(["out", "watch", "ok"] as SystemState[]).map((s) => (
                <li key={s} className="flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${STATE_CLASS[s]}`} /> {STATE_LABEL[s]}</li>
              ))}
            </ul>
          </div>
        </div>

        <aside className="space-y-2">
          {systems.map((s) => (
            <SystemRow key={s.def.id} s={s} open={focus === s.def.id} onToggle={() => setFocus((f) => (f === s.def.id ? null : s.def.id))} onAsk={onAsk} patientName={patient.shortName} isPatient={isPatient} />
          ))}
        </aside>
      </div>
    </div>
  );
}

function Meta({ k, v, tone }: { k: string; v: string; tone?: "rust" | "moss" }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-muted">{k}</dt>
      <dd className={`font-medium ${tone === "rust" ? "text-rust" : tone === "moss" ? "text-moss-deep" : "text-ink"}`}>{v}</dd>
    </div>
  );
}

function SystemRow({ s, open, onToggle, onAsk, patientName, isPatient }: { s: SystemStatus; open: boolean; onToggle: () => void; onAsk: (q: string) => void; patientName: string; isPatient: boolean }) {
  return (
    <section className={`overflow-hidden rounded-2xl border bg-card transition ${open ? "border-plum/40 shadow-sm" : "border-line"}`}>
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-paper">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATE_CLASS[s.state]}`} />
        <span className="min-w-0 flex-1">
          <span className="block font-display text-base font-bold leading-tight">{s.def.label}</span>
          <span className="block truncate text-xs text-muted">{s.summary}</span>
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${s.state === "out" ? "bg-[#f8e6df] text-rust" : s.state === "watch" ? "bg-amber-soft text-[#7a520c]" : s.state === "ok" ? "bg-moss-soft text-moss-deep" : s.state === "locked" ? "bg-plum-soft text-plum" : "bg-paper text-muted"}`}>
          {s.state === "locked" ? <span className="inline-flex items-center gap-1"><LockIcon size={10} /> {STATE_LABEL[s.state]}</span> : STATE_LABEL[s.state]}
        </span>
      </button>
      {open && (
        <div className="rise space-y-3 border-t border-line px-4 py-3">
          {s.state === "locked" && <p className="text-sm text-muted">{patientName} hasn’t shared this part of her record with you.</p>}
          {s.analytes.length > 0 && (
            <ul className="divide-y divide-line">
              {s.analytes.map((a) => (
                <li key={a.lab.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{a.lab.name}</div>
                    <div className="text-[11px] text-muted">{a.lab.panel}{a.lab.refRange ? ` · range ${a.lab.refRange}` : ""}{a.trend !== "flat" ? ` · ${a.trend === "up" ? "up" : "down"} ${Math.abs(a.changePct)}% over the series` : ""}</div>
                  </div>
                  <Sparkline lab={a.lab} />
                  <div className={`w-20 text-right font-mono text-sm ${a.lab.flag !== "normal" ? "text-rust" : ""}`}>{a.lab.value}<span className="ml-1 text-[10px] text-muted">{a.lab.unit}</span></div>
                </li>
              ))}
            </ul>
          )}
          {s.conditions.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">On the problem list</div>
              <ul className="mt-1 flex flex-wrap gap-1.5">{s.conditions.map((c) => <li key={c.id} className="rounded-full bg-paper px-2.5 py-0.5 text-xs font-semibold">{c.name}{c.since ? <span className="text-muted"> · {c.since}</span> : null}</li>)}</ul>
            </div>
          )}
          {s.medicines.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">Medicines</div>
              <ul className="mt-1 flex flex-wrap gap-1.5">{s.medicines.map((m) => <li key={m.id} className="rounded-full bg-paper px-2.5 py-0.5 text-xs font-semibold">{m.name}</li>)}</ul>
            </div>
          )}
          {s.mental.length > 0 && (
            <ul className="space-y-1">{s.mental.map((m, i) => <li key={i} className="text-sm"><span className="font-semibold">{m.title}</span> — <span className="text-muted">{m.detail}</span></li>)}</ul>
          )}
          {s.state === "none" && <p className="text-sm text-muted">Nothing on record for this system.</p>}
          {s.state !== "locked" && s.state !== "none" && (
            <button onClick={() => onAsk(isPatient ? `Explain what my ${s.def.label.toLowerCase()} results and conditions mean` : `Explain ${patientName}'s ${s.def.label.toLowerCase()} — what do the results mean?`)} className="text-sm font-semibold text-plum underline-offset-4 hover:underline">Ask Kindred about this →</button>
          )}
        </div>
      )}
    </section>
  );
}

function Sparkline({ lab }: { lab: SystemStatus["analytes"][number]["lab"] }) {
  const h = lab.history ?? [];
  if (h.length < 2) return <div className="w-[104px]" />;
  const W = 104;
  const H = 30;
  const vals = h.map((p) => p.value);
  const lo = Math.min(...vals, lab.refLow ?? Infinity);
  const hi = Math.max(...vals, lab.refHigh ?? -Infinity);
  const span = hi - lo || 1;
  const x = (i: number) => 4 + (i / (h.length - 1)) * (W - 8);
  const y = (v: number) => H - 3 - ((v - lo) / span) * (H - 6);
  const band = lab.refLow !== undefined && lab.refHigh !== undefined ? { top: y(lab.refHigh), bottom: y(lab.refLow) } : null;
  const last = h[h.length - 1];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0" aria-label={`${lab.name} trend`}>
      {band && <rect x={0} y={band.top} width={W} height={Math.max(1, band.bottom - band.top)} fill="var(--moss-soft)" />}
      <polyline fill="none" stroke="var(--muted)" strokeWidth={1.5} strokeLinejoin="round" points={h.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")} />
      <circle cx={x(h.length - 1)} cy={y(last.value)} r={3} fill={lab.flag !== "normal" ? "var(--rust)" : "var(--moss)"} />
    </svg>
  );
}
