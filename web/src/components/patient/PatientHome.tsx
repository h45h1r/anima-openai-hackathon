"use client";

import type { AppState } from "@/lib/types";
import { CATEGORIES, personById } from "@/lib/types";
import type { KindredActions } from "@/hooks/useKindred";
import { Avatar, Button, Card, LockIcon, Pill, fmtClock, fmtLongDay } from "../ui";

export default function PatientHome({
  state,
  actions,
  onOpenCircle,
  onOpenChat,
  onOpenCompanion,
}: {
  state: AppState;
  actions: KindredActions;
  onOpenCircle: () => void;
  onOpenChat: () => void;
  onOpenCompanion?: () => void;
}) {
  const patient = personById(state, state.patientId);
  const next = state.appointments[0];
  const pending = state.consentRequests.filter((r) => r.status === "pending");
  const actionsOpen = state.nextActions.filter((a) => !a.done);
  const sharedCount = Object.values(state.consent).reduce((n, s) => n + CATEGORIES.filter((c) => s[c.id]).length, 0);
  const hour = new Date(state.now).getUTCHours() + 1; // Europe/London in September
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-semibold text-muted">{fmtLongDay(state.now)}</div>
        <h1 className="font-display text-[28px] font-bold leading-tight sm:text-4xl">{greeting}, {patient.shortName}</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2">

      {pending.map((r) => {
        const who = personById(state, r.requesterId);
        const cat = CATEGORIES.find((c) => c.id === r.category)!;
        return (
          <Card key={r.id} tone="plum" className="rise">
            <div className="flex items-start gap-3">
              <Avatar person={who} size={40} />
              <div className="min-w-0 flex-1">
                <div className="font-display text-lg font-bold leading-tight">{who.shortName} would like to see your {cat.label.toLowerCase()}</div>
                <p className="mt-1 text-[15px] leading-snug text-ink/80">“{r.reason}”</p>
                <div className="mt-3 flex gap-2">
                  <Button variant="plum" size="lg" onClick={() => actions.respondRequest(r.id, true)}>Share with {who.shortName}</Button>
                  <Button variant="secondary" size="lg" onClick={() => actions.respondRequest(r.id, false)}>Not now</Button>
                </div>
              </div>
            </div>
          </Card>
        );
      })}

      {next ? (
        <Card tone="amber">
          <div className="flex items-center justify-between">
            <Pill tone="amber">Next appointment</Pill>
            <span className="text-sm font-semibold text-[#7a520c]">{daysUntil(state.now, next.start)}</span>
          </div>
          <div className="mt-2 font-display text-[22px] font-bold leading-tight">{next.title}</div>
          <div className="mt-1 text-[16px]">{fmtLongDay(next.start)} at {fmtClock(next.start)}</div>
          <div className="text-[15px] text-muted">{next.location}{next.mode ? ` · ${next.mode}` : ""}</div>
          <div className="mt-1 text-[15px] text-muted">with {personById(state, next.clinicianId).name}</div>
          {next.prep.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[15px] font-semibold text-[#7a520c]">On your record for this visit</summary>
              <ul className="mt-2 space-y-1.5 pl-5 text-[15px]">{next.prep.map((p) => <li key={p} className="list-disc">{p}</li>)}</ul>
            </details>
          )}
          {next.announcedToFamily ? <div className="mt-3 flex items-center gap-1.5 text-sm text-moss-deep"><CheckIcon /> Your family have been told</div> : <div className="mt-3 text-sm text-muted">Kindred will remind your family a week before.</div>}
        </Card>
      ) : (
        <Card>
          <div className="font-display text-lg font-bold">No appointments booked</div>
          <p className="mt-1 text-[15px] text-muted">Nothing is in the practice diary for you right now.</p>
        </Card>
      )}

      <Card>
        <div className="flex items-center justify-between">
          <div className="font-display text-lg font-bold">To do</div>
          <span className="text-sm text-muted">{actionsOpen.length} open</span>
        </div>
        {actionsOpen.length === 0 && <p className="mt-2 text-[15px] text-muted">Nothing outstanding.</p>}
        <ul className="mt-2 divide-y divide-line">
          {actionsOpen.map((a) => (
            <li key={a.id} className="flex items-start gap-3 py-2.5">
              <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${a.owner === "family" ? "bg-rust" : a.owner === "clinic" ? "bg-[#3C5A7A]" : "bg-moss"}`} />
              <div className="min-w-0 flex-1">
                <div className="text-[16px] leading-snug">{a.text}</div>
                <div className="text-sm text-muted">
                  {a.owner === "family" ? "For the family" : a.owner === "clinic" ? "Practice / clinic" : "For you"}
                  {a.due ? ` · by ${new Date(a.due).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}` : ""}
                  {a.source ? ` · ${a.source}` : ""}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <button onClick={onOpenCircle} className="w-full rounded-2xl border border-plum/30 bg-plum-soft p-4 text-left transition hover:brightness-[0.98]">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-plum text-white"><LockIcon size={20} /></span>
          <div className="flex-1">
            <div className="font-display text-lg font-bold leading-tight">Your circle</div>
            <div className="text-[15px] text-muted">{Object.keys(state.consent).length} people · {sharedCount} things shared · v{state.ehr.consentVersion} on your {state.patient.practice} record</div>
          </div>
          <Chevron />
        </div>
      </button>

      <button onClick={onOpenChat} className="w-full rounded-2xl border border-line bg-card p-4 text-left transition hover:bg-paper">
        <div className="flex items-center gap-3">
          <Avatar person={personById(state, state.agentId)} size={44} />
          <div className="flex-1">
            <div className="font-display text-lg font-bold leading-tight">Ask about your care</div>
            <div className="text-[15px] text-muted">“What do my latest blood tests mean?” · grounded clinical Ask</div>
          </div>
          <Chevron />
        </div>
      </button>

      {onOpenCompanion ? (
        <button onClick={onOpenCompanion} className="w-full rounded-2xl border border-line bg-card p-4 text-left transition hover:bg-paper">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-plum text-white">
              <LockIcon size={20} />
            </span>
            <div className="flex-1">
              <div className="font-display text-lg font-bold leading-tight">Talk to Kindred about sharing</div>
              <div className="text-[15px] text-muted">Change who can see what — same companion chat as before</div>
            </div>
            <Chevron />
          </div>
        </button>
      ) : null}
      </div>
    </div>
  );
}

function daysUntil(now: string, then: string) {
  const d = Math.round((new Date(then).getTime() - new Date(now).getTime()) / 86400000);
  return d <= 0 ? "Today" : d === 1 ? "Tomorrow" : `In ${d} days`;
}
function Chevron() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-muted"><path d="M9 6l6 6-6 6" /></svg>;
}
function CheckIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>;
}
