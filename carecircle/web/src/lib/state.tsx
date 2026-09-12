import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { api, ApiError, AskClientError, askViaWebSocket, isTransportFailure } from './api';

export interface SessionView {
  sessionId: string;
  animaBaseUrl: string;
  teamLabel?: string;
  worldId?: string;
  scopes: string[];
  selectedPatientId?: string;
  selectedPatientName?: string;
  activeViewerId: string;
  connectedAt?: string;
  lastSyncAt?: string;
  keyMasked: string;
  connected: boolean;
}

export interface PatientSummary {
  id: string;
  name: string;
  birthDate: string;
  synthetic: true;
  conditions: string[];
  needs: string[];
  goals: string[];
}

export interface AppState {
  session: SessionView | null;
  patient: PatientSummary | null;
  context: any | null;
  policy: any | null;
  suggestions: string[];
  status: 'disconnected' | 'connecting' | 'connected' | 'patient_loading' | 'ready' | 'error';
  error: string | null;
  lastAnswer: any | null;
  sourceOpen: any | null;
  askStatus: string | null;
  askStreamText: string;
  askTransport: 'ws' | 'rest' | null;
  memoriesWritten: { id: string; kind: string; text: string }[];
}

interface AppContextValue extends AppState {
  connect: (input: { apiKey?: string; teamName?: string; baseUrl?: string }) => Promise<void>;
  searchPatients: (q: string) => Promise<{ items: PatientSummary[]; total: number }>;
  selectPatient: (patientId: string) => Promise<void>;
  refreshContext: () => Promise<void>;
  setViewer: (viewerId: string) => Promise<void>;
  ask: (question: string) => Promise<void>;
  saveConsent: (viewerId: string, updates: Record<string, boolean>) => Promise<void>;
  setDisclosure: (resourceId: string, state: 'held' | 'cleared') => Promise<void>;
  advanceClock: (minutes?: number) => Promise<void>;
  openSource: (source: any | null) => void;
  resetDemo: () => Promise<void>;
  clearError: () => void;
}

