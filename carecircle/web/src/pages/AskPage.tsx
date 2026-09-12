import { FormEvent, useEffect, useRef, useState } from 'react';
import ResultChart from '../components/ResultChart';
import { useApp, type AskThreadMessage } from '../lib/state';

export default function AskPage() {
  const app = useApp();
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const threadEnd = useRef<HTMLDivElement | null>(null);
  const run = app.lastAnswer;
  const thread = app.askThread;

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [thread.length, app.askStreamText, busy]);

  async function submit(q: string) {
    setBusy(true);
    setLocalError(null);
    setSourcesOpen(false);
    try {
      await app.ask(q);
      setQuestion('');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Ask failed');
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    void submit(question.trim());
  }

  const written = (app.memoriesWritten?.length ? app.memoriesWritten : run?.memoriesWritten) || [];
  const used = run?.memoriesUsed || [];
  const memoryLine = written.length
    ? `Remembered for next time: ${written.map((m: { text: string }) => m.text).join(' · ')}`
    : used.length
      ? `Using your preference: ${used.map((m: { text: string }) => m.text).join(' · ')}`
      : null;

  const streamingText = busy ? app.askStreamText : '';
  const latestAssistant = [...thread].reverse().find((m) => m.role === 'assistant');
  const citations = (latestAssistant?.run || run)?.answer?.citations || [];

  const viewerId = app.session?.activeViewerId || 'patient';
  const viewer = app.policy?.viewers?.find((v: { viewerId: string }) => v.viewerId === viewerId);
  const grants =
    app.policy?.grants?.filter(
      (g: { viewerId: string; allowed: boolean; revokedAt?: string }) =>
        g.viewerId === viewerId && g.allowed && !g.revokedAt,
    ) || [];
  const disclosures: { resourceId: string; state: string; changedAt: string }[] =
    app.policy?.disclosures || [];
  const heldIds = new Set<string>();
  const byResource = new Map<string, { resourceId: string; state: string; changedAt: string }>();
  for (const d of disclosures) {
    const prev = byResource.get(d.resourceId);
    if (!prev || d.changedAt > prev.changedAt) byResource.set(d.resourceId, d);
  }
  for (const d of byResource.values()) {
    if (d.state === 'held') heldIds.add(d.resourceId);
  }
  const heldCount = heldIds.size;
  const prefs = [
    ...(used || []),
    ...(written || []),
  ].filter((m: { text?: string }, i: number, arr: { text?: string }[]) =>
    m.text && arr.findIndex((x) => x.text === m.text) === i,
  );

  return (
    <div className="grid-2">
      <div className="panel stack">
        <h1 className="page-title">Ask CareCircle</h1>
        <p className="muted small">
          Conversation for <strong>{app.session?.selectedPatientName || app.session?.selectedPatientId}</strong>,
          filtered for <strong>{viewerId}</strong>
          {app.askTransport ? (
            <>
              {' '}
              · <strong>{app.askTransport === 'ws' ? 'WebSocket' : 'REST'}</strong>
            </>
          ) : null}
          . Follow-ups like “what about potassium?” use this thread plus live evidence.
        </p>

        {!thread.length && !busy ? (
          <div className="stack">
            <div className="section-title">Suggested from available records</div>
            <div className="pill-row">
              {(app.suggestions || []).map((s) => (
                <button key={s} type="button" className="chip" onClick={() => submit(s)} disabled={busy}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {localError ? (
          <div className="error-banner">
            {localError}{' '}
            <button
              type="button"
              className="secondary"
              disabled={busy || !question.trim()}
              onClick={() => void submit(question.trim() || 'What is recorded in my care?')}
            >
              Retry
            </button>
          </div>
        ) : null}

        {thread.length || streamingText || busy ? (
          <div className="ask-thread" aria-live="polite">
            {thread.map((msg) => (
              <ThreadBubble
                key={msg.id}
                msg={msg}
                memoryLine={msg.id === latestAssistant?.id ? memoryLine : null}
                sourcesOpen={sourcesOpen}
                setSourcesOpen={setSourcesOpen}
                openSource={app.openSource}
                isLatestAssistant={msg.id === latestAssistant?.id && !busy}
              />
            ))}
            {busy && streamingText ? (
              <div className="thread-bubble assistant">
                <div className="thread-role">CareCircle</div>
                <div className="answer-prose" style={{ whiteSpace: 'pre-wrap' }}>
                  {streamingText}
                  <span className="stream-caret">▍</span>
                </div>
              </div>
            ) : busy ? (
              <div className="thread-bubble assistant">
                <div className="thread-role">CareCircle</div>
                <div className="muted small" style={{ margin: 0 }}>
                  {app.askStatus || 'Retrieving…'}
                </div>
              </div>
            ) : null}
            <div ref={threadEnd} />
          </div>
        ) : null}

        {thread.length ? (
          <button type="button" className="secondary" onClick={() => app.clearAskThread()} disabled={busy}>
            Clear conversation
          </button>
        ) : null}

        <form className="composer" onSubmit={onSubmit}>
          <label className="field" htmlFor="ask">
            Ask about care, results or what happens next
          </label>
          <textarea
            id="ask"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={
              thread.length
                ? 'e.g. What about my kidney results?'
                : 'e.g. Explain my latest blood tests'
            }
          />
          <button type="submit" disabled={busy || !question.trim()}>
            {busy ? 'Working…' : 'Ask'}
          </button>
        </form>
      </div>

      <div className="panel stack">
        <div className="section-title">Who can see what</div>
        <p className="muted small" style={{ marginTop: 0 }}>
          Snapshot of consent and grounding for this ask — not a second copy of the answer. Open Sources under a reply for cited records.
        </p>

        <div className="context-card">
          <div className="muted small">Active viewer</div>
          <strong>
            {viewer?.displayName || viewerId}
            {viewer?.relationship ? ` · ${viewer.relationship}` : ''}
          </strong>
        </div>

        <div className="context-card">
          <div className="muted small">Shared with this viewer</div>
          {grants.length ? (
            <div className="pill-row">
              {grants.slice(0, 8).map((g: { informationClass: string }) => (
                <span key={g.informationClass} className="chip" style={{ cursor: 'default' }}>
                  {g.informationClass.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          ) : (
            <p className="muted small" style={{ margin: 0 }}>
              No class grants listed (patient self has full access).
            </p>
          )}
        </div>

        <div className="context-card">
          <div className="muted small">Held results</div>
          <strong>{heldCount}</strong>
          <p className="muted small" style={{ margin: '0.25rem 0 0' }}>
            New labs can be held until the patient clears disclosure for family viewers.
          </p>
        </div>

        <div className="context-card">
          <div className="muted small">Live Anima pull</div>
          <p className="muted small" style={{ margin: 0 }}>
            {app.context?.resourceCount ?? 0} resources · {app.context?.measurementCount ?? 0} measurements
            <br />
            Fetched {app.context?.fetchedAt ? new Date(app.context.fetchedAt).toLocaleString() : '—'}
          </p>
          <button type="button" className="secondary" style={{ marginTop: '0.5rem' }} onClick={() => app.refreshContext()}>
            Refresh evidence
          </button>
        </div>

        {citations.length ? (
          <div className="context-card">
            <div className="muted small">Last answer sources</div>
            <div className="pill-row">
              {citations.slice(0, 6).map((c: { evidenceId: string; title: string }) => (
                <button key={c.evidenceId} type="button" className="chip" onClick={() => app.openSource(c)}>
                  {c.title}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {prefs.length ? (
          <div className="context-card">
            <div className="muted small">Remembered prefs</div>
            <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem' }}>
              {prefs.slice(0, 4).map((m: { id?: string; text: string }, i: number) => (
                <li key={m.id || i} className="small">
                  {m.text}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="section-title">Consent check</div>
        <p className="muted small">
          Switch the viewer above, then ask again — the thread resets per viewer so Tom cannot inherit Sarah’s answers.
        </p>
      </div>
    </div>
  );
}

function ThreadBubble({
  msg,
  memoryLine,
  sourcesOpen,
  setSourcesOpen,
  openSource,
  isLatestAssistant,
}: {
  msg: AskThreadMessage;
  memoryLine: string | null;
  sourcesOpen: boolean;
  setSourcesOpen: (fn: (v: boolean) => boolean) => void;
  openSource: (c: any) => void;
  isLatestAssistant: boolean;
}) {
  if (msg.role === 'user') {
    return (
      <div className="thread-bubble user">
        <div className="thread-role">You</div>
        <div>{msg.text}</div>
      </div>
    );
  }

  const run = msg.run;
  const citations = run?.answer?.citations || [];

  return (
    <div className="thread-bubble assistant">
      <div className="thread-role">CareCircle</div>
      <div className="answer-prose" style={{ whiteSpace: 'pre-wrap' }}>
        {msg.text}
      </div>

      {isLatestAssistant && memoryLine ? <p className="muted small">{memoryLine}</p> : null}

      {isLatestAssistant && run?.answer?.policyNotice && !/^Remembered:/i.test(run.answer.policyNotice) ? (
        <div className="info-banner">{run.answer.policyNotice}</div>
      ) : null}

      {isLatestAssistant && run?.answer?.facts?.length ? (
        <details>
          <summary className="muted small">Key points from the record</summary>
          <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem' }}>
            {run.answer.facts.slice(0, 8).map((f: { text: string }, i: number) => (
              <li key={i}>{f.text}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {isLatestAssistant && run?.answer?.visualisationSpec?.points?.length ? (
        <ResultChart
          title={run.answer.visualisationSpec.title}
          unit={run.answer.visualisationSpec.unit}
          points={run.answer.visualisationSpec.points}
          referenceLow={run.answer.visualisationSpec.referenceLow}
          referenceHigh={run.answer.visualisationSpec.referenceHigh}
          referenceLabel={run.answer.visualisationSpec.referenceLabel}
        />
      ) : null}

      {isLatestAssistant && run?.answer?.appointmentAssist ? (
        <div className="info-banner">
          Appointment: <strong>{run.answer.appointmentAssist.stage}</strong> —{' '}
          {run.answer.appointmentAssist.notice}
        </div>
      ) : null}

      {isLatestAssistant && citations.length ? (
        <div>
          <button type="button" className="secondary" onClick={() => setSourcesOpen((v) => !v)}>
            {sourcesOpen ? 'Hide sources' : `Sources (${citations.length})`}
          </button>
          {sourcesOpen ? (
            <div className="pill-row" style={{ marginTop: '0.5rem' }}>
              {citations.map((c: { evidenceId: string; title: string; date?: string }) => (
                <button key={c.evidenceId} type="button" className="chip" onClick={() => openSource(c)}>
                  {c.title}
                  {c.date ? ` · ${formatSourceDate(c.date)}` : ''}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {isLatestAssistant && run?.answer?.uncertainty ? (
        <p className="muted small" style={{ marginBottom: 0 }}>
          {run.answer.uncertainty}
        </p>
      ) : null}

      {isLatestAssistant && run ? (
        <details>
          <summary className="muted">How this answer was made</summary>
          <pre className="trace">
            {JSON.stringify(
              {
                model: run.model,
                promptVersion: run.promptVersion,
                policy: run.policy,
                tools: run.tools,
                latencyMs: run.latencyMs,
                memoriesUsed: run.memoriesUsed,
                memoriesWritten: run.memoriesWritten,
              },
              null,
              2,
            )}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

function formatSourceDate(iso: string): string {
  const day = iso.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }
  return new Date(iso).toLocaleDateString('en-GB');
}
