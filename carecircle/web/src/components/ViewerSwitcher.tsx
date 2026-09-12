'use client';

import { useApp } from '../lib/state';
import { Button } from './ui';

export default function ViewerSwitcher() {
  const app = useApp();
  const viewers = app.policy?.viewers || [];
  if (!viewers.length) return null;
  return (
    <div className="viewer-switcher" role="group" aria-label="Active viewer">
      <span className="muted small">Viewing as</span>
      {viewers.map((v: any) => (
        <Button
          key={v.viewerId}
          type="button"
          variant={app.session?.activeViewerId === v.viewerId ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => app.setViewer(v.viewerId)}
          aria-pressed={app.session?.activeViewerId === v.viewerId}
        >
          {v.displayName}
        </Button>
      ))}
    </div>
  );
}
