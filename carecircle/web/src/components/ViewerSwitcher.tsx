import { useApp } from '../lib/state';

export default function ViewerSwitcher() {
  const app = useApp();
  const viewers = app.policy?.viewers || [];
  if (!viewers.length) return null;
  return (
    <div className="pill-row" style={{ marginBottom: '1rem' }} role="group" aria-label="Active viewer">
      <span className="muted small">Viewing as</span>
      {viewers.map((v: any) => (
        <button
          key={v.viewerId}
          type="button"
          className={app.session?.activeViewerId === v.viewerId ? undefined : 'secondary'}
          onClick={() => app.setViewer(v.viewerId)}
          aria-pressed={app.session?.activeViewerId === v.viewerId}
        >
          {v.displayName}
        </button>
      ))}
    </div>
  );
}
