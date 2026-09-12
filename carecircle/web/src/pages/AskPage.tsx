import { FormEvent, useState } from 'react';
import ResultChart from '../components/ResultChart';
import { useApp } from '../lib/state';

export default function AskPage() {
  const app = useApp();
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const run = app.lastAnswer;

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

  const answerText = busy && app.askStreamText ? app.askStreamText : run?.answer?.answer;
  const citations = run?.answer?.citations || [];

  return (
    <div className="grid-2">
      <div className="panel stack">
        <h1 style={{ fontFamily: 'var(--serif)', marginTop: 0 }}>Ask CareCircle</h1>
        <p className="muted small">
          Live evidence for <strong>{app.session?.selectedPatientId}</strong>, filtered for{' '}
          <strong>{app.session?.activeViewerId}</strong>
          {app.askTransport ? (
            <>
              {' '}
              · <strong>{app.askTransport === 'ws' ? 'WebSocket' : 'REST'}</strong>
            </>
          ) : null}
          .
        </p>

        {!run && !busy ? (
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

        {busy && !app.askStreamText ? (
          <div className="info-banner">{app.askStatus || 'Retrieving evidence and checking consent…'}</div>
        ) : null}

        {answerText ? (
          <article className="answer stack">
            <div className="answer-prose" style={{ whiteSpace: 'pre-wrap', fontSize: '1.05rem', lineHeight: 1.45 }}>
              {answerText}
              {busy ? <span className="stream-caret">▍</span> : null}
            </div>

            {!busy && memoryLine ? <p className="muted small">{memoryLine}</p> : null}

            {!busy && run?.answer?.policyNotice && !/^Remembered:/i.test(run.answer.policyNotice) ? (
              <div className="info-banner">{run.answer.policyNotice}</div>
            ) : null}

            {!busy && run?.answer?.facts?.length ? (
              <div>
                <div className="section-title">Key points from the record</div>
                <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem' }}>
                  {run.answer.facts.slice(0, 8).map((f: { text: string }, i: number) => (
                    <li key={i}>{f.text}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {!busy && run?.answer?.visualisationSpec?.points?.length ? (
              <ResultChart
                title={run.answer.visualisationSpec.title}
                unit={run.answer.visualisationSpec.unit}
                points={run.answer.visualisationSpec.points}
                referenceLow={run.answer.visualisationSpec.referenceLow}
                referenceHigh={run.answer.visualisationSpec.referenceHigh}
                referenceLabel={run.answer.visualisationSpec.referenceLabel}
              />
            ) : null}

            {!busy && run?.answer?.appointmentAssist ? (
              <div className="info-banner">
                Appointment: <strong>{run.answer.appointmentAssist.stage}</strong> —{' '}
                {run.answer.appointmentAssist.notice}
              </div>
            ) : null}

            {!busy && citations.length ? (
              <div>
                <button type="button" className="secondary" onClick={() => setSourcesOpen((v) => !v)}>
                  {sourcesOpen ? 'Hide sources' : `Sources (${citations.length})`}
                </button>
                {sourcesOpen ? (
                  <div className="pill-row" style={{ marginTop: '0.5rem' }}>
                    {citations.map((c: { evidenceId: string; title: string; date?: string }) => (
                      <button key={c.evidenceId} type="button" className="chip" onClick={() => app.openSource(c)}>
                        {c.title}
                        {c.date ? ` · ${formatSourceDate(c.date)}` : ''}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {!busy && run?.answer?.uncertainty ? (
              <p className="muted small" style={{ marginBottom: 0 }}>
                {run.answer.uncertainty}
              </p>
            ) : null}

            {!busy && run ? (
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
          </article>
        ) : null}

        <form className="composer" onSubmit={onSubmit}>
          <label className="field" htmlFor="ask">
            Ask about care, results or what happens next
          </label>
          <textarea
            id="ask"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. Explain my latest blood tests"
          />
          <button type="submit" disabled={busy || !question.trim()}>
            {busy ? 'Working…' : 'Ask'}
          </button>
        </form>
      </div>

      <div className="panel stack">
        <div className="section-title">Live context</div>
        <p className="muted small">
          {app.context?.resourceCount ?? 0} resources · {app.context?.measurementCount ?? 0} measurements · fetched{' '}
          {app.context?.fetchedAt ? new Date(app.context.fetchedAt).toLocaleString() : '—'}
        </p>
        <button type="button" className="secondary" onClick={() => app.refreshContext()}>
          Refresh
        </button>
        <div className="section-title">Try same question as another viewer</div>
        <p className="muted small">Switch the viewer above, then ask again to observe consent boundaries.</p>
      </div>
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
