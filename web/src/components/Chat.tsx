"use client";

import { useEffect, useRef, useState } from "react";
import type { AppState, Message, ToolTrace } from "@/lib/types";
import { personById, visibleMessages } from "@/lib/types";
import type { KindredActions } from "@/hooks/useKindred";
import { Avatar, KindredMark, LockIcon, Prose, fmtDay, fmtTime } from "./ui";
import ResultChart from "./clinical/ResultChart";
import type { AgentAnswer } from "@/lib/carecircle/server/types/domain";

export default function Chat({
  state,
  actions,
  threadId,
  viewerId,
  big = false,
  suggestions = [],
  canCompose = true,
  onOpenCircle,
}: {
  state: AppState;
  actions: KindredActions;
  threadId: string;
  viewerId: string;
  big?: boolean;
  suggestions?: string[];
  canCompose?: boolean;
  onOpenCircle?: () => void;
}) {
  const thread = state.threads[threadId];
  const msgs = visibleMessages(state, threadId, viewerId);
  const [pending, setPending] = useState(false);
  const busy = pending || state.busyThreads.includes(threadId);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);
  const lastText = useRef("");

  useEffect(() => {
    if (thread.kind !== "direct") return;
    const key = `kindred.draftQuestion:${state.patient.simId}:${viewerId}`;
    const saved = sessionStorage.getItem(key);
    if (saved) {
      setDraft(saved);
      sessionStorage.removeItem(key);
    }
  }, [state.patient.simId, viewerId, thread.kind]);

  useEffect(() => {
    const last = msgs[msgs.length - 1];
    if (msgs.length !== lastCount.current || (last && last.text !== lastText.current)) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      lastCount.current = msgs.length;
      lastText.current = last?.text ?? "";
    }
  }, [msgs]);

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setPending(true);
    setDraft("");
    setErr(null);
    try {
      await actions.sendChat(threadId, viewerId, text.trim());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  const isGroup = thread.kind === "group";
  const latestAnswerId = [...msgs].reverse().find(m => m.clinicalAnswer)?.id;
  const clear = async () => {
    if (busy) return;
    setPending(true);
    setErr(null);
    try {
      await actions.clearChat(threadId, viewerId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };
  const textSize = big ? "text-[17px] leading-relaxed" : "text-[15px] leading-relaxed";

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper lg:overflow-hidden lg:rounded-2xl lg:border lg:border-line lg:bg-card/40">
      <div className="scroll-thin flex-1 space-y-3 overflow-y-auto px-3 pb-3 pt-4 sm:px-5">
        {msgs.length === 0 && (
          <div className="mt-10 text-center text-sm text-muted">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-plum-soft text-plum"><KindredMark size={26} /></div>
            Ask Kindred anything about {viewerId === state.patientId ? "your" : `${personById(state, state.patientId).shortName}'s`} care — results, appointments, sharing and what matters to you.
          </div>
        )}
        {msgs.map((m, i) => {
          const sender = personById(state, m.senderId);
          const mine = m.senderId === viewerId;
          const isAgent = sender.role === "agent";
          const prev = msgs[i - 1];
          const showDay = !prev || fmtDay(prev.ts) !== fmtDay(m.ts);
          return (
            <div key={m.id} className="rise">
              {showDay && <div className="my-3 text-center text-[11px] font-semibold uppercase tracking-wider text-muted">{fmtDay(m.ts)}</div>}
              <div className={`flex items-end gap-2 ${mine ? "flex-row-reverse" : ""}`}>
                {!mine && <Avatar person={sender} size={big ? 34 : 28} />}
                <div className={`max-w-[88%] sm:max-w-[75%] ${mine ? "items-end" : "items-start"} flex flex-col gap-1`}>
                  {isGroup && !mine && <span className="px-1 text-[11px] font-semibold" style={{ color: sender.color }}>{sender.shortName}</span>}
                  <div
                    className={`rounded-2xl px-3.5 py-2.5 ${textSize} ${
                      mine ? "rounded-br-md bg-moss text-white" : isAgent ? (m.kind === "notification" ? "rounded-bl-md border border-plum/25 bg-plum-soft text-ink" : "rounded-bl-md bg-card text-ink shadow-sm ring-1 ring-line") : "rounded-bl-md bg-card text-ink ring-1 ring-line"
                    }`}
                  >
                    {m.text ? <Prose text={m.text} /> : <span className="pulse-soft text-muted">Kindred is thinking…</span>}
                    {m.streaming && m.text && <span className="pulse-soft ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 rounded-sm bg-plum/60" />}
                  </div>
                  <div className="flex items-center gap-2 px-1 text-[11px] text-muted">
                    <span>{fmtTime(m.ts)}</span>
                    {m.audience && viewerId === state.patientId && (
                      <span className="inline-flex items-center gap-1 text-plum"><LockIcon size={11} /> seen by {m.audience.filter((a) => a !== state.patientId).map((a) => personById(state, a).shortName).join(", ") || "only you"}</span>
                    )}
                    {m.audience && viewerId !== state.patientId && m.audience.length <= 2 && (
                      <span className="inline-flex items-center gap-1 text-plum"><LockIcon size={11} /> only you</span>
                    )}
                  </div>
                  {isAgent && m.id === latestAnswerId && m.clinicalAnswer && <ClinicalAnswerDetails answer={m.clinicalAnswer} onOpenCircle={onOpenCircle} />}
                  {isAgent && m.trace && m.trace.length > 0 && <TraceDisclosure trace={m.trace} state={state} />}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {canCompose && (
        <div className="border-t border-line bg-card/90 p-2.5 backdrop-blur sm:p-3">
          {suggestions.length > 0 && msgs.filter((m) => m.senderId === viewerId).length === 0 && (
            <div className="scroll-thin mb-2 flex gap-2 overflow-x-auto pb-1">
              {suggestions.map((s) => (
                <button key={s} onClick={() => send(s)} disabled={busy} className="shrink-0 rounded-full border border-plum/30 bg-plum-soft px-3 py-1.5 text-xs font-semibold text-plum hover:brightness-95 disabled:opacity-50">
                  {s}
                </button>
              ))}
            </div>
          )}
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
          >
            <textarea
              aria-label={isGroup ? "Message the family" : "Ask Kindred"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(draft);
                }
              }}
              rows={1}
              placeholder={isGroup ? "Message the family" : "Ask Kindred…"}
              className={`max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border border-line bg-paper px-4 py-2.5 text-base ${big ? "sm:text-[17px]" : "sm:text-[15px]"} outline-none focus:border-plum`}
            />
            <button type="submit" disabled={busy || !draft.trim()} aria-label="Send" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-plum text-white disabled:opacity-40">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          </form>
          {!isGroup && <div className="mt-1.5 flex items-center justify-between gap-2 px-1 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1"><LockIcon size={11} /> Filtered for {personById(state, viewerId).shortName}
              {onOpenCircle && <button type="button" onClick={onOpenCircle} className="font-semibold text-plum hover:underline">Circle</button>}
            </span>
            {msgs.some(m => m.kind === "chat") && <button type="button" disabled={busy} onClick={() => void clear()} className="font-semibold hover:text-ink disabled:opacity-40">Clear conversation</button>}
          </div>}
          {err && <div className="mt-2 text-xs text-rust">{err}</div>}
        </div>
      )}
    </div>
  );
}

function ClinicalAnswerDetails({ answer, onOpenCircle }: { answer: AgentAnswer; onOpenCircle?: () => void }) {
  const chart = answer.visualisationSpec;
  return (
    <div className="flex w-full flex-col gap-1.5 px-1">
      {answer.policyNotice && <div className="rounded-xl border border-plum/25 bg-plum-soft px-3 py-2 text-[13px] text-ink">
        {answer.policyNotice}{" "}
        {onOpenCircle && <button type="button" onClick={onOpenCircle} className="font-semibold text-plum underline">Open Circle</button>}
      </div>}
      {chart?.points?.length ? <div className="overflow-hidden rounded-xl border border-line bg-paper p-2"><ResultChart {...chart} points={chart.points} /></div> : null}
      {answer.facts.length > 0 && <details><summary className="cursor-pointer text-[11px] font-semibold text-plum">Key points</summary>
        <ul className="mt-1 list-disc space-y-1 rounded-xl border border-line bg-paper p-2 pl-5 text-[12px] text-muted">{answer.facts.map((fact, i) => <li key={i}>{fact.text}</li>)}</ul>
      </details>}
      {answer.citations.length > 0 && <details><summary className="cursor-pointer text-[11px] font-semibold text-plum">Sources · {answer.citations.length}</summary>
        <ul className="mt-1 space-y-1 rounded-xl border border-line bg-paper p-2 text-[11px] leading-snug text-muted">{answer.citations.map(source => <li key={source.evidenceId}>{source.title}{source.date ? ` · ${source.date.slice(0, 10)}` : ""}</li>)}</ul>
      </details>}
      {answer.uncertainty && <p className="text-[11px] leading-relaxed text-muted">{answer.uncertainty}</p>}
    </div>
  );
}

function TraceDisclosure({ trace, state }: { trace: ToolTrace[]; state: AppState }) {
  const [open, setOpen] = useState(false);
  const denied = trace.filter((t) => t.consentCheck && !t.consentCheck.allowed).length;
  return (
    <div className="max-w-full">
      <button onClick={() => setOpen(!open)} className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold text-plum hover:bg-plum-soft">
        <KindredMark size={12} /> How I worked this out · {trace.length} step{trace.length === 1 ? "" : "s"}
        {denied > 0 && <span className="inline-flex items-center gap-0.5 rounded-full bg-plum-soft px-1.5"><LockIcon size={10} /> {denied} withheld</span>}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className={`transition ${open ? "rotate-180" : ""}`}><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <ol className="mt-1 space-y-1 rounded-xl border border-line bg-paper p-2 font-mono text-[11px] leading-snug text-muted">
          {trace.map((t, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${t.ok ? "bg-moss" : "bg-rust"}`} />
              <span className="min-w-0 flex-1">
                <span className="text-ink">{t.name}</span>
                {Object.keys(t.input as object).length > 0 && <span className="opacity-70"> {JSON.stringify(t.input)}</span>}
                <br />
                {t.consentCheck && (
                  <span className={t.consentCheck.allowed ? "text-moss-deep" : "text-plum"}>
                    consent: {personById(state, t.consentCheck.granteeId).shortName} → {t.consentCheck.category} {t.consentCheck.allowed ? "✓ allowed" : "✗ not shared"}
                  </span>
                )}
                {!t.consentCheck && <span>{t.summary}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export type { Message };
