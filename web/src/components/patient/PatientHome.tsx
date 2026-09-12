"use client";

import { useEffect, useState } from "react";
import type { AppState } from "@/lib/types";
import { CATEGORIES, personById } from "@/lib/types";
import type { KindredActions } from "@/hooks/useKindred";
import { READING_LEVELS, loadReadingLevel, saveReadingLevel, type ReadingLevel } from "@/lib/reading-level";
import { Avatar, Button, Card, Pill, fmtClock, fmtLongDay, fmtDay } from "../ui";
import HealthOverview, { direction } from "./HealthOverview";
import AfterAppointment, { nextStepsFromRecord } from "./AfterAppointment";

// Home in three time bands: What's happened, How things are now, What's next.
// A reading-level switch changes the wording everywhere. Every line is
// derived from the live record; nothing here is a diagnosis.

export default function PatientHome({ state, actions, onOpenChat }: { state: AppState; actions: KindredActions; onOpenChat: () => void }) {
  const [level, setLevel] = useState<ReadingLevel>("standard");
  useEffect(() => setLevel(loadReadingLevel()), []);
  const choose = (l: ReadingLevel) => { setLevel(l); saveReadingLevel(l); };

  const patient = personById(state, state.patientId);
  const next = state.appointments[0];
  const pending = state.consentRequests.filter((r) => r.status === "pending");
  const hour = new Date(state.now).getUTCHours() + 1; // Europe/London in September
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const nowOut = state.labs.filter((l) => l.flag !== "normal");
  const worseningOut = nowOut.filter((l) => direction(l) === "worse");
  const clinicActions = state.nextActions.filter((a) => !a.done && a.owner === "clinic");
  const daysToNext = next ? Math.round((new Date(next.start).getTime() - new Date(state.now).getTime()) / 86400000) : null;

  // History strip: what the record holds this year.
  const year = new Date(state.now).getFullYear();
  const visits = state.careNotes.filter((n) => n.kind !== "letter" && n.date.startsWith(String(year))).length;
  const letters = state.careNotes.filter((n) => n.kind === "letter").length;
  const testDates = new Set(state.labs.flatMap((l) => l.history.map((h) => h.date))).size;

  // Today: one sentence, one action, worded for the reading level.
  let today: { text: string; action?: { label: string; onClick: () => void }; tone: "amber" | "moss" };
  if (next && daysToNext != null && daysToNext <= 7) {
    const when = daysToNext <= 0 ? "today" : daysToNext === 1 ? "tomorrow" : `on ${fmtDay(next.start)}`;
    today = {
      tone: "amber",
      text: level === "simple"
        ? `You have an appointment ${when} at ${fmtClock(next.start)}.`
        : `Your ${next.title.toLowerCase()} is ${when} at ${fmtClock(next.start)}. ${next.announcedToFamily ? "Your family have been told." : "Kindred will let your family know."}`,
      action: { label: "Who's taking me?", onClick: onOpenChat },
    };
  } else if (worseningOut.length) {
    const w = worseningOut[0];
    today = {
      tone: "amber",
      text: level === "simple"
        ? `One of your ${systemName(w.panel)} test results needs a look. Your practice will call you. Nothing to do now.`
        : level === "detailed"
          ? `${w.name} is ${w.value} ${w.unit} (usual range ${w.refRange}), ${w.previous ? `up from ${w.previous.value} on ${fmtDay(w.previous.date)}` : "outside the usual range"}. Your practice reads it with the rest of your record; nothing to do until they call.`
          : `Your latest ${systemName(w.panel)} test has something outside the usual range, and it moved the wrong way since last time. Your practice reads it with the rest of your record; nothing to do until they call.`,
      action: { label: "Ask Kindred what it means", onClick: onOpenChat },
    };
  } else if (clinicActions.length) {
    today = { tone: "moss", text: level === "simple" ? "Nothing to do today." : `Nothing for you to do today. ${clinicActions[0].text}` };
  } else {
    today = { tone: "moss", text: "Nothing needs doing today." };
  }

  const nextSteps = nextStepsFromRecord(state, level);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-muted">{fmtLongDay(state.now)}</div>
          <h1 className="font-display text-[28px] font-bold leading-tight sm:text-4xl">{greeting}, {patient.shortName}</h1>
        </div>
        <div role="radiogroup" aria-label="How much detail" className="flex items-center gap-2">
          <span className="text-sm text-muted">Explain it</span>
          <div className="flex rounded-full border border-line bg-card p-0.5">
            {READING_LEVELS.map((l) => (
              <button key={l.id} role="radio" aria-checked={level === l.id} title={l.blurb} onClick={() => choose(l.id)} className={`rounded-full px-3 py-1 text-sm font-semibold transition ${level === l.id ? "bg-plum text-white" : "text-muted hover:text-ink"}`}>{l.label}</button>
            ))}
          </div>
        </div>
      </div>

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

      {/* NOW */}
      <section aria-labelledby="now-h" className="space-y-3">
        <SectionHead id="now-h" kicker="Now" title="How things are" />
        <Card tone={today.tone}>
          <Pill tone={today.tone === "amber" ? "amber" : "moss"}>Today</Pill>
          <p className={`mt-2 leading-snug ${level === "simple" ? "text-[21px] sm:text-[24px]" : "text-[19px] sm:text-[21px]"}`}>{today.text}</p>
          {today.action && <div className="mt-3"><Button variant="secondary" size="lg" onClick={today.action.onClick}>{today.action.label}</Button></div>}
        </Card>
        <HealthOverview state={state} onAsk={onOpenChat} level={level} />
      </section>

      {/* PAST */}
      <section aria-labelledby="past-h" className="space-y-3">
        <SectionHead id="past-h" kicker="Before" title="What's happened" sub={level === "simple" ? undefined : `This year on your record: ${visits} practice contact${visits === 1 ? "" : "s"}, ${testDates} blood test${testDates === 1 ? "" : "s"}, ${letters} hospital letter${letters === 1 ? "" : "s"}.`} />
        <AfterAppointment state={state} onAsk={onOpenChat} level={level} />
      </section>

      {/* FUTURE */}
      <section aria-labelledby="next-h" className="space-y-3">
        <SectionHead id="next-h" kicker="Next" title="What's coming" />
        {next ? (
          <Card tone="amber">
            <div className="flex items-center justify-between">
              <Pill tone="amber">Appointment</Pill>
              <span className="text-sm font-semibold text-[#7a520c]">{daysUntil(state.now, next.start)}</span>
            </div>
            <div className="mt-2 font-display text-[22px] font-bold leading-tight">{next.title}</div>
            <div className="mt-1 text-[16px]">{fmtLongDay(next.start)} at {fmtClock(next.start)}</div>
            <div className="text-[15px] text-muted">{next.location}{next.mode ? ` · ${next.mode}` : ""} · with {personById(state, next.clinicianId).name}</div>
            {level !== "simple" && next.prep.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-[15px] font-semibold text-[#7a520c]">On your record for this visit</summary>
                <ul className="mt-2 space-y-1.5 pl-5 text-[15px]">{next.prep.map((p) => <li key={p} className="list-disc">{p}</li>)}</ul>
              </details>
            )}
            {next.announcedToFamily ? <div className="mt-3 text-sm text-moss-deep">Your family have been told.</div> : <div className="mt-3 text-sm text-muted">Kindred will remind your family a week before.</div>}
          </Card>
        ) : (
          <Card>
            <div className="font-display text-lg font-bold">No date booked yet</div>
            <p className="mt-1 text-[16px] text-muted">{level === "simple" ? "The clinic will write to you with a date." : clinicActions[0] ? clinicActions[0].text : "Nothing is in the practice diary for you right now."}</p>
          </Card>
        )}
        {nextSteps.length > 0 && (
          <Card>
            <div className="font-display text-lg font-bold">What happens next</div>
            <ul className="mt-2 space-y-2 text-[16px] leading-relaxed">
              {nextSteps.map((s, i) => <li key={i} className="flex gap-3"><span className="mt-2.5 h-2 w-2 shrink-0 rounded-full bg-amber" /><span>{s}</span></li>)}
            </ul>
            <div className="mt-3"><Button variant="secondary" size="lg" onClick={onOpenChat}>Ask Kindred about what's next</Button></div>
          </Card>
        )}
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
