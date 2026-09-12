import { useApp } from '../lib/state';

export default function CarePage() {
  const app = useApp();
  const events = app.context?.events || [];
  return (
    <div className="panel stack">
      <h1 style={{ fontFamily: 'var(--serif)', marginTop: 0 }}>My care</h1>
      <p className="muted">Timeline of appointments, tasks, documents and service status from live Anima resources.</p>
      {!events.length ? (
        <div className="info-banner">No events in the current view. Try refresh or another patient.</div>
      ) : (
        <div className="list">
          {events.map((e: any) => (
            <button key={e.evidenceId} type="button" className="list-item" onClick={() => app.openSource(e)}>
              <div>
                <strong>{e.title}</strong>
                <div className="muted small">
                  {e.kind} · {e.status} · {e.informationClass} · {new Date(e.at).toLocaleString()}
                </div>
                <div className="small">{e.summary?.slice(0, 180)}</div>
              </div>
              <span className="chip">{e.service}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
