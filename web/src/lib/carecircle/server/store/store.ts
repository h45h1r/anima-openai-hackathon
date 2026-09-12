import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { ConsentPolicyState } from '../consent/policy';
import { createDefaultPolicy } from '../consent/policy';
import type { AgentRunResult, ToolObservation } from '../types/domain';
import type { CareCircleMemoryItem } from '../agent/memoryStore';
import type { ChatTurn } from '../agent/grounding';

export interface SessionState {
  sessionId: string;
  createdAt: string;
  animaBaseUrl: string;
  /** Server-only; never sent to clients in full */
  animaApiKey: string;
  teamLabel?: string;
  worldId?: string;
  scopes: string[];
  selectedPatientId?: string;
  selectedPatientName?: string;
  activeViewerId: string;
  connectedAt?: string;
  lastSyncAt?: string;
  knownResourceIds: Record<string, string[]>; // patientId -> resource ids seen
}

export interface CareCircleStoreData {
  sessions: Record<string, SessionState>;
  policies: Record<string, ConsentPolicyState>; // keyed by patientId
  runs: AgentRunResult[];
  toolLog: ToolObservation[];
  /** Viewer+patient scoped UX memories (never raw protected clinical dumps). */
  memories: CareCircleMemoryItem[];
  /** Short ask threads keyed by sessionId::patientId::viewerId */
  chatTurns: Record<string, ChatTurn[]>;
}

export class CareCircleStore {
  private data: CareCircleStoreData;
  private readonly filePath?: string;

  constructor(dataDir?: string, snapshot?: Partial<CareCircleStoreData>, private readonly sessionId?: string) {
    if (!dataDir) {
      this.data = { sessions: {}, policies: {}, runs: [], toolLog: [], memories: [], chatTurns: {}, ...snapshot };
      return;
    }
    fs.mkdirSync(dataDir, { recursive: true });
    this.filePath = path.join(dataDir, 'store.json');
    if (fs.existsSync(this.filePath)) {
      const loaded = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<CareCircleStoreData>;
      this.data = {
        sessions: loaded.sessions || {},
        policies: loaded.policies || {},
        runs: loaded.runs || [],
        toolLog: loaded.toolLog || [],
        memories: loaded.memories || [],
        chatTurns: loaded.chatTurns || {},
      };
    } else {
      this.data = { sessions: {}, policies: {}, runs: [], toolLog: [], memories: [], chatTurns: {} };
      this.persist();
    }
  }

  snapshot(): CareCircleStoreData { return this.data; }

  listMemories(): CareCircleMemoryItem[] {
    return this.data.memories || [];
  }

  saveMemories(items: CareCircleMemoryItem[]) {
    this.data.memories = items.slice(-500);
    this.persist();
  }

  private persist() {
    if (this.filePath) fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  createSession(partial: Omit<SessionState, 'sessionId' | 'createdAt' | 'activeViewerId' | 'knownResourceIds' | 'scopes'> & { scopes?: string[] }): SessionState {
    const session: SessionState = {
      sessionId: this.sessionId || nanoid(12),
      createdAt: new Date().toISOString(),
      activeViewerId: 'patient',
      knownResourceIds: {},
      scopes: partial.scopes || [],
      ...partial,
    };
    this.data.sessions[session.sessionId] = session;
    this.persist();
    return session;
  }

  getSession(sessionId: string): SessionState | undefined {
    return this.data.sessions[sessionId];
  }

  updateSession(sessionId: string, patch: Partial<SessionState>): SessionState {
    const current = this.data.sessions[sessionId];
    if (!current) throw new Error('SESSION_NOT_FOUND');
    const next = { ...current, ...patch, sessionId };
    this.data.sessions[sessionId] = next;
    this.persist();
    return next;
  }

  ensurePolicy(patientId: string, patientName: string): ConsentPolicyState {
    if (!this.data.policies[patientId]) {
      this.data.policies[patientId] = createDefaultPolicy(patientId, patientName);
      this.persist();
    }
    return this.data.policies[patientId];
  }

  getPolicy(patientId: string): ConsentPolicyState | undefined {
    return this.data.policies[patientId];
  }

  savePolicy(policy: ConsentPolicyState): ConsentPolicyState {
    this.data.policies[policy.patientId] = policy;
    this.persist();
    return policy;
  }

  resetCareCircleState(patientId?: string) {
    if (patientId) {
      delete this.data.policies[patientId];
      this.data.runs = this.data.runs.filter((r) => r.patientId !== patientId);
      this.data.memories = (this.data.memories || []).filter((m) => m.metadata.patientId !== patientId);
      for (const key of Object.keys(this.data.chatTurns || {})) {
        if (key.includes(`::${patientId}::`)) delete this.data.chatTurns[key];
      }
    } else {
      this.data.policies = {};
      this.data.runs = [];
      this.data.toolLog = [];
      this.data.memories = [];
      this.data.chatTurns = {};
    }
    this.persist();
  }

  private chatKey(sessionId: string, patientId: string, viewerId: string) {
    return `${sessionId}::${patientId}::${viewerId}`;
  }

  getChatTurns(sessionId: string, patientId: string, viewerId: string): ChatTurn[] {
    return [...(this.data.chatTurns?.[this.chatKey(sessionId, patientId, viewerId)] || [])];
  }

  appendChatTurns(sessionId: string, patientId: string, viewerId: string, turns: ChatTurn[]) {
    if (!this.data.chatTurns) this.data.chatTurns = {};
    const key = this.chatKey(sessionId, patientId, viewerId);
    const next = [...(this.data.chatTurns[key] || []), ...turns].slice(-16);
    this.data.chatTurns[key] = next;
    this.persist();
    return next;
  }

  clearChatTurns(sessionId: string, patientId?: string, viewerId?: string) {
    if (!this.data.chatTurns) return;
    if (!patientId) {
      for (const key of Object.keys(this.data.chatTurns)) {
        if (key.startsWith(`${sessionId}::`)) delete this.data.chatTurns[key];
      }
    } else if (!viewerId) {
      for (const key of Object.keys(this.data.chatTurns)) {
        if (key.startsWith(`${sessionId}::${patientId}::`)) delete this.data.chatTurns[key];
      }
    } else {
      delete this.data.chatTurns[this.chatKey(sessionId, patientId, viewerId)];
    }
    this.persist();
  }

  addRun(run: AgentRunResult) {
    this.data.runs.unshift(run);
    this.data.runs = this.data.runs.slice(0, 100);
    this.persist();
  }

  listRuns(patientId: string) {
    return this.data.runs.filter((r) => r.patientId === patientId).slice(0, 20);
  }

  publicSessionView(session: SessionState) {
    const key = session.animaApiKey || '';
    const masked =
      key.length <= 8 ? (key ? '••••' : '') : `${key.slice(0, 4)}…${key.slice(-4)}`;
    return {
      sessionId: session.sessionId,
      animaBaseUrl: session.animaBaseUrl,
      teamLabel: session.teamLabel,
      worldId: session.worldId,
      scopes: session.scopes,
      selectedPatientId: session.selectedPatientId,
      selectedPatientName: session.selectedPatientName,
      activeViewerId: session.activeViewerId,
      connectedAt: session.connectedAt,
      lastSyncAt: session.lastSyncAt,
      keyMasked: masked,
      connected: Boolean(session.animaApiKey),
    };
  }
}
