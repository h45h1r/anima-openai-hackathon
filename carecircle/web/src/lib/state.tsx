import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
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

export type AskThreadMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  run?: any;
};

export interface AppState {
  session: SessionView | null;
  patient: PatientSummary | null;
  context: any | null;
  policy: any | null;
  suggestions: string[];
  status: 'disconnected' | 'connecting' | 'connected' | 'patient_loading' | 'ready' | 'error';
  error: string | null;
  lastAnswer: any | null;
  askThread: AskThreadMessage[];
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
  clearAskThread: () => void;
}

const Ctx = createContext<AppContextValue | null>(null);
const SESSION_KEY = 'carecircle.sessionId';

function threadKey(patientId?: string, viewerId?: string) {
  return `${patientId || ''}::${viewerId || ''}`;
}

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
    askThread: [],
    sourceOpen: null,
    askStatus: null,
    askStreamText: '',
    askTransport: null,
    memoriesWritten: [],
  });

  const sid = state.session?.sessionId || localStorage.getItem(SESSION_KEY);
  const selectLock = useRef(false);
  const threadScope = useRef('');

  const connect = useCallback(async (input: { apiKey?: string; teamName?: string; baseUrl?: string }) => {
    setState((s) => ({ ...s, status: 'connecting', error: null }));
    try {
      const res = await api<{ session: SessionView }>('/api/connect', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      localStorage.setItem(SESSION_KEY, res.session.sessionId);
      threadScope.current = '';
      setState((s) => ({
        ...s,
        session: res.session,
        status: 'connected',
        patient: null,
        context: null,
        lastAnswer: null,
        askThread: [],
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
      if (selectLock.current) return;
      selectLock.current = true;
      setState((s) => ({
        ...s,
        status: 'patient_loading',
        error: null,
        lastAnswer: null,
        askThread: [],
      }));
      try {
        const res = await api<any>('/api/patients/select', {
          method: 'POST',
          sessionId: sid,
          body: JSON.stringify({ patientId }),
        });
        threadScope.current = threadKey(res.session?.selectedPatientId || patientId, res.session?.activeViewerId || 'patient');
        setState((s) => ({
          ...s,
          status: 'ready',
          session: res.session,
          patient: res.patient,
          policy: res.policy,
          context: res.context,
          suggestions: [],
          askThread: [],
          lastAnswer: null,
        }));
        // Context refresh is best-effort; selection already succeeded with embedded context.
        try {
          const ctx = await api<any>(`/api/patients/${patientId}/context?viewerId=patient`, { sessionId: sid });
          setState((s) => ({
            ...s,
            context: ctx.context,
            policy: ctx.policy,
            suggestions: ctx.suggestions || [],
            session: s.session ? { ...s.session, lastSyncAt: ctx.freshness } : s.session,
          }));
        } catch {
          /* keep select response context */
        }
      } catch (err) {
        setState((s) => ({
          ...s,
          status: 'error',
          error: err instanceof Error ? err.message : 'Patient load failed',
        }));
        throw err;
      } finally {
        selectLock.current = false;
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
      const nextKey = threadKey(res.session?.selectedPatientId, viewerId);
      const resetThread = threadScope.current !== nextKey;
      threadScope.current = nextKey;
      setState((s) => ({
        ...s,
        session: res.session,
        policy: res.policy,
        lastAnswer: null,
        askThread: resetThread ? [] : s.askThread,
      }));
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
      const scope = threadKey(patientId, viewerId);
      if (threadScope.current !== scope) {
        threadScope.current = scope;
      }

      const history = state.askThread
        .filter((m) => m.text.trim())
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.text }));

      const userMsg: AskThreadMessage = {
        id: `u_${Date.now()}`,
        role: 'user',
        text: question,
      };

      setState((s) => ({
        ...s,
        askStatus: 'Connecting…',
        askStreamText: '',
        askTransport: null,
        memoriesWritten: [],
        askThread: [...s.askThread, userMsg],
      }));

      const finishOk = (res: { run: any; suggestions?: string[] }, transport: 'ws' | 'rest') => {
        const assistant: AskThreadMessage = {
          id: `a_${res.run?.runId || Date.now()}`,
          role: 'assistant',
          text: res.run?.answer?.answer || '',
          run: res.run,
        };
        setState((s) => ({
          ...s,
          lastAnswer: res.run,
          suggestions: res.suggestions || s.suggestions,
          askStatus: null,
          askStreamText: '',
          askTransport: transport,
          memoriesWritten: res.run?.memoriesWritten || [],
          askThread: [...s.askThread, assistant],
        }));
      };

      try {
        const res = await askViaWebSocket(
          { sessionId: sid, patientId, viewerId, question, history },
          (event) => {
            if (event.type === 'status') {
              setState((s) => ({
                ...s,
                askStatus: calmAskStatus(event.message),
                askTransport: 'ws',
              }));
            } else if (event.type === 'tool') {
              setState((s) => ({
                ...s,
                askStatus: calmToolStatus(event.tool),
                askTransport: 'ws',
              }));
            } else if (event.type === 'stream_reset') {
              setState((s) => ({
                ...s,
                askStreamText: '',
                askStatus: s.askStatus || 'Writing…',
                askTransport: 'ws',
              }));
            } else if (event.type === 'token') {
              setState((s) => ({
                ...s,
                askStreamText: s.askStreamText + event.text,
                askStatus: 'Writing…',
                askTransport: 'ws',
              }));
            }
          },
        );
        finishOk(res, 'ws');
        return;
      } catch (wsErr) {
        if (wsErr instanceof AskClientError || !isTransportFailure(wsErr)) {
          const message = wsErr instanceof Error ? wsErr.message : 'Ask failed';
          setState((s) => ({
            ...s,
            askStatus: null,
            askStreamText: '',
            askTransport: 'ws',
            error: message,
            // Keep the user turn so they can retry; remove only if empty thread edge case.
          }));
          throw wsErr instanceof Error ? wsErr : new Error(message);
        }
        setState((s) => ({ ...s, askStatus: 'Falling back to REST…', askTransport: 'rest' }));
        try {
          const res = await api<any>('/api/ask', {
            method: 'POST',
            sessionId: sid,
            body: JSON.stringify({ patientId, viewerId, question, history }),
          });
          finishOk(res, 'rest');
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
    [sid, state.session?.selectedPatientId, state.session?.activeViewerId, state.askThread],
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

  const clearAskThread = useCallback(() => {
    setState((s) => ({ ...s, askThread: [], lastAnswer: null, askStreamText: '' }));
  }, []);

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
      clearAskThread,
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
      clearAskThread,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppProvider missing');
  return v;
}

/** Map server status strings to calm, judge-friendly copy (never tool dumps). */
function calmAskStatus(message: string): string {
  const m = String(message || '').trim();
  if (!m) return 'Retrieving…';
  if (/^ADK:/i.test(m) || /^Tool:/i.test(m)) return 'Checking…';
  if (/retriev|prepar|connect|evidence|context/i.test(m)) return 'Retrieving…';
  if (/consent|disclosure/i.test(m)) return 'Checking consent…';
  if (/appoint/i.test(m)) return 'Checking appointments…';
  if (/writ|stream|ask|openai|refine|model/i.test(m)) return 'Writing…';
  if (/prefer|remember|memory/i.test(m)) return 'Checking preferences…';
  // Already calm short messages from the server
  if (/^(Retrieving|Checking|Writing|Saving|Updating)/i.test(m)) return m.replace(/\.\.\.$/, '…');
  return 'Working…';
}

function calmToolStatus(tool: string): string {
  switch (tool) {
    case 'patient.context.read':
      return 'Retrieving…';
    case 'consent.evaluate':
      return 'Checking consent…';
    case 'memory.recall':
      return 'Checking preferences…';
    case 'appointment_assist':
      return 'Checking appointments…';
    case 'answer.generate':
    case 'answer.refine':
      return 'Writing…';
    case 'remember':
      return 'Saving preference…';
    case 'update_consent':
      return 'Updating access…';
    default:
      return 'Checking…';
  }
}
