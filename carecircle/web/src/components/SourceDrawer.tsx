'use client';

import { useApp } from '../lib/state';
import { Button } from './ui';

export default function SourceDrawer() {
  const app = useApp();
  if (!app.sourceOpen) return null;
  const s = app.sourceOpen;
  return (
    <div className="drawer-backdrop" onClick={() => app.openSource(null)} role="presentation">
      <aside className="drawer" role="dialog" aria-label="Source evidence" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
          <h2 className="page-title" style={{ fontSize: '1.25rem', margin: 0 }}>
            Source
          </h2>
          <Button type="button" variant="secondary" size="sm" onClick={() => app.openSource(null)}>
            Close
          </Button>
        </div>
        <p className="muted small">Synthetic Anima evidence · patient {app.session?.selectedPatientId}</p>
        <div className="stack">
          <div>
            <div className="section-title">Title</div>
            <div className="font-display" style={{ fontWeight: 700 }}>
              {s.title || s.displayName || 'Evidence'}
            </div>
          </div>
          <div>
            <div className="section-title">Identifiers</div>
            <div className="small trace" style={{ whiteSpace: 'normal' }}>
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
              <div className="trace">
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
