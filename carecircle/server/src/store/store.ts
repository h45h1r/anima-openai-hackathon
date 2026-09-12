import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { ConsentPolicyState } from '../consent/policy.js';
import { createDefaultPolicy } from '../consent/policy.js';
import type { AgentRunResult, ToolObservation } from '../types/domain.js';
import type { CareCircleMemoryItem } from '../agent/memoryStore.js';

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
}

export class CareCircleStore {
  private data: CareCircleStoreData;
  private readonly filePath: string;

  constructor(dataDir: string) {
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
      };
    } else {
      this.data = { sessions: {}, policies: {}, runs: [], toolLog: [], memories: [] };
      this.persist();
    }
  }

  listMemories(): CareCircleMemoryItem[] {
    return this.data.memories || [];
  }

  saveMemories(items: CareCircleMemoryItem[]) {
    this.data.memories = items.slice(-500);
    this.persist();
  }

  private persist() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  createSession(partial: Omit<SessionState, 'sessionId' | 'createdAt' | 'activeViewerId' | 'knownResourceIds' | 'scopes'> & { scopes?: string[] }): SessionState {
    const session: SessionState = {
      sessionId: nanoid(12),
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
    } else {
      this.data.policies = {};
      this.data.runs = [];
      this.data.toolLog = [];
      this.data.memories = [];
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
