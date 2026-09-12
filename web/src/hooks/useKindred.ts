"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppState, Category, Message, SharingLevel } from "@/lib/types";

interface PendingChat {
  patientId: string;
  message: Message;
  knownIds: Set<string>;
  replyId?: string;
}

const chatScope = (patientId: string, threadId: string, actorId: string) => `${patientId}:${actorId}:${threadId}`;

export function useKindred() {
  const [state, setState] = useState<AppState | null>(null);
  const [connected, setConnected] = useState(false);
  const [patientRevision, setPatientRevision] = useState(0);
  const esRef = useRef<EventSource | null>(null);
  const [pendingChats, setPendingChats] = useState<Record<string, PendingChat>>({});
  const chatSendLocks = useRef(new Set<string>());
  const [chatFailures, setChatFailures] = useState<Record<string, { text: string; error: string }>>({});

  useEffect(() => {
    if (!state?.loaded) return;
    const messageIds = new Set(state.messages.map(message => message.id));
    const completed = Object.entries(pendingChats).filter(([, pending]) =>
      pending.patientId === state.patient.simId && pending.replyId && messageIds.has(pending.replyId));
    if (!completed.length) return;
    for (const [scope] of completed) chatSendLocks.current.delete(scope);
    setPendingChats(current => {
      const next = { ...current };
      for (const [scope, pending] of completed) if (next[scope] === pending) delete next[scope];
      return next;
    });
  }, [state, pendingChats]);

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
    getPendingChat: (threadId: string, actorId: string) => pendingChats[chatScope(state?.patient.simId || "", threadId, actorId)],
    getChatFailure: (threadId: string, actorId: string) => chatFailures[chatScope(state?.patient.simId || "", threadId, actorId)],
    dismissChatFailure: (threadId: string, actorId: string) => {
      const scope = chatScope(state?.patient.simId || "", threadId, actorId);
      setChatFailures(current => { const next = { ...current }; delete next[scope]; return next; });
    },
    sendChat: async (threadId: string, actorId: string, text: string) => {
      if (!state?.loaded) throw new Error("The patient record is still loading.");
      const patientId = state.patient.simId;
      const scope = chatScope(patientId, threadId, actorId);
      if (chatSendLocks.current.has(scope)) return;
      chatSendLocks.current.add(scope);
      setChatFailures(current => { const next = { ...current }; delete next[scope]; return next; });
      const pending: PendingChat = {
        patientId,
        message: { id: crypto.randomUUID(), threadId, senderId: actorId, text, ts: new Date().toISOString(), kind: "chat" },
        knownIds: new Set(state.messages.map(message => message.id)),
      };
      setPendingChats(current => ({ ...current, [scope]: pending }));
      try {
        const response = await post("/api/chat", { chatId: threadId, actorId, text });
        setPendingChats(current => current[scope]?.message.id === pending.message.id
          ? { ...current, [scope]: { ...current[scope], replyId: response.messageId } }
          : current);
      } catch (error) {
        chatSendLocks.current.delete(scope);
        setChatFailures(current => ({ ...current, [scope]: { text, error: error instanceof Error ? error.message : String(error) } }));
        setPendingChats(current => {
          if (current[scope]?.message.id !== pending.message.id) return current;
          const next = { ...current };
          delete next[scope];
          return next;
        });
        throw error;
      }
    },
    clearChat: (threadId: string, actorId: string) => post("/api/chat/clear", { chatId: threadId, actorId }),
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
