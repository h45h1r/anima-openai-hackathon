'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useApp } from '@/lib/state';
import SourceDrawer from '@/components/SourceDrawer';
import ViewerSwitcher from '@/components/ViewerSwitcher';
import { Button, CareCircleMark, Pill } from '@/components/ui';

type Tab = { to: string; label: string; end?: boolean; icon: React.ReactNode };

function NavItem({
  href,
  end,
  children,
  className,
}: {
  href: string;
  end?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const pathname = usePathname() || '';
  const active = end ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} className={`${className || ''} ${active ? 'active' : ''}`.trim()}>
      {children}
    </Link>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const app = useApp();
  const pathname = usePathname();
  const nav = useRouter();
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
        { to: `${base}/people`, label: 'Circle', icon: <PeopleIcon /> },
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
            onClick={() => nav.push(connected ? base : '/')}
          >
            <span className="brand-mark">
              <CareCircleMark size={22} />
            </span>
            <span className="brand-name">CareCircle</span>
          </button>

          {tabs.length ? (
            <nav className="header-nav" aria-label="Primary">
              {tabs.map((t) => (
                <NavItem key={t.to} href={t.to} end={t.end}>
                  {t.icon}
                  {t.label}
                </NavItem>
              ))}
              <NavItem href="/patients" className={pathname === '/patients' ? 'active' : ''}>
                Switch patient
              </NavItem>
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
                onClick={() => nav.push('/patients')}
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
                      nav.push('/connect');
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
                        nav.push('/patients');
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
                <Button variant="secondary" size="sm" type="button" onClick={() => nav.push('/patients')}>
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
              <NavItem key={t.to} href={t.to} end={t.end}>
                {t.icon}
                {t.label}
              </NavItem>
            ))}
          </div>
        </nav>
      ) : null}

      <SourceDrawer />
    </div>
  );
}

function iconProps(size = 18) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    'aria-hidden': true as const,
  };
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
      <path
        d="M3.5 19c.7-3 2.8-4.5 5.5-4.5S13.8 16 14.5 19M14 15.2c1.6-.4 3.1.1 4.5 1.6"
        strokeLinecap="round"
      />
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
