"use client";

import type { AppState, Category } from "@/lib/types";
import { CATEGORIES, canAccess, personById } from "@/lib/types";
import type { KindredActions } from "@/hooks/useKindred";
import { Card, LockIcon, Pill, fmtClock, fmtLongDay } from "../ui";
import BodyView from "../body/BodyView";

export default function FamilyHome({ state, viewerId, onAsk }: { state: AppState; viewerId: string; actions: KindredActions; onAsk: (q: string) => void }) {
  const patient = personById(state, state.patientId);
  const can = (c: Category) => canAccess(state, viewerId, c);
  const next = state.appointments[0];
  const shared = CATEGORIES.filter((c) => can(c.id));
  const locked = CATEGORIES.filter((c) => !can(c.id));
  const pending = state.consentRequests.filter((r) => r.requesterId === viewerId && r.status === "pending");
  const latestLab = state.labs.map((l) => l.date).sort().pop();
  const abnormal = state.labs.filter((l) => l.flag !== "normal");

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-semibold text-muted">{fmtLongDay(state.now)}</div>
        <h1 className="font-display text-[26px] font-bold leading-tight sm:text-4xl">{patient.shortName}’s week</h1>
        <p className="mt-1 text-sm text-muted">{patient.shortName} has shared {shared.length} of {CATEGORIES.length} parts of her record with you.</p>
      </div>

      {can("appointments") ? (
        next ? (
          <Card tone="amber">
            <Pill tone="amber">Next appointment</Pill>
            <div className="mt-2 font-display text-xl font-bold leading-tight">{next.title}</div>
            <div className="mt-1 text-[15px]">{fmtLongDay(next.start)} at {fmtClock(next.start)}</div>
            <div className="text-sm text-muted">{next.location} · with {personById(state, next.clinicianId).name}</div>
            {next.purpose && <p className="mt-2 text-sm">{next.purpose}</p>}
            <button onClick={() => onAsk(`What should we know before ${patient.shortName}'s ${next.title.toLowerCase()}?`)} className="mt-3 text-sm font-semibold text-[#7a520c] underline-offset-2 hover:underline">Ask Kindred what to expect →</button>
          </Card>
        ) : (
          <Card><div className="font-display text-lg font-bold">No appointments booked</div><p className="mt-1 text-sm text-muted">Nothing is in the practice diary right now.</p></Card>
        )
      ) : (
        <LockedCard label="Appointments" patient={patient.shortName} />
      )}

      <BodyView state={state} viewerId={viewerId} embedded onAsk={onAsk} />

      <div className="grid grid-cols-2 gap-3 md:gap-4">
        {can("lab_results") ? (
          <Card className="col-span-2">
            <div className="flex items-center justify-between">
              <div className="font-display text-lg font-bold">Test results</div>
              {latestLab && <span className="text-xs text-muted">latest {new Date(latestLab).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}
            </div>
            {state.labs.length === 0 && <p className="mt-2 text-sm text-muted">No blood results on record.</p>}
            <ul className="mt-2 divide-y divide-line">
              {(abnormal.length ? abnormal : state.labs.slice(0, 6)).map((l) => (
                <li key={l.id} className="flex items-center gap-3 py-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${l.flag === "normal" ? "bg-moss" : "bg-rust"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{l.name}</div>
                    <div className="text-xs text-muted">{l.panel}{l.refRange ? ` · range ${l.refRange}` : ""}{l.previous ? ` · was ${l.previous.value} in ${new Date(l.previous.date).toLocaleDateString("en-GB", { month: "short" })}` : ""}</div>
                  </div>
                  <div className="font-mono text-sm font-medium">{l.value} <span className="text-xs text-muted">{l.unit}</span></div>
                </li>
              ))}
            </ul>
            {state.labs.length > 0 && <p className="mt-2 text-xs text-muted">{abnormal.length ? `${abnormal.length} of ${state.labs.length} measurements outside range; the rest are normal.` : `All ${state.labs.length} measurements within range.`}</p>}
            <button onClick={() => onAsk(`What do ${patient.shortName}'s latest blood tests mean? Should we be worried?`)} className="mt-3 text-sm font-semibold text-plum underline-offset-2 hover:underline">Ask Kindred to explain these →</button>
          </Card>
        ) : (
          <LockedCard label="Test results" patient={patient.shortName} className="col-span-2" pending={pending.some((p) => p.category === "lab_results")} onAsk={() => onAsk(`Can you ask ${patient.shortName} to share her test results with me?`)} />
        )}

        {can("medications") ? (
          <Card>
            <div className="font-display text-base font-bold">Medicines</div>
            {state.medications.length === 0 ? <p className="mt-1 text-sm text-muted">No regular medicines on the GP record.</p> : (
              <ul className="mt-2 space-y-1.5">{state.medications.map((m) => <li key={m.id} className="text-sm"><span className="font-semibold">{m.name}</span> {m.dose && <span className="text-muted">{m.dose}</span>}</li>)}</ul>
            )}
          </Card>
        ) : (
          <LockedCard label="Medicines" patient={patient.shortName} compact />
        )}

        {can("conditions") ? (
          <Card>
            <div className="font-display text-base font-bold">Conditions</div>
            {state.conditions.length === 0 ? <p className="mt-1 text-sm text-muted">No active problems coded.</p> : (
              <ul className="mt-2 space-y-1.5">{state.conditions.map((c) => <li key={c.id} className="text-sm"><span className="font-semibold">{c.name}</span>{c.since && <span className="text-muted"> · since {c.since}</span>}</li>)}</ul>
            )}
          </Card>
        ) : (
          <LockedCard label="Conditions" patient={patient.shortName} compact />
        )}

        {can("care_notes") ? (
          <Card className="col-span-2">
            <div className="font-display text-base font-bold">Care notes</div>
            {state.careNotes.length === 0 && <p className="mt-1 text-sm text-muted">No notes on record.</p>}
            <ul className="mt-2 space-y-2">
              {state.careNotes.slice(0, 4).map((n) => (
                <li key={n.id} className="text-sm"><span className="font-semibold">{state.people.find((p) => p.id === n.authorId)?.shortName ?? "Practice"}, {new Date(n.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}:</span> <span className="text-ink/80">{n.text}</span></li>
              ))}
            </ul>
          </Card>
        ) : (
          <LockedCard label="Care notes" patient={patient.shortName} className="col-span-2" compact />
        )}

        {can("mental_health") ? (
          <Card className="col-span-2">
            <div className="font-display text-base font-bold">Mood & wellbeing</div>
            {state.mentalHealth.length === 0 ? <p className="mt-1 text-sm text-muted">Nothing recorded.</p> : state.mentalHealth.slice(0, 3).map((e) => <p key={e.id} className="mt-1 text-sm"><span className="font-semibold">{e.title}</span> — {e.detail}</p>)}
          </Card>
        ) : (
          <LockedCard label="Mood & wellbeing" patient={patient.shortName} className="col-span-2" compact pending={pending.some((p) => p.category === "mental_health")} />
        )}
      </div>

      {locked.length > 0 && (
        <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
          <span className="mt-0.5 text-plum"><LockIcon size={13} /></span>
          Locked sections are {patient.shortName}’s choice. Kindred will never describe them to you, but it can ask her on your behalf.
        </p>
      )}
    </div>
  );
}

function LockedCard({ label, patient, className = "", compact = false, pending = false, onAsk }: { label: string; patient: string; className?: string; compact?: boolean; pending?: boolean; onAsk?: () => void }) {
  return (
    <div className={`rounded-2xl border border-dashed border-plum/40 bg-plum-soft/40 p-4 ${className}`}>
      <div className="flex items-center gap-2 text-plum">
        <LockIcon size={compact ? 14 : 16} />
        <span className={`font-display font-bold ${compact ? "text-base" : "text-lg"}`}>{label}</span>
      </div>
      <p className="mt-1 text-sm text-muted">{pending ? `You’ve asked ${patient} — waiting for her answer.` : `${patient} hasn’t shared this with you.`}</p>
      {onAsk && !pending && <button onClick={onAsk} className="mt-2 text-sm font-semibold text-plum underline-offset-2 hover:underline">Ask her via Kindred →</button>}
    </div>
  );
}
