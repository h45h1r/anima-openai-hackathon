"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppState } from "@/lib/types";
import {
  ApiError,
  AskClientError,
  askViaSse,
  careApi,
  isTransportFailure,
} from "@/lib/carecircle/api";
import { careViewerForKindred } from "@/lib/carecircle/viewers";

const SESSION_KEY = "kindred.careSessionId";

export type CareStatus = "idle" | "booting" | "needs_server" | "ready" | "error";

export type AskThreadMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  run?: any;
};

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

function calmAskStatus(message: string) {
  if (/retriev|ground|evidence|search|looking|record/i.test(message)) return "Looking through the record…";
  if (/consent|policy|filter|access|can see/i.test(message)) return "Checking what you can see…";
  if (/appoint|slot|book|diary/i.test(message)) return "Checking appointments…";
  if (/remember|prefer|sav/i.test(message)) return "Saving preference…";
  if (/model|openai|writ|phras/i.test(message)) return "Writing…";
  if (/connect|fallback/i.test(message)) return "Connecting…";
  return message || "Looking through the record…";
}

function calmToolStatus(tool: string) {
  switch (tool) {
    case "get_permitted_evidence":
    case "patient.context.read":
    case "intent.classify":
      return "Looking through the record…";
    case "consent.evaluate":
      return "Checking what you can see…";
    case "appointment_assist":
      return "Checking appointments…";
    case "remember":
    case "memory.recall":
      return "Saving preference…";
    case "update_consent":
      return "Updating access…";
    case "answer.generate":
    case "answer.refine":
      return "Writing…";
    default:
      return "Looking through the record…";
  }
}

