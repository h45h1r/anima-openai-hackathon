import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from './lib/state';
import ConnectPage from './pages/ConnectPage';
import PatientsPage from './pages/PatientsPage';
import HomePage from './pages/HomePage';
import AskPage from './pages/AskPage';
import CarePage from './pages/CarePage';
import ResultsPage from './pages/ResultsPage';
import PeoplePage from './pages/PeoplePage';
import SourceDrawer from './components/SourceDrawer';
import ViewerSwitcher from './components/ViewerSwitcher';
import { Button, CareCircleMark, Pill } from './components/ui';

type Tab = { to: string; label: string; end?: boolean };

function Shell({ children }: { children: React.ReactNode }) {
  const app = useApp();
  const loc = useLocation();
  const nav = useNavigate();
  const patientId = app.session?.selectedPatientId;
  const base = patientId ? `/patient/${patientId}` : '';
  const connected = Boolean(app.session?.connected && patientId);

  const tabs: Tab[] = connected
    ? [
        { to: base, label: 'Home', end: true },
        { to: `${base}/ask`, label: 'Ask' },
        { to: `${base}/care`, label: 'My care' },
        { to: `${base}/results`, label: 'Results' },
        { to: `${base}/people`, label: 'People' },
      ]
    : [];

  return (
    <div className="app-root paper-grain">
      <header className="app-header">
        <div className="app-header-inner">
          <button
            type="button"
            className="brand-btn"
            aria-label="CareCircle home"
            onClick={() => nav(connected ? base : '/connect')}
          >
            <span className="brand-mark">
              <CareCircleMark size={22} />
            </span>
            <span className="brand-name">CareCircle</span>
          </button>

          {tabs.length ? (
            <nav className="header-nav" aria-label="Primary">
              {tabs.map((t) => (
                <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? 'active' : '')}>
                  {t.label}
                </NavLink>
              ))}
              <NavLink
                to="/patients"
                className={({ isActive }) => (isActive || loc.pathname === '/patients' ? 'active' : '')}
              >
                Switch patient
              </NavLink>
            </nav>
          ) : null}

          <div className="header-meta">
            <Pill tone={app.session?.connected ? 'moss' : 'amber'} title="Anima connection status">
              <span
                className="status-dot"
                style={{ background: app.session?.connected ? 'var(--moss)' : 'var(--amber)' }}
              />
              {app.session?.connected ? 'Live' : 'Disconnected'}
              {app.session?.keyMasked ? ` · ${app.session.keyMasked}` : ''}
            </Pill>
            {app.session?.selectedPatientName ? (
              <span className="pill hide-sm">
                <strong>{app.session.selectedPatientName}</strong>
                {app.session.selectedPatientId ? ` · ${app.session.selectedPatientId}` : ''}
              </span>
            ) : null}
            {app.session?.lastSyncAt ? (
              <span className="pill hide-sm">
                Synced{' '}
                {new Date(app.session.lastSyncAt).toLocaleTimeString('en-GB', { timeZone: 'Europe/London' })}
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <main className="app-main">
        <div className="page">
          {connected ? <ViewerSwitcher /> : null}

          {app.error ? (
            <div className="error-banner" role="alert" style={{ marginBottom: '1rem' }}>
              {app.error}{' '}
              <Button variant="ghost" size="sm" type="button" onClick={app.clearError}>
                Dismiss
              </Button>
              {app.session?.selectedPatientId ? (
                <Button variant="secondary" size="sm" type="button" onClick={() => app.refreshContext()}>
                  Retry
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  onClick={() => void app.connect({ baseUrl: app.session?.animaBaseUrl })}
                >
                  Retry connect
                </Button>
              )}
            </div>
          ) : null}

          {children}
        </div>
      </main>

      {tabs.length ? (
        <nav className="tabbar" aria-label="Primary">
          <div className="tabbar-grid" style={{ gridTemplateColumns: `repeat(${Math.min(tabs.length, 5)}, 1fr)` }}>
            {tabs.slice(0, 5).map((t) => (
              <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? 'active' : '')}>
                {t.label}
              </NavLink>
            ))}
          </div>
        </nav>
      ) : null}

      <SourceDrawer />
    </div>
  );
}

function RequireConnection({ children }: { children: React.ReactNode }) {
  const app = useApp();
  if (!app.session?.connected) return <Navigate to="/connect" replace />;
  return <>{children}</>;
}

function RequirePatient({ children }: { children: React.ReactNode }) {
  const app = useApp();
  if (!app.session?.selectedPatientId) return <Navigate to="/patients" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Navigate to="/connect" replace />} />
        <Route path="/connect" element={<ConnectPage />} />
        <Route
          path="/patients"
          element={
            <RequireConnection>
              <PatientsPage />
            </RequireConnection>
          }
        />
        <Route
          path="/patient/:id"
          element={
            <RequireConnection>
              <RequirePatient>
                <HomePage />
              </RequirePatient>
            </RequireConnection>
          }
        />
        <Route
          path="/patient/:id/ask"
          element={
            <RequireConnection>
              <RequirePatient>
                <AskPage />
              </RequirePatient>
            </RequireConnection>
          }
        />
        <Route
          path="/patient/:id/care"
          element={
            <RequireConnection>
              <RequirePatient>
                <CarePage />
              </RequirePatient>
            </RequireConnection>
          }
        />
        <Route
          path="/patient/:id/results"
          element={
            <RequireConnection>
              <RequirePatient>
                <ResultsPage />
              </RequirePatient>
            </RequireConnection>
          }
        />
        <Route
          path="/patient/:id/people"
          element={
            <RequireConnection>
              <RequirePatient>
                <PeoplePage />
              </RequirePatient>
            </RequireConnection>
          }
        />
        <Route path="*" element={<Navigate to="/connect" replace />} />
      </Routes>
    </Shell>
  );
}