const Ctx = createContext<AppContextValue | null>(null);
const SESSION_KEY = 'carecircle.sessionId';

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>({
    session: null,
    patient: null,
    context: null,
    policy: null,
    suggestions: [],
    status: 'disconnected',
    error: null,
    lastAnswer: null,
    sourceOpen: null,
    askStatus: null,
    askStreamText: '',
    askTransport: null,
    memoriesWritten: [],
  });

  const sid = state.session?.sessionId || localStorage.getItem(SESSION_KEY);

  const connect = useCallback(async (input: { apiKey?: string; teamName?: string; baseUrl?: string }) => {
    setState((s) => ({ ...s, status: 'connecting', error: null }));
    try {
      const res = await api<{ session: SessionView }>('/api/connect', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      localStorage.setItem(SESSION_KEY, res.session.sessionId);
      setState((s) => ({
        ...s,
        session: res.session,
        status: 'connected',
        patient: null,
        context: null,
        lastAnswer: null,
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        status: 'disconnected',
        error: err instanceof Error ? err.message : 'Connection failed',
      }));
      throw err;
    }
  }, []);

  const searchPatients = useCallback(
    async (q: string) => {
      const res = await api<{ items: PatientSummary[]; total: number }>(
        `/api/patients?q=${encodeURIComponent(q)}`,
        { sessionId: sid },
      );
      return res;
    },
    [sid],
  );

  const selectPatient = useCallback(
    async (patientId: string) => {
      setState((s) => ({ ...s, status: 'patient_loading', error: null, lastAnswer: null }));
      try {
        const res = await api<any>('/api/patients/select', {
          method: 'POST',
          sessionId: sid,
          body: JSON.stringify({ patientId }),
        });
        setState((s) => ({
          ...s,
          status: 'ready',
          session: res.session,
          patient: res.patient,
          policy: res.policy,
          context: res.context,
          suggestions: [],
        }));
        const ctx = await api<any>(`/api/patients/${patientId}/context?viewerId=patient`, { sessionId: sid });
        setState((s) => ({
          ...s,
          context: ctx.context,
          policy: ctx.policy,
          suggestions: ctx.suggestions || [],
          session: s.session ? { ...s.session, lastSyncAt: ctx.freshness } : s.session,
        }));
      } catch (err) {
        setState((s) => ({
          ...s,
          status: 'error',
          error: err instanceof Error ? err.message : 'Patient load failed',
        }));
        throw err;
      }
    },
    [sid],
  );

  const refreshContext = useCallback(async () => {
    if (!state.session?.selectedPatientId) return;
    setState((s) => ({ ...s, error: null }));
    try {
      const viewerId = state.session.activeViewerId;
      const ctx = await api<any>(
        `/api/patients/${state.session.selectedPatientId}/context?viewerId=${viewerId}`,
        { sessionId: sid },
      );
      setState((s) => ({
        ...s,
        context: ctx.context,
        policy: ctx.policy,
        suggestions: ctx.suggestions || [],
        status: 'ready',
        session: s.session ? { ...s.session, lastSyncAt: ctx.freshness } : s.session,
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        status: 'error',
        error: err instanceof Error ? err.message : 'Refresh failed — live data unavailable',
      }));
    }
  }, [sid, state.session?.selectedPatientId, state.session?.activeViewerId]);

  const setViewer = useCallback(
    async (viewerId: string) => {
      const res = await api<any>('/api/viewer', {
        method: 'POST',
        sessionId: sid,
        body: JSON.stringify({ viewerId }),
      });
      setState((s) => ({ ...s, session: res.session, policy: res.policy, lastAnswer: null }));
      if (res.session.selectedPatientId) {
        const ctx = await api<any>(
          `/api/patients/${res.session.selectedPatientId}/context?viewerId=${viewerId}`,
          { sessionId: sid },
        );
        setState((s) => ({
          ...s,
          context: ctx.context,
          suggestions: ctx.suggestions || [],
          policy: ctx.policy,
        }));
      }
    },
    [sid],
  );

  const ask = useCallback(
    async (question: string) => {
      if (!state.session?.selectedPatientId || !sid) throw new Error('Select a patient first');
      const patientId = state.session.selectedPatientId;
      const viewerId = state.session.activeViewerId;
      setState((s) => ({
        ...s,
        askStatus: 'Connecting…',
        askStreamText: '',
        askTransport: null,
        memoriesWritten: [],
        lastAnswer: null,
      }));

      try {
        const res = await askViaWebSocket(
          { sessionId: sid, patientId, viewerId, question },
          (event) => {
            if (event.type === 'status') {
              setState((s) => ({ ...s, askStatus: event.message, askTransport: 'ws' }));
            } else if (event.type === 'tool') {
              setState((s) => ({
                ...s,
                askStatus: `${event.tool}: ${event.detail || event.status}`,
                askTransport: 'ws',
              }));
            } else if (event.type === 'token') {
              setState((s) => ({
                ...s,
                askStreamText: s.askStreamText + event.text,
                askStatus: 'Streaming answer…',
                askTransport: 'ws',
              }));
            }
          },
        );
        setState((s) => ({
          ...s,
          lastAnswer: res.run,
          suggestions: res.suggestions || s.suggestions,
          askStatus: null,
          askStreamText: '',
          askTransport: 'ws',
          memoriesWritten: res.run?.memoriesWritten || [],
        }));
        return;
      } catch (wsErr) {
        // Semantic WS errors (wrong viewer, no patient, consent, Anima) — surface, do not REST-retry.
        if (wsErr instanceof AskClientError || !isTransportFailure(wsErr)) {
          const message = wsErr instanceof Error ? wsErr.message : 'Ask failed';
          setState((s) => ({
            ...s,
            askStatus: null,
            askStreamText: '',
            askTransport: 'ws',
            error: message,
          }));
          throw wsErr instanceof Error ? wsErr : new Error(message);
        }
        // Transport-only: fall back to REST
        setState((s) => ({ ...s, askStatus: 'Falling back to REST…', askTransport: 'rest' }));
        try {
          const res = await api<any>('/api/ask', {
            method: 'POST',
            sessionId: sid,
            body: JSON.stringify({ patientId, viewerId, question }),
          });
          setState((s) => ({
            ...s,
            lastAnswer: res.run,
            suggestions: res.suggestions || s.suggestions,
            askStatus: null,
            askStreamText: '',
            askTransport: 'rest',
            memoriesWritten: res.run?.memoriesWritten || res.memoriesWritten || [],
          }));
        } catch (restErr) {
          const message =
            restErr instanceof ApiError
              ? restErr.message
              : restErr instanceof Error
                ? restErr.message
                : 'Ask failed';
          setState((s) => ({
            ...s,
            askStatus: null,
            askStreamText: '',
            error: message,
          }));
          throw restErr instanceof Error ? restErr : new Error(message);
        }
      }
    },
    [sid, state.session?.selectedPatientId, state.session?.activeViewerId],
  );

  const saveConsent = useCallback(
    async (viewerId: string, updates: Record<string, boolean>) => {
      if (!state.session?.selectedPatientId || !state.policy) return;
      try {
        const res = await api<any>(`/api/consent/${state.session.selectedPatientId}`, {
          method: 'PUT',
          sessionId: sid,
          body: JSON.stringify({
            viewerId,
            updates,
            expectedVersion: state.policy.policyVersion,
          }),
        });
        setState((s) => ({ ...s, policy: res.policy, lastAnswer: null, error: null }));
      } catch (err) {
        setState((s) => ({
          ...s,
          error: err instanceof Error ? err.message : 'Consent update failed',
        }));
        throw err;
      }
    },
    [sid, state.session?.selectedPatientId, state.policy],
  );

  const setDisclosure = useCallback(
    async (resourceId: string, dState: 'held' | 'cleared') => {
      if (!state.session?.selectedPatientId) return;
      const res = await api<any>(`/api/disclosure/${state.session.selectedPatientId}`, {
        method: 'POST',
        sessionId: sid,
        body: JSON.stringify({ resourceId, state: dState }),
      });
      setState((s) => ({ ...s, policy: res.policy, lastAnswer: null }));
    },
    [sid, state.session?.selectedPatientId],
  );

  const advanceClock = useCallback(
    async (minutes = 121) => {
      await api('/api/clock/advance', {
        method: 'POST',
        sessionId: sid,
        body: JSON.stringify({ advanceMinutes: minutes }),
      });
      await refreshContext();
    },
    [sid, refreshContext],
  );

  const resetDemo = useCallback(async () => {
    await api('/api/demo/reset', { method: 'POST', sessionId: sid, body: '{}' });
    await refreshContext();
  }, [sid, refreshContext]);

  const value = useMemo<AppContextValue>(
    () => ({
      ...state,
      connect,
      searchPatients,
      selectPatient,
      refreshContext,
      setViewer,
      ask,
      saveConsent,
      setDisclosure,
      advanceClock,
      openSource: (source) => setState((s) => ({ ...s, sourceOpen: source })),
      resetDemo,
      clearError: () => setState((s) => ({ ...s, error: null })),
    }),
    [
      state,
      connect,
      searchPatients,
      selectPatient,
      refreshContext,
      setViewer,
      ask,
      saveConsent,
      setDisclosure,
      advanceClock,
      resetDemo,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppProvider missing');
  return v;
}