export function useCareClinical(kindred: AppState | null, kindredViewerId: string | null) {
  const [status, setStatus] = useState<CareStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<CareSession | null>(null);
  const [context, setContext] = useState<any | null>(null);
  const [policy, setPolicy] = useState<any | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [askThread, setAskThread] = useState<AskThreadMessage[]>([]);
  const [askStatus, setAskStatus] = useState<string | null>(null);
  const [askStreamText, setAskStreamText] = useState("");
  const [askTransport, setAskTransport] = useState<"sse" | "rest" | null>(null);
  const [lastAnswer, setLastAnswer] = useState<any | null>(null);

  const bootStarted = useRef(false);
  const syncingViewer = useRef(false);
  const levelsSynced = useRef(false);
  const threadScope = useRef("");
  const sid = session?.sessionId || readSid();
  const activeRecord = useRef('');
  activeRecord.current = `${kindred?.patient.simId || ''}::${kindredViewerId || ''}`;

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
      setSuggestions(ctx.suggestions || []);
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
              : "Could not start clinical Ask";
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

  // When Kindred switches the patient record, re-select clinical Ask/Care context.
  const kindredPatientSimId = kindred?.loaded ? kindred.patient.simId : null;
  useEffect(() => {
    if (!kindred?.loaded || !kindredPatientSimId || !session?.sessionId) return;
    if (status !== "ready" && status !== "error") return;
    if (session.selectedPatientId === kindredPatientSimId) return;
    const state = kindred;
    void (async () => {
      try {
        setStatus("booting");
        setAskStatus(null);
        setAskThread([]);
        setLastAnswer(null);
        setAskStreamText("");
        levelsSynced.current = false;
        threadScope.current = "";
        await selectPatient(session.sessionId, kindredPatientSimId, state.patient.name, state);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not switch clinical patient");
        setStatus("error");
      }
    })();
  }, [kindred, kindredPatientSimId, session?.sessionId, session?.selectedPatientId, status, selectPatient]);

  // Re-sync Kindred levels into CareCircle Ask filter when Circle changes (patient only).
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

  // Wire Kindred ?as= → CareCircle Ask viewer
  useEffect(() => {
    if (!kindred?.loaded || !kindredViewerId || !session?.sessionId || !session.selectedPatientId) return;
    if (status !== "ready" && status !== "error") return;
    const careViewer = careViewerForKindred(kindred, kindredViewerId);
    if (session.activeViewerId === careViewer) return;
    if (syncingViewer.current) return;
    syncingViewer.current = true;
    const scope = `${session.selectedPatientId}::${careViewer}`;
    const resetThread = threadScope.current !== scope;
    threadScope.current = scope;
    void (async () => {
      try {
        const res = await careApi<{ session: CareSession; policy: any }>("/viewer", {
          method: "POST",
          sessionId: session.sessionId,
          body: JSON.stringify({ viewerId: careViewer }),
        });
        setSession(res.session);
        setPolicy(res.policy);
        if (resetThread) {
          setAskThread([]);
          setLastAnswer(null);
        }
        await refreshContext(session.sessionId, session.selectedPatientId!, careViewer);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not switch Ask viewer");
      } finally {
        syncingViewer.current = false;
      }
    })();
  }, [kindred, kindredViewerId, session, status, refreshContext]);

  const ask = useCallback(
    async (question: string) => {
      if (status !== "ready" || !session?.selectedPatientId || !sid || session.selectedPatientId !== kindred?.patient.simId || session.activeViewerId !== careViewerForKindred(kindred, kindredViewerId || kindred.patientId)) throw new Error("The selected record is still loading. Please try again.");
      const recordScope = activeRecord.current;
      const patientId = session.selectedPatientId;
      const viewerId = session.activeViewerId;
      const history = askThread
        .filter((m) => m.text.trim())
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.text }));

      const userMsg: AskThreadMessage = { id: `u_${Date.now()}`, role: "user", text: question };
      setAskThread((t) => [...t, userMsg]);
      setAskStatus("Connecting…");
      setAskStreamText("");
      setAskTransport(null);
      setError(null);

      const finishOk = (res: { run: any; suggestions?: string[] }, transport: "sse" | "rest") => {
        if (recordScope !== activeRecord.current) return;
        const assistant: AskThreadMessage = {
          id: `a_${res.run?.runId || Date.now()}`,
          role: "assistant",
          text: res.run?.answer?.answer || "",
          run: res.run,
        };
        setLastAnswer(res.run);
        setSuggestions(res.suggestions || suggestions);
        setAskStatus(null);
        setAskStreamText("");
        setAskTransport(transport);
        setAskThread((t) => [...t, assistant]);
      };

      try {
        const res = await askViaSse({ sessionId: sid, patientId, viewerId, question, history }, (event) => {
          if (recordScope !== activeRecord.current) return;
          if (event.type === "status") {
            setAskStatus(calmAskStatus(event.message));
            setAskTransport("sse");
          } else if (event.type === "tool") {
            setAskStatus(calmToolStatus(String(event.tool || "")));
            setAskTransport("sse");
          } else if (event.type === "stream_reset") {
            setAskStreamText("");
            setAskStatus("Writing…");
            setAskTransport("sse");
          } else if (event.type === "token") {
            setAskStreamText((t) => t + event.text);
            setAskStatus("Writing…");
            setAskTransport("sse");
          }
        });
        finishOk(res, "sse");
        return;
      } catch (sseErr) {
        if (recordScope !== activeRecord.current) return;
        if (sseErr instanceof AskClientError || !isTransportFailure(sseErr)) {
          const message = sseErr instanceof Error ? sseErr.message : "Ask failed";
          setAskStatus(null);
          setAskStreamText("");
          setError(message);
          throw sseErr instanceof Error ? sseErr : new Error(message);
        }
        setAskStatus("Falling back…");
        setAskTransport("rest");
        try {
          const res = await careApi<{ run: any; suggestions?: string[] }>("/ask", {
            method: "POST",
            sessionId: sid,
            body: JSON.stringify({ patientId, viewerId, question, history }),
          });
          finishOk(res, "rest");
        } catch (restErr) {
          const message = restErr instanceof Error ? restErr.message : "Ask failed";
          setAskStatus(null);
          setAskStreamText("");
          setError(message);
          throw restErr instanceof Error ? restErr : new Error(message);
        }
      }
    },
    [session, sid, askThread, suggestions, status, kindred, kindredViewerId],
  );

  const clearAskThread = useCallback(() => {
    setAskThread([]);
    setLastAnswer(null);
    setAskStreamText("");
  }, []);

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
    suggestions,
    askThread,
    askStatus,
    askStreamText,
    askTransport,
    lastAnswer,
    ask,
    clearAskThread,
    retry,
    refresh,
    clearError: () => setError(null),
    careViewerId: session?.activeViewerId || "patient",
  };
}

export type CareClinical = ReturnType<typeof useCareClinical>;
