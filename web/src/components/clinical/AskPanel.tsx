"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { AppState, Person } from "@/lib/types";
import { levelLabel } from "@/lib/levels";
import { Avatar, KindredMark, LockIcon, Prose } from "../ui";
import ResultChart from "./ResultChart";
import type { CareClinical, AskThreadMessage } from "@/hooks/useCareClinical";
import { kindredLevelForPerson } from "@/lib/carecircle/viewers";

export default function AskPanel({
  state,
  viewer,
  care,
  onOpenCircle,
}: {
  state: AppState;
  viewer: Person;
  care: CareClinical;
  onOpenCircle: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const threadEnd = useRef<HTMLDivElement | null>(null);
  const thread = care.askThread;
  const level = viewer.id === state.patientId ? "everything" : kindredLevelForPerson(state, viewer.id);
  const agent = state.people.find((p) => p.role === "agent") || {
    id: "kindred",
    name: "Kindred",
    shortName: "Kindred",
    role: "agent" as const,
    relation: "Care companion",
    color: "#6D2E5B",
    initials: "K",
  };
  const patientName = care.session?.selectedPatientName || state.patient.name;
  const isPatient = viewer.id === state.patientId;
  const textSize = isPatient ? "text-[17px] leading-relaxed" : "text-[15px] leading-relaxed";

  useEffect(() => {
    const draft = sessionStorage.getItem("kindred.draftQuestion");
    if (draft) {
      setQuestion(draft);
      sessionStorage.removeItem("kindred.draftQuestion");
    }
  }, []);

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [thread.length, care.askStreamText, busy]);

  async function submit(q: string) {
    if (!q.trim() || busy) return;
    setBusy(true);
    setSourcesOpen(false);
    setQuestion("");
    try {
      await care.ask(q.trim());
    } catch {
      /* error surfaced on care.error */
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit(question);
  }

  if (care.status === "booting" || care.status === "idle") {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center bg-paper text-sm text-muted lg:overflow-hidden lg:rounded-2xl lg:border lg:border-line lg:bg-card/40">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-plum-soft text-plum">
          <KindredMark size={26} />
        </div>
        Connecting clinical Ask…
      </div>
    );
  }

  if (care.status === "needs_server") {
    return (
      <div className="flex h-full min-h-0 flex-col bg-paper px-5 py-8 lg:overflow-hidden lg:rounded-2xl lg:border lg:border-line lg:bg-card/40">
        <div className="mx-auto max-w-md text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-plum-soft text-plum">
            <KindredMark size={26} />
          </div>
          <p className="text-[15px] leading-relaxed text-ink">
            Clinical Ask runs inside Kindred. Add your Anima key and restart the app.
          </p>
          <ol className="mt-4 space-y-2 text-left text-sm leading-relaxed text-muted">
            <li>
              Set <code className="rounded bg-paper px-1 text-ink">ANIMA_API_KEY</code> in{" "}
              <code className="rounded bg-paper px-1 text-ink">web/.env.local</code>
            </li>
            <li>
              Restart with <code className="rounded bg-paper px-1 text-ink">npm run dev</code>
            </li>
            <li>Open Ask in this same Kindred tab</li>
          </ol>
          <button
            type="button"
            onClick={() => care.retry()}
            className="mt-5 rounded-full bg-plum px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
          >
            Retry connect
          </button>
          {care.error ? <p className="mt-3 text-sm text-rust">{care.error}</p> : null}
        </div>
      </div>
    );
  }

  const streamingText = busy ? care.askStreamText : "";
  const latestAssistant = [...thread].reverse().find((m) => m.role === "assistant");
  const empty = !thread.length && !busy;
  const userAsked = thread.some((m) => m.role === "user");
  const suggestions =
    care.suggestions.length > 0
      ? care.suggestions
      : isPatient
        ? [
            "What do my latest blood tests show?",
            "Who can see what?",
            "When is my next appointment?",
            "What matters to me right now?",
          ]
        : [
            `What do ${patientName.split(" ")[0]}'s latest blood tests show?`,
            "What next actions are open?",
            `When is ${patientName.split(" ")[0]}'s next appointment?`,
          ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper lg:overflow-hidden lg:rounded-2xl lg:border lg:border-line lg:bg-card/40">
      <div className="scroll-thin flex-1 space-y-3 overflow-y-auto px-3 pb-3 pt-4 sm:px-5" aria-live="polite">
        {empty ? (
          <div className="mt-10 text-center text-sm text-muted">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-plum-soft text-plum">
              <KindredMark size={26} />
            </div>
            <p>
              Ask Kindred anything about {isPatient ? "your" : `${patientName}'s`} care — clinical questions, sharing, and what matters.
            </p>
            <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-plum">
              <LockIcon size={11} /> {viewer.shortName} · {levelLabel(level)}
            </p>
          </div>
        ) : (
          thread.map((msg) => (
            <ThreadBubble
              key={msg.id}
              msg={msg}
              agent={agent}
              textSize={textSize}
              sourcesOpen={sourcesOpen}
              setSourcesOpen={setSourcesOpen}
              isLatestAssistant={msg.id === latestAssistant?.id && !busy}
              onOpenCircle={onOpenCircle}
            />
          ))
        )}

        {busy && streamingText ? (
          <div className="rise flex items-end gap-2">
            <Avatar person={agent} size={isPatient ? 34 : 28} />
            <div className={`max-w-[88%] sm:max-w-[75%] rounded-2xl rounded-bl-md bg-card px-3.5 py-2.5 ${textSize} text-ink shadow-sm ring-1 ring-line`}>
              <Prose text={streamingText} />
              <span className="pulse-soft ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 rounded-sm bg-plum/60" />
            </div>
          </div>
        ) : busy ? (
          <div className="rise flex items-end gap-2">
            <Avatar person={agent} size={isPatient ? 34 : 28} />
            <div className={`rounded-2xl rounded-bl-md bg-card px-3.5 py-2.5 ${textSize} text-muted shadow-sm ring-1 ring-line`}>
              <span className="pulse-soft">{care.askStatus || "Looking through the record…"}</span>
            </div>
          </div>
        ) : null}

        {care.error ? (
          <div className="rounded-2xl border border-rust/30 bg-[#f8e6df] px-3.5 py-2.5 text-sm text-rust">
            {care.error}{" "}
            <button type="button" className="font-semibold underline" onClick={() => care.clearError()}>
              Dismiss
            </button>
          </div>
        ) : null}

        <div ref={threadEnd} />
      </div>

      <div className="border-t border-line bg-card/90 p-2.5 backdrop-blur sm:p-3">
        {suggestions.length > 0 && !userAsked && (
          <div className="scroll-thin mb-2 flex gap-2 overflow-x-auto pb-1">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void submit(s)}
                disabled={busy}
                className="shrink-0 rounded-full border border-plum/30 bg-plum-soft px-3 py-1.5 text-xs font-semibold text-plum hover:brightness-95 disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <form className="flex items-end gap-2" onSubmit={onSubmit}>
          <label htmlFor="kindred-ask" className="sr-only">
            Ask about care
          </label>
          <textarea
            id="kindred-ask"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit(question);
              }
            }}
            rows={1}
            placeholder={thread.length ? "Ask a follow-up…" : "Ask Kindred…"}
            className={`max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border border-line bg-paper px-4 py-2.5 text-base outline-none focus:border-plum ${isPatient ? "sm:text-[17px]" : "sm:text-[15px]"}`}
          />
          <button
            type="submit"
            disabled={busy || !question.trim()}
            aria-label="Send"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-plum text-white disabled:opacity-40"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </form>
        <div className="mt-1.5 flex items-center justify-between gap-2 px-1 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1">
            <LockIcon size={11} /> Filtered for {viewer.shortName}
            <button type="button" onClick={onOpenCircle} className="font-semibold text-plum hover:underline">
              Circle
            </button>
          </span>
          {thread.length ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => care.clearAskThread()}
              className="font-semibold text-muted hover:text-ink disabled:opacity-40"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ThreadBubble({
  msg,
  agent,
  textSize,
  sourcesOpen,
  setSourcesOpen,
  isLatestAssistant,
  onOpenCircle,
}: {
  msg: AskThreadMessage;
  agent: Person;
  textSize: string;
  sourcesOpen: boolean;
  setSourcesOpen: (fn: (v: boolean) => boolean) => void;
  isLatestAssistant: boolean;
  onOpenCircle: () => void;
}) {
  if (msg.role === "user") {
    return (
      <div className="rise flex items-end justify-end gap-2">
        <div className={`max-w-[88%] sm:max-w-[75%] rounded-2xl rounded-br-md bg-moss px-3.5 py-2.5 ${textSize} text-white`}>
          {msg.text}
        </div>
      </div>
    );
  }

  const run = msg.run;
  const citations = run?.answer?.citations || [];
  const policyNotice = run?.answer?.policyNotice;
  const showPolicy = Boolean(policyNotice && !/^Remembered:/i.test(policyNotice));
  const hasChart = Boolean(run?.answer?.visualisationSpec?.points?.length);
  const hasFacts = Boolean(run?.answer?.facts?.length);
  const hasSources = citations.length > 0;
  const hasUncertainty = Boolean(run?.answer?.uncertainty);
  const hasExtras = isLatestAssistant && (showPolicy || hasChart || hasFacts || hasSources || hasUncertainty);

  return (
    <div className="rise flex items-end gap-2">
      <Avatar person={agent} size={28} />
      <div className="flex max-w-[88%] sm:max-w-[75%] flex-col gap-1">
        <div className={`rounded-2xl rounded-bl-md bg-card px-3.5 py-2.5 ${textSize} text-ink shadow-sm ring-1 ring-line`}>
          <Prose text={msg.text} />
        </div>

        {hasExtras ? (
          <div className="flex flex-col gap-1.5 px-1">
            {showPolicy ? (
              <div className="rounded-xl border border-plum/25 bg-plum-soft px-3 py-2 text-[13px] text-ink">
                {policyNotice}{" "}
                <button type="button" className="font-semibold text-plum underline" onClick={onOpenCircle}>
                  Open Circle
                </button>
              </div>
            ) : null}

            {hasChart ? (
              <div className="overflow-hidden rounded-xl border border-line bg-paper p-2">
                <ResultChart
                  title={run.answer.visualisationSpec.title}
                  unit={run.answer.visualisationSpec.unit}
                  points={run.answer.visualisationSpec.points}
                  referenceLow={run.answer.visualisationSpec.referenceLow}
                  referenceHigh={run.answer.visualisationSpec.referenceHigh}
                  referenceLabel={run.answer.visualisationSpec.referenceLabel}
                />
              </div>
            ) : null}

            {hasFacts ? (
              <details>
                <summary className="cursor-pointer text-[11px] font-semibold text-plum hover:bg-plum-soft rounded-full px-2 py-0.5 inline-flex">
                  Key points
                </summary>
                <ul className="mt-1 list-disc space-y-1 rounded-xl border border-line bg-paper p-2 pl-5 text-[12px] text-muted">
                  {run.answer.facts.slice(0, 6).map((f: { text: string }, i: number) => (
                    <li key={i}>{f.text}</li>
                  ))}
                </ul>
              </details>
            ) : null}

            {hasSources ? (
              <div>
                <button
                  type="button"
                  onClick={() => setSourcesOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold text-plum hover:bg-plum-soft"
                >
                  <KindredMark size={12} />
                  {sourcesOpen ? "Hide sources" : `Sources · ${citations.length}`}
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    className={`transition ${sourcesOpen ? "rotate-180" : ""}`}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {sourcesOpen ? (
                  <ul className="mt-1 space-y-1 rounded-xl border border-line bg-paper p-2 text-[11px] leading-snug text-muted">
                    {citations.map((c: { evidenceId: string; title: string; date?: string }) => (
                      <li key={c.evidenceId} className="flex items-start gap-2">
                        <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-moss" />
                        <span>
                          {c.title.replace(/^Clinical Document:\s*/i, "")}
                          {c.date ? ` · ${c.date.slice(0, 10)}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {hasUncertainty ? (
              <p className="text-[11px] leading-relaxed text-muted">{run.answer.uncertainty}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
