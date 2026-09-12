'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/state';
import { CareCircleMark } from '@/components/ui';

export function BootingScreen() {
  return (
    <div className="boot-screen">
      <span className="brand-mark" style={{ width: '3rem', height: '3rem' }}>
        <CareCircleMark size={26} />
      </span>
      <p className="muted pulse-soft">Connecting to Anima and opening the demo patient…</p>
    </div>
  );
}

function ClientRedirect({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(to);
  }, [router, to]);
  return <BootingScreen />;
}

export function EntryRedirect() {
  const app = useApp();
  if (app.bootPhase === 'idle' || app.bootPhase === 'booting') return <BootingScreen />;
  if (app.bootPhase === 'needs_key') return <ClientRedirect to="/connect" />;
  if (app.bootPhase === 'default_patient_missing') return <ClientRedirect to="/patients" />;
  if (app.session?.selectedPatientId) {
    return <ClientRedirect to={`/patient/${app.session.selectedPatientId}`} />;
  }
  if (app.session?.connected) return <ClientRedirect to="/patients" />;
  return <ClientRedirect to="/connect" />;
}

export function RequireConnection({ children }: { children: React.ReactNode }) {
  const app = useApp();
  if (app.bootPhase === 'idle' || app.bootPhase === 'booting') return <BootingScreen />;
  if (!app.session?.connected) return <ClientRedirect to="/connect" />;
  return <>{children}</>;
}

export function RequirePatient({ children }: { children: React.ReactNode }) {
  const app = useApp();
  if (app.bootPhase === 'default_patient_missing') return <ClientRedirect to="/patients" />;
  if (!app.session?.selectedPatientId) return <ClientRedirect to="/patients" />;
  return <>{children}</>;
}
