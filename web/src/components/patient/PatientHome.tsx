"use client";

import type { AppState } from "@/lib/types";
import { CATEGORIES, personById } from "@/lib/types";
import type { KindredActions } from "@/hooks/useKindred";
import { Avatar, Button, Card, Pill, fmtClock, fmtLongDay, fmtDay } from "../ui";
import { direction } from "./HealthOverview";
import { nextStepsFromRecord } from "./AfterAppointment";
import BodyView from "../body/BodyView";

// Home: today and what's next side by side, then the body view.
// Every line is derived from the live record; nothing here is a diagnosis.

export default function PatientHome({ state, actions, onOpenChat, onAsk }: { state: AppState; actions: KindredActions; onOpenChat: () => void; onAsk?: (q: string) => void }) {
  const patient = personById(state, state.patientId);
  const next = state.appointments[0];
  const pending = state.consentRequests.filter((r) => r.status === "pending");

  const nowOut = state.labs.filter((l) => l.flag !== "normal");
  const worseningOut = nowOut.filter((l) => direction(l) === "worse");
  const clinicActions = state.nextActions.filter((a) => !a.done && a.owner === "clinic");
  const daysToNext = next ? Math.round((new Date(next.start).getTime() - new Date(state.now).getTime()) / 86400000) : null;

  // Today: one sentence, one action, worded for the reading level.
  let today: { text: string; action?: { label: string; onClick: () => void }; tone: "amber" | "moss" };
  if (next && daysToNext != null && daysToNext <= 7) {
    const when = daysToNext <= 0 ? "today" : daysToNext === 1 ? "tomorrow" : `on ${fmtDay(next.start)}`;
    today = {
      tone: "amber",
      text: `Your ${next.title.toLowerCase()} is ${when} at ${fmtClock(next.start)}. ${next.announcedToFamily ? "Your family have been told." : "Kindred will let your family know."}`,
      action: { label: "Who's taking me?", onClick: onOpenChat },
    };
  } else if (worseningOut.length) {
    const w = worseningOut[0];
    today = {
      tone: "amber",
      text: `Your latest ${systemName(w.panel)} test has something outside the usual range, and it moved the wrong way since last time. Your practice reads it with the rest of your record; nothing to do until they call.`,
      action: { label: "Ask Kindred what it means", onClick: onOpenChat },
    };
  } else if (clinicActions.length) {
    today = { tone: "moss", text: `Nothing for you to do today. ${clinicActions[0].text}` };
  } else {
    today = { tone: "moss", text: "Nothing needs doing today." };
  }

  const nextSteps = nextStepsFromRecord(state);

  return (
    <div className="space-y-5">
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

      {/* NOW: today and what's next, side by side */}
      <section aria-labelledby="now-h" className="space-y-3">
        <SectionHead id="now-h" kicker="Now" title="How things are" />
        <div className="grid gap-3 md:grid-cols-2 md:gap-4">
          <Card tone={today.tone} className="flex flex-col">
            <Pill tone={today.tone === "amber" ? "amber" : "moss"} className="self-start">Today</Pill>
            <p className="mt-2 text-[19px] leading-snug sm:text-[21px]">{today.text}</p>
            {today.action && <div className="mt-auto pt-3"><Button variant="secondary" size="lg" onClick={today.action.onClick}>{today.action.label}</Button></div>}
          </Card>
          {next ? (
            <Card tone="amber" className="flex flex-col">
              <div className="flex items-center justify-between">
                <Pill tone="amber">Next</Pill>
                <span className="text-sm font-semibold text-[#7a520c]">{daysUntil(state.now, next.start)}</span>
              </div>
              <div className="mt-2 font-display text-[22px] font-bold leading-tight">{next.title}</div>
              <div className="mt-1 text-[16px]">{fmtLongDay(next.start)} at {fmtClock(next.start)}</div>
              <div className="text-[15px] text-muted">{next.location}{next.mode ? ` · ${next.mode}` : ""} · with {personById(state, next.clinicianId).name}</div>
              {next.prep.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-[15px] font-semibold text-[#7a520c]">On your record for this visit</summary>
                  <ul className="mt-2 space-y-1.5 pl-5 text-[15px]">{next.prep.map((p) => <li key={p} className="list-disc">{p}</li>)}</ul>
                </details>
              )}
              {nextSteps.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[15px] font-semibold text-[#7a520c]">What happens next</summary>
                  <ul className="mt-2 space-y-1.5 text-[15px] leading-relaxed">
                    {nextSteps.map((s, i) => <li key={i} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber" /><span>{s}</span></li>)}
                  </ul>
                </details>
              )}
              <div className="mt-auto pt-3 text-sm">{next.announcedToFamily ? <span className="text-moss-deep">Your family have been told.</span> : <span className="text-muted">Kindred will remind your family a week before.</span>}</div>
            </Card>
          ) : (
            <Card className="flex flex-col">
              <Pill tone="neutral" className="self-start">Next</Pill>
              <div className="mt-2 font-display text-lg font-bold">No date booked yet</div>
              <p className="mt-1 text-[16px] text-muted">{clinicActions[0] ? clinicActions[0].text : "Nothing is in the practice diary for you right now."}</p>
              {nextSteps.length > 0 && (
                <ul className="mt-3 space-y-1.5 text-[15px] leading-relaxed">
                  {nextSteps.map((s, i) => <li key={i} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber" /><span>{s}</span></li>)}
                </ul>
              )}
              <div className="mt-auto pt-3"><Button variant="secondary" size="lg" onClick={onOpenChat}>Ask Kindred about what&rsquo;s next</Button></div>
            </Card>
          )}
        </div>
      </section>

      {/* BODY */}
      <section aria-labelledby="body-h" className="space-y-3">
        <BodyView state={state} viewerId={state.patientId} embedded onAsk={onAsk ?? (() => onOpenChat())} />
      </section>
    </div>
  );
}

function SectionHead({ id, kicker, title, sub }: { id: string; kicker: string; title: string; sub?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-plum">{kicker}</span>
      <h2 id={id} className="font-display text-xl font-bold">{title}</h2>
      {sub && <span className="basis-full text-sm text-muted sm:basis-auto">{sub}</span>}
    </div>
  );
}

function systemName(panel: string) {
  return ({ "Full blood count (FBC)": "blood", "HbA1c": "blood sugar", "Liver function tests (LFT)": "liver", "Urea & electrolytes (U&E)": "kidney", "C-reactive protein (CRP)": "inflammation", "Lipid profile": "cholesterol" } as Record<string, string>)[panel] ?? panel;
}
function daysUntil(now: string, then: string) {
  const d = Math.round((new Date(then).getTime() - new Date(now).getTime()) / 86400000);
  return d <= 0 ? "Today" : d === 1 ? "Tomorrow" : `In ${d} days`;
}
