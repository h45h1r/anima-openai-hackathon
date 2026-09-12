"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppState, Category, SharingLevel } from "@/lib/types";

export function useKindred() {
  const [state, setState] = useState<AppState | null>(null);
  const [connected, setConnected] = useState(false);
  const [patientRevision, setPatientRevision] = useState(0);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;
    const connect = () => {
      const es = new EventSource("/api/events");
      esRef.current = es;
      es.onopen = () => setConnected(true);
      es.onmessage = (ev) => {
        if (cancelled || esRef.current !== es) return;
        try {
          setState(JSON.parse(ev.data) as AppState);
        } catch {
          /* ignore */
        }
      };
      es.onerror = () => {
        setConnected(false);
        es.close();
        if (!cancelled) setTimeout(connect, 1200);
      };
    };
    connect();
    return () => {
      cancelled = true;
      esRef.current?.close();
    };
  }, [patientRevision]);

  const post = useCallback(async (url: string, body?: unknown, method = "POST") => {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error((j as { error?: string }).error ?? res.statusText);
    }
    return res.json();
  }, []);

  const actions = {
    setConsent: (granteeId: string, category: Category, allowed: boolean) => post("/api/consent", { granteeId, category, allowed, expectedVersion: state?.people.find(p => p.id === granteeId)?.consentVersion }, "PATCH"),
    addFamilyMember: (input: { name: string; relationship: string; email?: string }): Promise<{ id: string }> => post('/api/family-members', input),
    removeFamilyMember: (granteeId: string) => post('/api/family-members', { granteeId }, 'DELETE'),
    setSharingLevel: (granteeId: string, level: SharingLevel) => post("/api/sharing-level", { granteeId, level }),
    setLevelDefinition: (level: SharingLevel, categories: Category[]) => post("/api/levels", { level, categories }, "PATCH"),
    sendChat: (threadId: string, actorId: string, text: string) => post("/api/chat", { threadId, actorId, text }),
    runProactive: () => post("/api/proactive"),
    reset: () => post("/api/reset"),
    switchPatient: async (patientId: string) => {
      esRef.current?.close(); esRef.current = null;
      setState(null); setConnected(false);
      try { return await post('/api/patient', { patientId }); }
      finally { setPatientRevision(value => value + 1); }
    },
    respondRequest: (requestId: string, approve: boolean) => post("/api/consent-request", { requestId, approve }),
  };

  return { state, connected, actions };
}

export type KindredActions = ReturnType<typeof useKindred>["actions"];
