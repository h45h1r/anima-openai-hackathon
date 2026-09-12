"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppState } from "@/lib/types";
import {
  ApiError,
  careApi,
} from "@/lib/carecircle/api";
import { careViewerForKindred } from "@/lib/carecircle/viewers";

const SESSION_KEY = "kindred.careSessionId";

export type CareStatus = "idle" | "booting" | "needs_server" | "ready" | "error";

export type CareSession = {
  sessionId: string;
  selectedPatientId?: string;
  selectedPatientName?: string;
  activeViewerId: string;
  connected: boolean;
  lastSyncAt?: string;
  keyMasked?: string;
};

function readSid(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function writeSid(id: string) {
  try {
    sessionStorage.setItem(SESSION_KEY, id);
  } catch {
    /* ignore */
  }
}

function clearSid() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function useCareClinical(kindred: AppState | null, kindredViewerId: string | null) {
  const [status, setStatus] = useState<CareStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<CareSession | null>(null);
  const [context, setContext] = useState<any | null>(null);
  const [policy, setPolicy] = useState<any | null>(null);
  const bootStarted = useRef(false);
  const syncingViewer = useRef(false);
  const levelsSynced = useRef(false);

  const refreshContext = useCallback(
    async (sessionId: string, patientId: string, viewerId: string) => {
      const ctx = await careApi<{
        context: any;
        policy: any;
        suggestions?: string[];
        freshness?: string;
      }>(`/patients/${patientId}/context?viewerId=${encodeURIComponent(viewerId)}`, { sessionId });
      setContext(ctx.context);
      setPolicy(ctx.policy);
      setSession((s) => (s ? { ...s, lastSyncAt: ctx.freshness, activeViewerId: viewerId } : s));
      return ctx;
    },
    [],
  );

  const syncLevels = useCallback(
    async (sessionId: string, patientId: string, state: AppState, policyVersion: number) => {
      const res = await careApi<{ policy: any }>(`/consent/${patientId}`, { sessionId });
      setPolicy(res.policy);
    },
    [],
  );

  const selectPatient = useCallback(
    async (sessionId: string, patientSimId: string, patientName: string, state: AppState) => {
      try {
        const res = await careApi<{
          patient: { id: string; name: string };
          session: CareSession;
          policy: any;
          context: any;
        }>("/patients/select", {
          method: "POST",
          sessionId,
          body: JSON.stringify({ patientId: patientSimId }),
        });
        setSession(res.session);
        setPolicy(res.policy);
        setContext(res.context);
        setStatus("ready");
        setError(null);
        levelsSynced.current = false;
        if (res.session.activeViewerId === "patient" && res.policy?.policyVersion != null) {
          await syncLevels(sessionId, res.patient.id, state, res.policy.policyVersion);
          levelsSynced.current = true;
        }
        return res.patient.id;
      } catch (err) {
        throw err;
      }
    },
    [syncLevels],
  );

  const bootstrap = useCallback(
    async (state: AppState) => {
      setStatus("booting");
      setError(null);
      try {
        const health = await careApi<{
          ok: boolean;
          databaseConfigured?: boolean;
          animaEnvKeyConfigured?: boolean;
          animaTeamNameConfigured?: boolean;
        }>("/health");

        const existing = readSid();
        if (existing) {
          try {
            const restored = await careApi<{ session: CareSession }>("/session", { sessionId: existing });
            if (restored.session?.connected) {
              writeSid(restored.session.sessionId);
              setSession(restored.session);
              const patientId = state.patient.simId || "SIM-000001";
              if (restored.session.selectedPatientId === patientId || restored.session.selectedPatientId) {
                // Prefer Kindred patient; re-select if needed
                if (restored.session.selectedPatientId !== patientId) {
                  await selectPatient(restored.session.sessionId, patientId, state.patient.name, state);
                } else {
                  await refreshContext(
                    restored.session.sessionId,
                    restored.session.selectedPatientId,
                    restored.session.activeViewerId || "patient",
                  );
                  setStatus("ready");
                }
                return;
              }
            }
          } catch {
            clearSid();
          }
        }

        const canAuto = Boolean(health.databaseConfigured) || Boolean(health.animaEnvKeyConfigured) || Boolean(health.animaTeamNameConfigured);
        if (!canAuto) {
          setStatus("needs_server");
          setError("The patient record connection is unavailable. Please try again.");
          return;
        }

        const connected = await careApi<{ session: CareSession }>("/connect", {
          method: "POST",
          body: JSON.stringify({}),
        });
        writeSid(connected.session.sessionId);
        setSession(connected.session);
        const patientId = state.patient.simId || "SIM-000001";
        await selectPatient(connected.session.sessionId, patientId, state.patient.name, state);
      } catch (err) {
        const message =
          err instanceof ApiError && err.code === "unavailable"
            ? err.message
            : err instanceof Error
              ? err.message
              : "Could not load clinical care";
        setStatus(err instanceof ApiError && err.code === "unavailable" ? "needs_server" : "error");
        setError(message);
      }
    },
    [refreshContext, selectPatient],
  );

  useEffect(() => {
    if (!kindred?.loaded || bootStarted.current) return;
    bootStarted.current = true;
    void bootstrap(kindred);
  }, [kindred, bootstrap]);

  // When Kindred switches the patient record, re-select clinical Care context.
  const kindredPatientSimId = kindred?.loaded ? kindred.patient.simId : null;
  useEffect(() => {
    if (!kindred?.loaded || !kindredPatientSimId || !session?.sessionId) return;
    if (status !== "ready" && status !== "error") return;
    if (session.selectedPatientId === kindredPatientSimId) return;
    const state = kindred;
    void (async () => {
      try {
        setStatus("booting");
        levelsSynced.current = false;
        await selectPatient(session.sessionId, kindredPatientSimId, state.patient.name, state);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not switch clinical patient");
        setStatus("error");
      }
    })();
  }, [kindred, kindredPatientSimId, session?.sessionId, session?.selectedPatientId, status, selectPatient]);

  // Re-sync Kindred levels into clinical record filter when Circle changes (patient only).
  useEffect(() => {
    if (!kindred?.loaded || !session?.sessionId || !session.selectedPatientId) return;
    if (session.activeViewerId !== "patient") return;
    if (!levelsSynced.current) return;
    const version = policy?.policyVersion;
    if (typeof version !== "number") return;
    const t = window.setTimeout(() => {
      void syncLevels(session.sessionId, session.selectedPatientId!, kindred, version);
    }, 400);
    return () => window.clearTimeout(t);
    // Intentionally depend on Kindred consent/levels only — not CareCircle policyVersion (avoids loops).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kindred?.consent, kindred?.levels, session?.sessionId, session?.selectedPatientId, session?.activeViewerId, syncLevels]);

  // Wire Kindred ?as= → clinical record viewer
  useEffect(() => {
    if (!kindred?.loaded || !kindredViewerId || !session?.sessionId || !session.selectedPatientId) return;
    if (status !== "ready" && status !== "error") return;
    const careViewer = careViewerForKindred(kindred, kindredViewerId);
    if (session.activeViewerId === careViewer) return;
    if (syncingViewer.current) return;
    syncingViewer.current = true;
    void (async () => {
      try {
        const res = await careApi<{ session: CareSession; policy: any }>("/viewer", {
          method: "POST",
          sessionId: session.sessionId,
          body: JSON.stringify({ viewerId: careViewer }),
        });
        setSession(res.session);
        setPolicy(res.policy);
        await refreshContext(session.sessionId, session.selectedPatientId!, careViewer);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not switch care viewer");
      } finally {
        syncingViewer.current = false;
      }
    })();
  }, [kindred, kindredViewerId, session, status, refreshContext]);

  const retry = useCallback(() => {
    if (!kindred?.loaded) return;
    bootStarted.current = false;
    levelsSynced.current = false;
    bootStarted.current = true;
    void bootstrap(kindred);
  }, [kindred, bootstrap]);

  const refresh = useCallback(async () => {
    if (!session?.sessionId || !session.selectedPatientId) return;
    try {
      await refreshContext(session.sessionId, session.selectedPatientId, session.activeViewerId);
      setError(null);
      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed");
      setStatus("error");
    }
  }, [session, refreshContext]);

  return {
    status,
    error,
    session,
    context,
    policy,
    retry,
    refresh,
    clearError: () => setError(null),
    careViewerId: session?.activeViewerId || "patient",
  };
}

export type CareClinical = ReturnType<typeof useCareClinical>;
