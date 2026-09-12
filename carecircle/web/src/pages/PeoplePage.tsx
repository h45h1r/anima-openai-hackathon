import { useMemo, useState } from 'react';
import { useApp } from '../lib/state';

const CLASSES = [
  'appointments',
  'logistics',
  'tasks',
  'treatment_summary',
  'symptoms',
  'laboratory_results',
  'clinical_documents',
  'medications',
  'private_notes',
] as const;

export default function PeoplePage() {
  const app = useApp();
  const isPatient = app.session?.activeViewerId === 'patient';
  const family = (app.policy?.viewers || []).filter((v: any) => v.viewerId !== 'patient');
  const [target, setTarget] = useState(family[0]?.viewerId || 'sarah');
  const grants = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const g of app.policy?.grants || []) {
      if (g.viewerId === target) map[g.informationClass] = Boolean(g.allowed);
    }
    return map;
  }, [app.policy, target]);
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const effective = { ...grants, ...draft };

  async function save() {
    await app.saveConsent(target, draft);
    setDraft({});
  }

  return (
    <div className="panel stack">
      <h1 style={{ fontFamily: 'var(--serif)', marginTop: 0 }}>People and access</h1>
      <p className="muted">
        CareCircle prototype permissions (not Anima accounts). Version {app.policy?.policyVersion}. Only patient mode can
        save changes.
      </p>
      {!isPatient ? (
        <div className="info-banner">Switch to the patient viewer to edit the permission matrix.</div>
      ) : null}
      <div className="pill-row">
        {family.map((v: any) => (
          <button
            key={v.viewerId}
            type="button"
            className={target === v.viewerId ? undefined : 'secondary'}
            onClick={() => {
              setTarget(v.viewerId);
              setDraft({});
            }}
          >
            {v.displayName}
          </button>
        ))}
      </div>
      <table className="matrix">
        <thead>
          <tr>
            <th>Information class</th>
            <th>Allowed</th>
          </tr>
        </thead>
        <tbody>
          {CLASSES.map((c) => (
            <tr key={c}>
              <td>{c.replaceAll('_', ' ')}</td>
              <td>
                <input
                  type="checkbox"
                  checked={Boolean(effective[c])}
                  disabled={!isPatient}
                  onChange={(e) => setDraft((d) => ({ ...d, [c]: e.target.checked }))}
                  aria-label={`Allow ${c}`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pill-row">
        <button type="button" disabled={!isPatient || !Object.keys(draft).length} onClick={save}>
          Save permissions
        </button>
        <button type="button" className="secondary" onClick={() => app.resetDemo()}>
          Reset CareCircle demo state
        </button>
      </div>
      <div className="section-title">Audit</div>
      <ul className="small muted">
        {(app.policy?.audit || [])
          .slice()
          .reverse()
          .slice(0, 8)
          .map((a: any, i: number) => (
            <li key={i}>
              v{a.policyVersion} · {a.actor} · {a.message}
            </li>
          ))}
      </ul>
    </div>
  );
}
