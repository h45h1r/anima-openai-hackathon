import { Link } from 'react-router-dom';
import { useApp } from '../lib/state';

export default function HomePage() {
  const app = useApp();
  const viewer = app.policy?.viewers?.find((v: any) => v.viewerId === app.session?.activeViewerId);
  const events = app.context?.events || [];
  const next = events.filter((e: any) => /appoint|task|follow/i.test(`${e.kind} ${e.title}`)).slice(0, 4);
  const people = (app.policy?.viewers || []).filter((v: any) => v.viewerId !== 'patient');

  return (
    <div className="stack">
      <div className="panel">
        <h1 style={{ fontFamily: 'var(--serif)', marginTop: 0 }}>
          {viewer?.relationship === 'self'
            ? `Hello, ${app.session?.selectedPatientName}`
            : `You are viewing ${app.session?.selectedPatientName}'s shared care as ${viewer?.displayName || 'a family member'}`}
        </h1>
        <p className="muted">What would you like to understand or arrange?</p>
        <div className="pill-row">
          <Link to={`/patient/${app.session?.selectedPatientId}/ask`}>
            <button type="button">Ask CareCircle</button>
          </Link>
          <button type="button" className="secondary" onClick={() => app.refreshContext()}>
            Refresh live record
          </button>
          <button type="button" className="secondary" onClick={() => app.advanceClock(121)}>
            Advance clock +121m
          </button>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel stack">
          <div className="section-title">Needs attention</div>
          {app.context?.sparse ? (
            <div className="info-banner">Sparse data — few or no visible resources returned for this patient.</div>
          ) : null}
          {app.context?.errors?.length ? (
            <div className="error-banner">
              Some sites failed: {app.context.errors.map((e: any) => `${e.site}: ${e.message}`).join('; ')}
            </div>
          ) : null}
          {next.length ? (
            next.map((e: any) => (
              <button key={e.evidenceId} type="button" className="list-item" onClick={() => app.openSource(e)}>
                <div>
                  <strong>{e.title}</strong>
                  <div className="muted small">
                    {e.status} · {new Date(e.at).toLocaleDateString('en-GB')}
                  </div>
                </div>
              </button>
            ))
          ) : (
            <p className="muted">No time-sensitive items in the current permitted view.</p>
          )}
        </div>
        <div className="panel stack">
          <div className="section-title">People helping</div>
          {people.map((p: any) => (
            <div key={p.viewerId} className="list-item">
              <div>
                <strong>{p.displayName}</strong>
                <div className="muted small">{p.relationship.replaceAll('_', ' ')}</div>
              </div>
            </div>
          ))}
          <div className="section-title">Record classes returned</div>
          <div className="pill-row">
            {(app.context?.recordClasses || []).map((c: string) => (
              <span className="chip" key={c}>
                {c}
              </span>
            ))}
            {!app.context?.recordClasses?.length ? <span className="muted">None yet</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
