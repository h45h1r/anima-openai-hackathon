"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { AppState, Person } from "@/lib/types";
import { levelLabel } from "@/lib/levels";
import { Avatar, Button, KindredMark, Pill, Prose } from "../ui";
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
    setBusy(true);
    setSourcesOpen(false);
    try {
      await care.ask(q);
      setQuestion("");
    } catch {
      /* error surfaced on care.error */
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!question.trim() || busy) return;
    void submit(question.trim());
  }

  if (care.status === "booting" || care.status === "idle") {
    return (
      <div className="page">
        <h1 className="font-display text-[26px] font-bold sm:text-3xl">Ask</h1>
        <p className="mt-2 text-muted">Connecting clinical Ask…</p>
      </div>
    );
  }

  if (care.status === "needs_server") {
    return (
      <div className="page max-w-xl">
        <h1 className="font-display text-[26px] font-bold sm:text-3xl">Ask</h1>
        <p className="mt-2 text-[15px] text-muted">
          Clinical Ask runs inside Kindred. Add your Anima key and restart the app.
        </p>
        <div className="mt-4 rounded-2xl border border-line bg-card p-4 text-sm leading-relaxed">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Set <code className="rounded bg-paper px-1">ANIMA_API_KEY</code> in{" "}
              <code className="rounded bg-paper px-1">web/.env.local</code>
            </li>
            <li>
              Restart with <code className="rounded bg-paper px-1">npm run dev</code>
            </li>
            <li>Open Ask in this same Kindred tab</li>
          </ol>
          <Button className="mt-4" variant="plum" onClick={() => care.retry()}>
            Retry connect
          </Button>
        </div>
        {care.error ? <p className="mt-3 text-sm text-rust">{care.error}</p> : null}
      </div>
    );
  }

  const streamingText = busy ? care.askStreamText : "";
  const latestAssistant = [...thread].reverse().find((m) => m.role === "assistant");
  const run = latestAssistant?.run || care.lastAnswer;
  const citations = run?.answer?.citations || [];

  return (
    <div className="page">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[26px] font-bold leading-tight sm:text-3xl">Ask</h1>
          <p className="mt-1 text-[15px] text-muted">
            Grounded clinical answers for <strong>{care.session?.selectedPatientName || state.patient.name}</strong>,
            filtered for <strong>{viewer.shortName}</strong>. Access is managed in Circle.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="plum">{levelLabel(level)}</Pill>
          <Button variant="secondary" size="sm" onClick={onOpenCircle}>
            Open Circle
          </Button>
        </div>
      </div>

      {care.error ? (
        <div className="mb-4 rounded-2xl border border-rust/30 bg-[#f8e6df] px-4 py-3 text-sm text-rust">
          {care.error}{" "}
          <button type="button" className="font-semibold underline" onClick={() => care.clearError()}>
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-h-[420px] flex-col rounded-2xl border border-line bg-card/60">
          {!thread.length && !busy ? (
            <div className="border-b border-line p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted">Suggested</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(care.suggestions.length
                  ? care.suggestions
                  : [
                      "Explain my latest blood tests",
                      "What appointments are coming up?",
                      "What medicines am I on?",
                    ]
                ).map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={busy}
                    onClick={() => void submit(s)}
                    className="rounded-full border border-line bg-paper px-3 py-1.5 text-sm font-semibold hover:bg-card"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
            {thread.map((msg) => (
              <ThreadBubble
                key={msg.id}
                msg={msg}
                agent={agent}
                sourcesOpen={sourcesOpen}
                setSourcesOpen={setSourcesOpen}
                isLatestAssistant={msg.id === latestAssistant?.id && !busy}
                onOpenCircle={onOpenCircle}
              />
            ))}
            {busy && streamingText ? (
              <div className="flex items-end gap-2">
                <Avatar person={agent} size={28} />
                <div className="max-w-[88%] rounded-2xl rounded-bl-md bg-card px-3.5 py-2.5 text-[15px] leading-relaxed text-ink shadow-sm ring-1 ring-line sm:max-w-[75%]">
                  <Prose text={streamingText} />
                  <span className="pulse-soft ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 rounded-sm bg-plum/60" />
                </div>
              </div>
            ) : busy ? (
              <div className="flex items-end gap-2">
                <Avatar person={agent} size={28} />
                <div className="rounded-2xl rounded-bl-md bg-card px-3.5 py-2.5 text-sm text-muted shadow-sm ring-1 ring-line">
                  {care.askStatus || "Looking through the record…"}
                </div>
              </div>
            ) : null}
            <div ref={threadEnd} />
          </div>

          <form onSubmit={onSubmit} className="border-t border-line p-4">
            <label htmlFor="kindred-ask" className="sr-only">
              Ask about care
            </label>
            <textarea
              id="kindred-ask"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={2}
              placeholder={thread.length ? "e.g. What about my kidney results?" : "e.g. Explain my latest blood tests"}
              className="w-full resize-none rounded-2xl border border-line bg-paper px-4 py-3 text-[15px] outline-none focus:border-plum"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              {thread.length ? (
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => care.clearAskThread()}>
                  Clear conversation
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" variant="plum" disabled={busy || !question.trim()}>
                {busy ? "Working…" : "Ask"}
              </Button>
            </div>
          </form>
        </div>

        <aside className="space-y-3">
          <div className="rounded-2xl border border-line bg-card p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted">Viewer</div>
            <div className="mt-1 font-display text-lg font-bold">{viewer.name}</div>
            <p className="mt-1 text-sm text-muted">
              {viewer.relation || "Patient"} · Kindred sharing: {levelLabel(level)}
            </p>
            <p className="mt-2 text-sm text-muted">
              Switch personas with the account menu (<code className="text-xs">?as=</code>). Circle owns access.
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-card p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted">Live evidence</div>
            <p className="mt-1 text-sm text-muted">
              {care.context?.resourceCount ?? 0} resources · {care.context?.measurementCount ?? 0} measurements
            </p>
            <Button className="mt-3" variant="secondary" size="sm" onClick={() => void care.refresh()}>
              Refresh evidence
            </Button>
          </div>
          {citations.length ? (
            <div className="rounded-2xl border border-line bg-card p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted">Last sources</div>
              <ul className="mt-2 space-y-1 text-sm">
                {citations.slice(0, 6).map((c: { evidenceId: string; title: string }) => (
                  <li key={c.evidenceId}>{c.title}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <button
            type="button"
            onClick={onOpenCircle}
            className="w-full rounded-2xl border border-plum/30 bg-plum-soft p-4 text-left text-sm font-semibold text-plum"
          >
            Change who can see what → Circle
          </button>
        </aside>
      </div>
    </div>
  );
}

function ThreadBubble({
  msg,
  agent,
  sourcesOpen,
  setSourcesOpen,
  isLatestAssistant,
  onOpenCircle,
}: {
  msg: AskThreadMessage;
  agent: Person;
  sourcesOpen: boolean;
  setSourcesOpen: (fn: (v: boolean) => boolean) => void;
  isLatestAssistant: boolean;
  onOpenCircle: () => void;
}) {
  if (msg.role === "user") {
    return (
      <div className="flex items-end justify-end gap-2">
        <div className="max-w-[88%] rounded-2xl rounded-br-md bg-moss px-3.5 py-2.5 text-[15px] leading-relaxed text-white sm:max-w-[75%]">
          {msg.text}
        </div>
      </div>
    );
  }

  const run = msg.run;
  const citations = run?.answer?.citations || [];
  const hasExtras =
    isLatestAssistant &&
    Boolean(
      (run?.answer?.policyNotice && !/^Remembered:/i.test(run.answer.policyNotice)) ||
        run?.answer?.facts?.length ||
        run?.answer?.visualisationSpec?.points?.length ||
        citations.length ||
        run?.answer?.uncertainty,
    );

  return (
    <div className="flex items-end gap-2">
      <Avatar person={agent} size={28} />
      <div className="flex max-w-[88%] flex-col gap-1 sm:max-w-[75%]">
        <div className="rounded-2xl rounded-bl-md bg-card px-3.5 py-2.5 text-[15px] leading-relaxed text-ink shadow-sm ring-1 ring-line">
          <Prose text={msg.text} />
        </div>

        {hasExtras ? (
          <div className="mt-1 space-y-2 border-t border-line/70 pt-2">
            {isLatestAssistant && run?.answer?.policyNotice && !/^Remembered:/i.test(run.answer.policyNotice) ? (
              <div className="rounded-xl bg-plum-soft/70 px-3 py-2 text-sm text-plum">
                {run.answer.policyNotice}{" "}
                <button type="button" className="font-semibold underline" onClick={onOpenCircle}>
                  Open Circle
                </button>
              </div>
            ) : null}

            {isLatestAssistant && run?.answer?.facts?.length ? (
              <details className="group">
                <summary className="cursor-pointer text-[12px] font-semibold text-muted hover:text-ink">
                  Key points from the record
                </summary>
                <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-muted">
                  {run.answer.facts.slice(0, 8).map((f: { text: string }, i: number) => (
                    <li key={i}>{f.text}</li>
                  ))}
                </ul>
              </details>
            ) : null}

            {isLatestAssistant && run?.answer?.visualisationSpec?.points?.length ? (
              <div className="pt-1">
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

            {isLatestAssistant && citations.length ? (
              <div>
                <button
                  type="button"
                  onClick={() => setSourcesOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold text-plum hover:bg-plum-soft"
                >
                  <KindredMark size={12} />
                  {sourcesOpen ? "Hide sources" : `Sources · ${citations.length}`}
                </button>
                {sourcesOpen ? (
                  <ul className="mt-1.5 space-y-1 text-[12px] text-muted">
                    {citations.map((c: { evidenceId: string; title: string; date?: string }) => (
                      <li key={c.evidenceId}>
                        {c.title}
                        {c.date ? ` · ${c.date.slice(0, 10)}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {isLatestAssistant && run?.answer?.uncertainty ? (
              <p className="text-[12px] leading-relaxed text-muted">{run.answer.uncertainty}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
