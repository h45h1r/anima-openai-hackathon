"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useKindred } from "@/hooks/useKindred";
import type { AppState, Person } from "@/lib/types";
import { personById, visibleMessages } from "@/lib/types";
import { Avatar, Button, KindredMark, LockIcon, Pill } from "./ui";
import AuditRail from "./AuditRail";
import Chat from "./Chat";
import PatientHome from "./patient/PatientHome";
import CircleOfCare from "./patient/CircleOfCare";
import SharingLevels from "./patient/SharingLevels";
import BodyView from "./body/BodyView";
import FamilyHome from "./family/FamilyHome";
import EhrView from "./clinician/EhrView";

type Tab = "home" | "body" | "circle" | "family" | "kindred" | "activity" | "levels";

interface TabDef {
  id: Tab;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

export default function App() {
  const { state, connected, actions } = useKindred();
  const params = useSearchParams();
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [showAudit, setShowAudit] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem("kindred.audit") === "1";
    } catch {
      return false;
    }
  });
  const toggleAudit = () => {
    setShowAudit((v) => {
      try {
        localStorage.setItem("kindred.audit", v ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !v;
    });
  };

  if (!state || !state.loaded) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center text-muted">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-plum text-white"><KindredMark size={26} /></span>
        {state?.loadError ? (
          <>
            <div className="font-display text-lg font-bold text-ink">Couldn’t load the patient record</div>
            <p className="max-w-md text-sm">{state.loadError}</p>
            <Button variant="secondary" size="sm" onClick={() => actions.reset()}>Try again</Button>
          </>
        ) : (
          <span className="pulse-soft">Loading the live record from NHS-SIM…</span>
        )}
      </div>
    );
  }

  const asParam = params.get("as");
  if (params.get('patient') && params.get('patient') !== state.patient.simId) {
    return <main className="mx-auto max-w-xl p-8"><h1 className="text-xl font-bold">Different patient record</h1><p className="mt-3">This Kindred demo is connected to {state.patient.name} ({state.patient.simId}). Open their circle to manage sharing.</p><Link className="mt-4 inline-block text-plum underline" href="/?tab=circle">Open {state.patient.name}&apos;s circle</Link></main>;
  }
  if (asParam && state.people.some(p => p.id === asParam && p.accessStatus === 'revoked')) {
    return <main className="mx-auto max-w-xl p-8"><h1 className="text-xl font-bold">Access removed</h1><p className="mt-3">The patient has removed this person from their circle.</p><Link className="mt-4 inline-block text-plum underline" href="/">Return to the patient demo</Link></main>;
  }
  const viewerId = asParam && state.people.some((p) => p.id === asParam && p.accessStatus !== 'revoked') ? asParam : state.patientId;
  const viewer = personById(state, viewerId);
  const isPatient = viewerId === state.patientId;
  const isClinician = viewer.role === "clinician";
  const patient = personById(state, state.patientId);
  const clinicians = state.people.filter((p) => p.role === "clinician");
  const primaryClinician = clinicians.find((p) => p.relation === "GP") ?? clinicians[0];
  const personas = [...state.people.filter((p) => p.accessStatus !== 'revoked' && (p.role === "patient" || p.role === "family" || p.role === "carer")), ...(primaryClinician ? [primaryClinician] : [])];

  const familyUnread = visibleMessages(state, "family-group", viewerId).filter((m) => m.kind === "notification").length;
  const pending = isPatient ? state.consentRequests.filter((r) => r.status === "pending").length : 0;
  const tabs: TabDef[] = isClinician
    ? [{ id: "home", label: "Record", icon: <RecordIcon /> }]
    : isPatient
      ? [
          { id: "home", label: "Home", icon: <HomeIcon />, badge: pending },
          { id: "body", label: "Body", icon: <BodyIcon /> },
          { id: "kindred", label: "Kindred", icon: <KindredMark size={22} /> },
          { id: "circle", label: "Circle", icon: <LockIcon size={20} /> },
          { id: "family", label: "Family", icon: <PeopleIcon />, badge: familyUnread },
        ]
      : [
          { id: "home", label: patient.shortName, icon: <HomeIcon /> },
          { id: "body", label: "Body", icon: <BodyIcon /> },
          { id: "kindred", label: "Kindred", icon: <KindredMark size={22} /> },
          { id: "family", label: "Family", icon: <PeopleIcon />, badge: familyUnread },
        ];
  const tabParam = params.get("tab") as Tab | null;
  const tab: Tab = tabParam && (tabs.some((t) => t.id === tabParam) || tabParam === "activity" || (tabParam === "levels" && isPatient)) ? tabParam : "home";

  const go = (next: { as?: string; tab?: Tab }) => {
    const q = new URLSearchParams();
    q.set("as", next.as ?? viewerId);
    const t = next.tab ?? (next.as && next.as !== viewerId ? "home" : tab);
    if (t !== "home") q.set("tab", t);
    router.replace(`?${q.toString()}`);
  };
  const ask = (question: string) => {
    const dm = Object.values(state.threads).find((t) => t.kind === "direct" && t.memberIds.includes(viewerId));
    if (dm) actions.sendChat(dm.id, viewerId, question).catch(() => {});
    go({ tab: "kindred" });
  };
  const runCheck = async () => {
    setRunning(true);
    try {
      await actions.runProactive();
    } finally {
      setRunning(false);
    }
  };

  const modeLabel = state.agentMode === "openai" ? `${state.agentModel} · medium` : state.agentMode === "claude" ? state.agentModel : "Scripted agent";

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 h-[var(--header-h)] border-b border-line bg-card/85 backdrop-blur">
        <div className="mx-auto flex h-full max-w-[1600px] items-center gap-2 px-3 sm:px-5">
          <button onClick={() => go({ tab: "home" })} className="flex items-center gap-2 pr-2" aria-label="Kindred home">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-plum text-white"><KindredMark size={22} /></span>
            <span className="hidden font-display text-lg font-bold leading-none sm:block">Kindred</span>
          </button>

          <nav className="ml-2 hidden items-center gap-1 lg:flex" aria-label="Primary">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => go({ tab: t.id })} className={`relative flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold transition ${tab === t.id || (tab === "levels" && t.id === "circle") ? "bg-ink text-white" : "text-ink hover:bg-paper"}`}>
                {t.icon}
                {t.label}
                {t.badge ? <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rust px-1 text-[10px] font-bold text-white">{t.badge}</span> : null}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden md:block">
              <Pill tone={connected ? "moss" : "rust"} title={`Live data: NHS-SIM · ${state.patient.name} (${state.patient.simId}) · world ${state.source.world ?? "—"}\nAgent: ${modeLabel}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-moss" : "bg-rust"}`} />
                {connected ? "Live" : "Reconnecting"}
              </Pill>
            </span>
            <Button variant="plum" size="sm" disabled={running} onClick={runCheck} title="Simulates Kindred's scheduled check: finds appointments in the next 7 days and tells the family">
              <ClockIcon />
              <span className="hidden sm:inline">{running ? "Checking…" : "Run check"}</span>
            </Button>
            <button onClick={toggleAudit} className={`hidden h-9 w-9 items-center justify-center rounded-full border lg:flex ${showAudit ? "border-plum bg-plum-soft text-plum" : "border-line text-muted hover:bg-paper"}`} title={showAudit ? "Hide activity" : "Show activity"} aria-pressed={showAudit}>
              <ActivityIcon />
            </button>
            <AccountMenu viewer={viewer} personas={personas} onSwitch={(id) => go({ as: id, tab: "home" })} onReload={() => actions.reset()} onActivity={() => go({ tab: "activity" })} status={{ data: `NHS-SIM · ${state.patient.name} (${state.patient.simId})`, agent: modeLabel, world: state.source.world }} />
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1600px] flex-1">
        <main className="min-w-0 flex-1">
          {tab === "activity" ? (
            <div className="app-main-h">
              <div className="mx-auto h-full w-full max-w-3xl lg:overflow-hidden lg:py-4">
                <div className="h-full lg:overflow-hidden lg:rounded-2xl lg:border lg:border-line lg:bg-card/60">
                  <AuditRail state={state} />
                </div>
              </div>
            </div>
          ) : (
            <Screen state={state} actions={actions} viewer={viewer} tab={tab} onAsk={ask} go={go} />
          )}
        </main>
        {showAudit && (
          <aside className="sticky top-[var(--header-h)] hidden h-[calc(100vh-var(--header-h))] w-[360px] shrink-0 border-l border-line bg-card/60 lg:block xl:w-[400px]">
            <AuditRail state={state} />
          </aside>
        )}
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Primary">
        <div className="grid h-16" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
          {tabs.map((t) => (
            <button key={t.id} onClick={() => go({ tab: t.id })} className={`relative flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${tab === t.id || (tab === "levels" && t.id === "circle") ? "text-plum" : "text-muted"}`}>
              {t.icon}
              {t.label}
              {t.badge ? <span className="absolute right-[22%] top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rust px-1 text-[10px] font-bold text-white">{t.badge}</span> : null}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

function Screen({ state, actions, viewer, tab, onAsk, go }: { state: AppState; actions: ReturnType<typeof useKindred>["actions"]; viewer: Person; tab: Tab; onAsk: (q: string) => void; go: (n: { tab?: Tab }) => void }) {
  const isPatient = viewer.id === state.patientId;
  const patient = personById(state, state.patientId);
  const dm = Object.values(state.threads).find((t) => t.kind === "direct" && t.memberIds.includes(viewer.id));
  const firstFamily = state.people.find((p) => p.role === "family");

  if (viewer.role === "clinician") {
    return (
      <div className="page">
        <EhrView state={state} viewerId={viewer.id} />
      </div>
    );
  }
  if (tab === "home") {
    return (
      <div className="page">
        {isPatient ? <PatientHome state={state} actions={actions} onOpenChat={() => go({ tab: "kindred" })} /> : <FamilyHome state={state} actions={actions} viewerId={viewer.id} onAsk={onAsk} />}
      </div>
    );
  }
  if (tab === "body") {
    return (
      <div className="page page-wide">
        <BodyView state={state} viewerId={viewer.id} onAsk={onAsk} />
      </div>
    );
  }
  if (tab === "circle") {
    return (
      <div className="page">
        <h1 className="font-display text-[26px] font-bold leading-tight sm:text-3xl">Your circle</h1>
        <p className="mt-1 mb-4 text-[15px] text-muted">Tap someone and choose how much they see. You can also just tell Kindred.</p>
        <CircleOfCare state={state} actions={actions} onEditLevels={() => go({ tab: "levels" })} />
      </div>
    );
  }
  if (tab === "levels") {
    return (
      <div className="page">
        <SharingLevels state={state} actions={actions} onBack={() => go({ tab: "circle" })} />
      </div>
    );
  }
  if (tab === "family") {
    return (
      <div className="app-main-h">
        <div className="mx-auto h-full w-full max-w-3xl lg:py-4">
          <Chat state={state} actions={actions} threadId="family-group" viewerId={viewer.id} big={isPatient} canCompose={false} />
        </div>
      </div>
    );
  }
  if (!dm) return null;
  const suggestions = isPatient
    ? [firstFamily ? `Let ${firstFamily.shortName} see my test results` : "Who can see what?", "Who can see what?", "What's coming up this week?", "Explain my latest blood tests"]
    : [`What do ${patient.shortName}'s latest blood tests mean?`, `What's coming up for ${patient.shortName}?`, `What medicines does ${patient.shortName} take?`, `How is ${patient.shortName} sleeping?`];
  return (
    <div className="app-main-h">
      <div className="mx-auto h-full w-full max-w-3xl lg:py-4">
        <Chat state={state} actions={actions} threadId={dm.id} viewerId={viewer.id} big={isPatient} suggestions={suggestions} />
      </div>
    </div>
  );
}

function AccountMenu({ viewer, personas, onSwitch, onReload, onActivity, status }: { viewer: Person; personas: Person[]; onSwitch: (id: string) => void; onReload: () => void; onActivity: () => void; status: { data: string; agent: string; world?: string } }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 rounded-full border border-line bg-card py-1 pl-1 pr-2 text-sm font-semibold hover:bg-paper" aria-haspopup="menu" aria-expanded={open}>
        <Avatar person={viewer} size={28} />
        <span className="hidden sm:inline">{viewer.shortName}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-muted"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div role="menu" className="rise absolute right-0 mt-2 w-72 overflow-hidden rounded-2xl border border-line bg-card shadow-xl">
          <div className="border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Signed in as · demo switch</div>
          {personas.map((p) => (
            <button
              key={p.id}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSwitch(p.id);
              }}
              className={`flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-paper ${p.id === viewer.id ? "bg-plum-soft/60" : ""}`}
            >
              <Avatar person={p} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{p.name}</span>
                <span className="block text-xs text-muted">{p.relation}{p.org ? ` · ${p.org}` : ""}</span>
              </span>
              {p.id === viewer.id && <span className="text-plum"><CheckIcon /></span>}
            </button>
          ))}
          <div className="border-t border-line p-2">
            <button role="menuitem" onClick={() => { setOpen(false); onActivity(); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold text-ink hover:bg-paper"><ActivityIcon /> Activity log</button>
            <button role="menuitem" onClick={() => { setOpen(false); onReload(); }} className="w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-muted hover:bg-paper hover:text-ink">Reload record from NHS-SIM</button>
          </div>
          <dl className="border-t border-line bg-paper/60 px-3 py-2 text-[11px] leading-relaxed text-muted">
            <div className="flex gap-2"><dt className="w-10 shrink-0 font-semibold uppercase tracking-wider">Data</dt><dd className="truncate">{status.data}{status.world ? ` · ${status.world}` : ""}</dd></div>
            <div className="flex gap-2"><dt className="w-10 shrink-0 font-semibold uppercase tracking-wider">Agent</dt><dd className="truncate">{status.agent}</dd></div>
          </dl>
        </div>
      )}
    </div>
  );
}

function BodyIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="4.5" r="2.5" /><path d="M8 9h8l-1 6h-6zM10 15l-1.5 6M14 15l1.5 6M8 9l-3 3M16 9l3 3" /></svg>;
}
function HomeIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z" /></svg>;
}
function PeopleIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.5" /><circle cx="17" cy="10" r="2.5" /><path d="M3 20a6 6 0 0 1 12 0M15 20a4 4 0 0 1 6 0" /></svg>;
}
function RecordIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M14 3v6h6M9 13h6M9 17h6" /></svg>;
}
function ActivityIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l3-8 4 16 3-8h4" /></svg>;
}
function ClockIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
}
function CheckIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>;
}
