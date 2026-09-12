import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
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

function Shell({ children }: { children: React.ReactNode }) {
  const app = useApp();
  const loc = useLocation();
  const patientId = app.session?.selectedPatientId;
  const base = patientId ? `/patient/${patientId}` : '';

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand">CareCircle</div>
          <div className="muted small">Patient-controlled family communication · synthetic Anima data</div>
        </div>
        <div className="pill-row">
          <span className={`pill ${app.session?.connected ? 'ok' : 'warn'}`}>
            {app.session?.connected ? 'Connected' : 'Disconnected'}
            {app.session?.keyMasked ? <> · key <strong>{app.session.keyMasked}</strong></> : null}
          </span>
          {app.session?.selectedPatientName ? (
            <span className="pill">
              Patient <strong>{app.session.selectedPatientName}</strong> · {app.session.selectedPatientId}
            </span>
          ) : null}
          {app.session?.lastSyncAt ? (
            <span className="pill">Synced {new Date(app.session.lastSyncAt).toLocaleTimeString()}</span>
          ) : null}
        </div>
      </header>

      {app.session?.connected && patientId ? (
        <>
          <nav className="nav" aria-label="Primary">
            <NavLink to={`${base}`} end className={({ isActive }) => (isActive ? 'active' : '')}>
              Home
            </NavLink>
            <NavLink to={`${base}/ask`} className={({ isActive }) => (isActive ? 'active' : '')}>
              Ask CareCircle
            </NavLink>
            <NavLink to={`${base}/care`} className={({ isActive }) => (isActive ? 'active' : '')}>
              My care
            </NavLink>
            <NavLink to={`${base}/results`} className={({ isActive }) => (isActive ? 'active' : '')}>
              Results
            </NavLink>
            <NavLink to={`${base}/people`} className={({ isActive }) => (isActive ? 'active' : '')}>
              People and access
            </NavLink>
            <NavLink to="/patients" className={({ isActive }) => (isActive || loc.pathname === '/patients' ? 'active' : '')}>
              Switch patient
            </NavLink>
          </nav>
          <ViewerSwitcher />
        </>
      ) : null}

      {app.error ? (
        <div className="error-banner" role="alert">
          {app.error}{' '}
          <button className="ghost" type="button" onClick={app.clearError}>
            Dismiss
          </button>
          {app.session?.selectedPatientId ? (
            <button className="secondary" type="button" onClick={() => app.refreshContext()}>
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {children}
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
