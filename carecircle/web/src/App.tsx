import { useEffect, useRef, useState } from 'react';
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

type Tab = { to: string; label: string; end?: boolean; icon: React.ReactNode };

function Shell({ children }: { children: React.ReactNode }) {
  const app = useApp();
  const loc = useLocation();
  const nav = useNavigate();
  const patientId = app.session?.selectedPatientId;
  const base = patientId ? `/patient/${patientId}` : '';
  const connected = Boolean(app.session?.connected && patientId);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  const tabs: Tab[] = connected
    ? [
        { to: base, label: 'Home', end: true, icon: <HomeIcon /> },
        { to: `${base}/ask`, label: 'Ask', icon: <AskIcon /> },
        { to: `${base}/care`, label: 'My care', icon: <CareIcon /> },
        { to: `${base}/results`, label: 'Results', icon: <ResultsIcon /> },
        { to: `${base}/people`, label: 'People', icon: <PeopleIcon /> },
      ]
    : [];

  const live = Boolean(app.session?.connected);

  return (
    <div className="app-root paper-grain">
      <header className="app-header">
        <div className="app-header-inner">
          <button
            type="button"
            className="brand-btn"
            aria-label="CareCircle home"
            onClick={() => nav(connected ? base : '/')}
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
                  {t.icon}
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
            <Pill tone={live ? 'moss' : 'rust'} title="Anima connection status">
              <span className="status-dot" style={{ background: live ? 'var(--moss)' : 'var(--rust)' }} />
              {live ? 'Live' : app.bootPhase === 'booting' || app.status === 'connecting' ? 'Connecting' : 'Disconnected'}
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
            {app.session?.connected ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="switch-patient-mobile"
                onClick={() => nav('/patients')}
              >
                Switch patient
              </Button>
            ) : null}

            <div className="account-menu" ref={menuRef}>
              <button
                type="button"
                className={`account-menu-btn ${menuOpen ? 'open' : ''}`}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                title="Settings"
                onClick={() => setMenuOpen((v) => !v)}
              >
                <MenuIcon />
              </button>
              {menuOpen ? (
                <div className="account-menu-panel" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      nav('/connect');
                    }}
                  >
                    Connection / API
                  </button>
                  {app.session?.connected ? (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        nav('/patients');
                      }}
                    >
                      Switch patient
                    </button>
                  ) : null}
                  {connected ? (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        void app.refreshContext();
                      }}
                    >
                      Refresh live record
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
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
              {app.bootPhase === 'default_patient_missing' || !app.session?.selectedPatientId ? (
                <Button variant="secondary" size="sm" type="button" onClick={() => nav('/patients')}>
                  Switch patient
                </Button>
              ) : app.session?.selectedPatientId ? (
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
                {t.icon}
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

function BootingScreen() {
  return (
    <div className="boot-screen">
      <span className="brand-mark" style={{ width: '3rem', height: '3rem' }}>
        <CareCircleMark size={26} />
      </span>
      <p className="muted pulse-soft">Connecting to Anima and opening the demo patient…</p>
    </div>
  );
}

function EntryRedirect() {
  const app = useApp();
  if (app.bootPhase === 'idle' || app.bootPhase === 'booting') return <BootingScreen />;
  if (app.bootPhase === 'needs_key') return <Navigate to="/connect" replace />;
  if (app.bootPhase === 'default_patient_missing') return <Navigate to="/patients" replace />;
  if (app.session?.selectedPatientId) {
    return <Navigate to={`/patient/${app.session.selectedPatientId}`} replace />;
  }
  if (app.session?.connected) return <Navigate to="/patients" replace />;
  return <Navigate to="/connect" replace />;
}

function RequireConnection({ children }: { children: React.ReactNode }) {
  const app = useApp();
  if (app.bootPhase === 'idle' || app.bootPhase === 'booting') return <BootingScreen />;
  if (!app.session?.connected) return <Navigate to="/connect" replace />;
  return <>{children}</>;
}

function RequirePatient({ children }: { children: React.ReactNode }) {
  const app = useApp();
  if (app.bootPhase === 'default_patient_missing') return <Navigate to="/patients" replace />;
  if (!app.session?.selectedPatientId) return <Navigate to="/patients" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<EntryRedirect />} />
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
        <Route path="*" element={<EntryRedirect />} />
      </Routes>
    </Shell>
  );
}

function iconProps(size = 18) {
  return { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, 'aria-hidden': true as const };
}

function HomeIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" strokeLinejoin="round" />
    </svg>
  );
}

function AskIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M5 19v-2.2A7 7 0 1 1 12 19H5Z" strokeLinejoin="round" />
      <path d="M9.5 10.5h.01M12 10.5h.01M14.5 10.5h.01" strokeLinecap="round" />
    </svg>
  );
}

function CareIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M8 4h8v4H8V4Z" strokeLinejoin="round" />
      <path d="M6 8h12v12H6V8Z" strokeLinejoin="round" />
      <path d="M10 12h4M12 10v4" strokeLinecap="round" />
    </svg>
  );
}

function ResultsIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M5 19V9M10 19V5M15 19v-7M20 19V8" strokeLinecap="round" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg {...iconProps()}>
      <circle cx="9" cy="9" r="3.2" />
      <circle cx="16.5" cy="10" r="2.4" />
      <path d="M3.5 19c.7-3 2.8-4.5 5.5-4.5S13.8 16 14.5 19M14 15.2c1.6-.4 3.1.1 4.5 1.6" strokeLinecap="round" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg {...iconProps(18)}>
      <circle cx="12" cy="6" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
