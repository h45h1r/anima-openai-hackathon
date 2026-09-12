import { useApp } from '../lib/state';

export default function SourceDrawer() {
  const app = useApp();
  if (!app.sourceOpen) return null;
  const s = app.sourceOpen;
  return (
    <div className="drawer-backdrop" onClick={() => app.openSource(null)} role="presentation">
      <aside className="drawer" role="dialog" aria-label="Source evidence" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
          <h2 style={{ marginTop: 0, fontFamily: 'var(--serif)' }}>Source</h2>
          <button type="button" className="secondary" onClick={() => app.openSource(null)}>
            Close
          </button>
        </div>
        <p className="muted small">Synthetic Anima evidence · patient {app.session?.selectedPatientId}</p>
        <div className="stack">
          <div>
            <div className="section-title">Title</div>
            <div>{s.title || s.displayName || 'Evidence'}</div>
          </div>
          <div>
            <div className="section-title">Identifiers</div>
            <div className="small">
              evidenceId: {s.evidenceId}
              <br />
              resourceId: {s.resourceId}
              <br />
              service: {s.service || '—'}
            </div>
          </div>
          {s.value !== undefined ? (
            <div>
              <div className="section-title">Measurement</div>
              <div>
                {s.value} {s.unit} on {s.sampledAt || s.date}
              </div>
            </div>
          ) : null}
          {s.summary ? (
            <div>
              <div className="section-title">Record text</div>
              <div className="small">{s.summary}</div>
            </div>
          ) : null}
          <pre className="trace">{JSON.stringify(s, null, 2)}</pre>
        </div>
      </aside>
    </div>
  );
}
