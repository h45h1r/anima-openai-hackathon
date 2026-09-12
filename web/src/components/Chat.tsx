"use client";

import { useEffect, useRef, useState } from "react";
import type { AppState, ToolTrace } from "@/lib/types";
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
  const committedMessages = visibleMessages(state, threadId, viewerId);
  const [pending, setPending] = useState(false);
  const outgoing = actions.getPendingChat(threadId, viewerId);
  const sendLock = useRef(false);
  const outgoingCommitted = outgoing && committedMessages.some(message =>
    !outgoing.knownIds.has(message.id) && message.senderId === viewerId && message.text === outgoing.message.text);
  const msgs = outgoing && !outgoingCommitted ? [...committedMessages, outgoing.message] : committedMessages;
  const replyVisible = outgoing && committedMessages.some(message => outgoing.replyId
    ? message.id === outgoing.replyId
    : !outgoing.knownIds.has(message.id) && message.senderId === state.agentId && message.kind === "chat" && !message.streaming);
  const busy = pending || Boolean(outgoing) || state.busyThreads.includes(threadId);
  const showTyping = Boolean(outgoing && !replyVisible && !committedMessages.some(message => message.streaming));
  const [draft, setDraft] = useState("");
  const [localError, setErr] = useState<string | null>(null);
  const failure = actions.getChatFailure(threadId, viewerId);
  const err = localError || failure?.error;
  const failedText = failure?.text;
  const scrollRef = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true);
  const lastMessage = msgs[msgs.length - 1];

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
    if (failure) setDraft(current => current || failure.text);
  }, [failure]);

  useEffect(() => {
    if (followBottom.current && scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "auto" });
    }
  }, [msgs.length, lastMessage?.id, lastMessage?.text, showTyping]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy || sendLock.current) return;
    sendLock.current = true;
    followBottom.current = true;
    setDraft(current => current.trim() === message ? "" : current);
    setErr(null);
    try {
      await actions.sendChat(threadId, viewerId, message);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setDraft(current => current || message);
    } finally {
      sendLock.current = false;
    }
  };

  const isGroup = thread.kind === "group";
  const latestAnswerId = [...msgs].reverse().find(m => m.clinicalAnswer)?.id;
  const clear = async () => {
    if (busy || sendLock.current) return;
    sendLock.current = true;
    setPending(true);
    setErr(null);
    try {
      await actions.clearChat(threadId, viewerId);
      actions.dismissChatFailure(threadId, viewerId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      sendLock.current = false;
      setPending(false);
    }
  };
  const textSize = big ? "text-[17px] leading-relaxed" : "text-[15px] leading-relaxed";

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper lg:overflow-hidden lg:rounded-2xl lg:border lg:border-line lg:bg-card/40">
      <div ref={scrollRef} role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions text"
        onScroll={event => { const el = event.currentTarget; followBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
        className="scroll-thin flex-1 space-y-3 overflow-y-auto px-3 pb-3 pt-4 sm:px-5">
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
                    {m.text ? <Prose text={m.text} /> : <span role="status" className="pulse-soft text-muted">Kindred is thinking…</span>}
                    {m.streaming && m.text && <span className="pulse-soft ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 rounded-sm bg-plum/60" />}
                  </div>
                  <div className="flex items-center gap-2 px-1 text-[11px] text-muted">
                    <span>{fmtTime(m.ts)}</span>
                    {m.id === outgoing?.message.id && <span className="text-moss-deep">{outgoing.replyId ? "Sent" : "Sending…"}</span>}
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
        {showTyping && <div className="rise flex items-end gap-2">
          <Avatar person={personById(state, state.agentId)} size={big ? 34 : 28} />
          <div role="status" className={`rounded-2xl rounded-bl-md bg-card px-3.5 py-2.5 ${textSize} text-muted shadow-sm ring-1 ring-line`}>
            <span className="pulse-soft">Kindred is thinking…</span>
          </div>
        </div>}
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
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
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
          {err && <div role="alert" className="mt-2 rounded-xl border border-rust/30 bg-[#f8e6df] px-3 py-2 text-sm text-rust">
            <p>{err}</p>
            {failedText && <>
              <p className="mt-1 whitespace-pre-wrap text-xs">Could not confirm delivery: {failedText}</p>
              <button type="button" disabled={busy} onClick={() => void send(failedText)} className="mt-2 font-semibold underline disabled:opacity-40">Retry message</button>
            </>}
          </div>}
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
