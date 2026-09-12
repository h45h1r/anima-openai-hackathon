'use client';

import { useApp } from '../lib/state';
import { Button } from './ui';

/** Demo Ask persona switcher — not Kindred access control. */
export default function ViewerSwitcher() {
  const app = useApp();
  const viewers = app.policy?.viewers || [];
  if (!viewers.length) return null;
  return (
    <div className="viewer-switcher" role="group" aria-label="Ask demo persona">
      <span className="muted small">Ask as</span>
      {viewers.map((v: { viewerId: string; displayName: string; sharingLevel?: string }) => (
        <Button
          key={v.viewerId}
          type="button"
          variant={app.session?.activeViewerId === v.viewerId ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => app.setViewer(v.viewerId)}
          aria-pressed={app.session?.activeViewerId === v.viewerId}
          title={
            v.viewerId === 'patient'
              ? 'Patient (full access)'
              : `Demo persona · Kindred level: ${v.sharingLevel || 'custom'}`
          }
        >
          {v.displayName}
        </Button>
      ))}
      <span className="muted small hide-sm">Kindred Circle owns real access</span>
    </div>
  );
}
