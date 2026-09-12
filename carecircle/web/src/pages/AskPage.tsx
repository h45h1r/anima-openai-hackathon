import { FormEvent, useState } from 'react';
import ResultChart from '../components/ResultChart';
import { useApp } from '../lib/state';

export default function AskPage() {
  const app = useApp();
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const run = app.lastAnswer;

  async function submit(q: string) {
    setBusy(true);
    setLocalError(null);
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

  return (
    <div className="grid-2">
      <div className="panel stack">
        <h1 style={{ fontFamily: 'var(--serif)', marginTop: 0 }}>Ask CareCircle</h1>
        <p className="muted small">
          Answers retrieve live evidence for <strong>{app.session?.selectedPatientId}</strong>, apply consent for{' '}
          <strong>{app.session?.activeViewerId}</strong>, then explain with citations. Prompt identity claims are ignored.
        </p>

        {!run ? (
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

        {localError ? <div className="error-banner">{localError}</div> : null}
        {busy ? <div className="info-banner">Retrieving evidence and checking consent…</div> : null}

        {run ? (
          <article className="answer">
            <h2>{run.answer.answer}</h2>
            {run.answer.policyNotice ? <div className="info-banner">{run.answer.policyNotice}</div> : null}
            {run.answer.facts?.length ? (
              <div>
                <div className="section-title">What the record says</div>
                <ul>
                  {run.answer.facts.map((f: any, i: number) => (
                    <li key={i}>{f.text}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {run.answer.uncertainty ? (
              <div>
                <div className="section-title">Uncertainty</div>
                <p className="muted">{run.answer.uncertainty}</p>
              </div>
            ) : null}
            {run.answer.recordedNextStep ? (
              <div>
                <div className="section-title">Recorded next step</div>
                <p>{run.answer.recordedNextStep.text}</p>
              </div>
            ) : null}
            {run.answer.appointmentAssist ? (
              <div className="info-banner">
                Appointment stage: <strong>{run.answer.appointmentAssist.stage}</strong> —{' '}
                {run.answer.appointmentAssist.notice}
                {run.answer.appointmentAssist.availableSlots?.length ? (
                  <ul>
                    {run.answer.appointmentAssist.availableSlots.map((s: any, i: number) => (
                      <li key={i}>
                        {s.startsAt}
                        {s.clinician ? ` · ${s.clinician}` : ''}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {run.answer.visualisationSpec?.points?.length ? (
              <ResultChart
                title={run.answer.visualisationSpec.title}
                unit={run.answer.visualisationSpec.unit}
                points={run.answer.visualisationSpec.points}
                referenceLow={run.answer.visualisationSpec.referenceLow}
                referenceHigh={run.answer.visualisationSpec.referenceHigh}
                referenceLabel={run.answer.visualisationSpec.referenceLabel}
              />
            ) : null}
            <div>
              <div className="section-title">Sources</div>
              <div className="pill-row">
                {run.answer.citations?.map((c: any) => (
                  <button key={c.evidenceId} type="button" className="chip" onClick={() => app.openSource(c)}>
                    {c.title}
                    {c.date ? ` · ${new Date(c.date).toLocaleDateString('en-GB')}` : ''}
                  </button>
                ))}
              </div>
            </div>
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
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
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
