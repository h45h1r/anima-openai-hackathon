"use client";

import { useState } from "react";
import type { AppState, AuditEntry, AuditKind } from "@/lib/types";
import { personById } from "@/lib/types";
import { Avatar, KindredMark, LockIcon, fmtTime } from "./ui";

const KIND: Record<AuditKind, { label: string; tone: string }> = {
  "consent.check": { label: "consent check", tone: "text-plum" },
  "consent.update": { label: "consent changed", tone: "text-plum" },
  "consent.request": { label: "consent request", tone: "text-plum" },
  "ehr.sync": { label: "EHR sync", tone: "text-[#3C5A7A]" },
  "tool.call": { label: "tool", tone: "text-moss-deep" },
  "notification.sent": { label: "notification", tone: "text-[#7a520c]" },
  "agent.turn": { label: "agent", tone: "text-muted" },
  system: { label: "system", tone: "text-muted" },
};

export default function AuditRail({ state }: { state: AppState }) {
  const [filter, setFilter] = useState<"all" | "consent" | "tools">("all");
  const entries = state.audit.filter((a) => (filter === "all" ? true : filter === "consent" ? a.kind.startsWith("consent") || a.kind === "ehr.sync" : a.kind === "tool.call" || a.kind === "notification.sent"));
  const checks = state.audit.filter((a) => a.kind === "consent.check");
  const withheld = checks.filter((a) => a.ok === false).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-plum"><KindredMark size={18} /></span>
          <h2 className="font-display text-base font-bold">Behind the glass</h2>
        </div>
        <p className="mt-0.5 text-xs text-muted">Every check Kindred makes, as it happens. This is what the patient, the family and the clinic can each audit.</p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Stat label="consent checks" value={checks.length} />
          <Stat label="withheld" value={withheld} tone="plum" />
          <Stat label="EHR consent" value={`v${state.ehr.consentVersion}`} tone="sky" />
        </div>
        <div className="mt-3 flex gap-1">
          {(["all", "consent", "tools"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${filter === f ? "bg-ink text-white" : "text-muted hover:bg-paper"}`}>
              {f}
            </button>
          ))}
        </div>
      </div>
      <ol className="scroll-thin flex-1 space-y-0.5 overflow-y-auto p-2">
        {entries.map((a) => <Row key={a.id} a={a} state={state} />)}
      </ol>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "plum" | "sky" }) {
  return (
    <div className="rounded-xl border border-line bg-card px-2 py-1.5">
      <div className={`font-display text-lg font-bold leading-none ${tone === "plum" ? "text-plum" : tone === "sky" ? "text-[#3C5A7A]" : ""}`}>{value}</div>
      <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}

function Row({ a, state }: { a: AuditEntry; state: AppState }) {
  const [open, setOpen] = useState(false);
  const actor = personById(state, a.actorId);
  const k = KIND[a.kind];
  const hasDetail = a.detail !== undefined;
  return (
    <li className="rise">
      <button onClick={() => hasDetail && setOpen(!open)} className={`flex w-full items-start gap-2 rounded-xl px-2 py-1.5 text-left ${hasDetail ? "hover:bg-paper" : "cursor-default"}`}>
        <span className="mt-0.5 font-mono text-[10px] text-muted">{fmtTime(a.ts)}</span>
        <Avatar person={actor} size={18} />
        <span className="min-w-0 flex-1">
          <span className={`mr-1.5 font-mono text-[10px] font-medium uppercase ${k.tone}`}>{k.label}</span>
          <span className={`text-xs ${a.ok === false ? "text-plum" : "text-ink"}`}>
            {a.ok === false && a.kind === "consent.check" && <span className="mr-1 inline-block align-[-1px]"><LockIcon size={10} /></span>}
            {a.summary}
          </span>
        </span>
      </button>
      {open && hasDetail && <pre className="scroll-thin mx-2 mb-1 max-h-48 overflow-auto rounded-lg bg-[#0f1a15] p-2 font-mono text-[10px] leading-snug text-[#cfe3d8]">{JSON.stringify(a.detail, null, 2)}</pre>}
    </li>
  );
}
