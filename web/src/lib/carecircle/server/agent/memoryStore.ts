/**
 * Viewer+patient scoped UX memories via Anima ADK memory APIs.
 * Never store raw protected clinical dumps (labs, full documents) here.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { memory, inMemoryIndex, type Embedder, type Memory } from '@animahealth/adk';

export const memoryKinds = ['preference', 'clarification', 'consent_summary', 'greeting'] as const;
export type MemoryKind = (typeof memoryKinds)[number];

export const memoryMetaSchema = z.object({
  patientId: z.string(),
  viewerId: z.string(),
  kind: z.enum(memoryKinds),
  createdAt: z.string(),
});

export type MemoryMeta = z.infer<typeof memoryMetaSchema>;

export type CareCircleMemoryItem = {
  id: string;
  content: string;
  metadata: MemoryMeta;
};

/** Lightweight local embedder — no Voyage key required for hackathon MVP. */
export function localHashEmbedder(dimensions = 64): Embedder {
  return {
    dimensions,
    modelName: 'carecircle-local-hash',
    async embed(input) {
      return {
        embeddings: input.map((text) => hashEmbed(text, dimensions)),
        model: 'carecircle-local-hash',
        usage: { totalTokens: input.join('').length },
      };
    },
  };
}

function hashEmbed(text: string, dimensions: number): number[] {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
  const vec = new Array(dimensions).fill(0);
  for (const token of tokens.length ? tokens : ['empty']) {
    const digest = createHash('sha256').update(token).digest();
    for (let i = 0; i < dimensions; i++) {
      const b = digest[i % digest.length]!;
      vec[i] += ((b / 255) * 2 - 1) / Math.sqrt(tokens.length || 1);
    }
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

/** Reject memories that look like protected clinical dumps. */
export function isSafeMemoryContent(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 280) return false;
  // Block obvious lab / result dumps
  if (/\b(ALT|ALP|eGFR|HbA1c|mmol|U\/L|mg\/dL)\b/i.test(t) && /\d/.test(t)) return false;
  if (/evidenceId|resourceId|SIM-\d{6}/i.test(t) && /\d{2,}/.test(t)) return false;
  return true;
}

export function createCareCircleMemory(): Memory<MemoryMeta> {
  return memory({
    model: localHashEmbedder(64),
    index: inMemoryIndex(),
    collection: 'carecircle_ux_memories',
    metadata: memoryMetaSchema,
  });
}

export class ScopedMemoryService {
  private readonly mem: Memory<MemoryMeta>;
  /** Disk-backed mirror for demo restarts — still scoped by patient+viewer. */
  private disk: Map<string, CareCircleMemoryItem[]>;
  private persist?: (all: CareCircleMemoryItem[]) => void;

  constructor(opts?: {
    initial?: CareCircleMemoryItem[];
    persist?: (all: CareCircleMemoryItem[]) => void;
  }) {
    this.mem = createCareCircleMemory();
    this.disk = new Map();
    this.persist = opts?.persist;
    if (opts?.initial?.length) {
      void this.hydrate(opts.initial);
    }
  }

  private scopeKey(patientId: string, viewerId: string) {
    return `${patientId}::${viewerId}`;
  }

  private allDisk(): CareCircleMemoryItem[] {
    return [...this.disk.values()].flat();
  }

  async hydrate(items: CareCircleMemoryItem[]) {
    for (const item of items) {
      const key = this.scopeKey(item.metadata.patientId, item.metadata.viewerId);
      const list = this.disk.get(key) || [];
      if (!list.some((x) => x.id === item.id)) list.push(item);
      this.disk.set(key, list.slice(-40));
    }
    if (items.length) {
      await this.mem.upsert(
        items.map((i) => ({
          id: i.id,
          content: i.content,
          metadata: i.metadata,
        })),
      );
    }
  }

  async recall(input: {
    patientId: string;
    viewerId: string;
    question: string;
    topK?: number;
  }): Promise<CareCircleMemoryItem[]> {
    const filter = { patientId: input.patientId, viewerId: input.viewerId };
    try {
      const result = await this.mem.search(input.question || 'preferences', {
        topK: input.topK ?? 6,
        filter,
      });
      if (result.matches.length) {
        return result.matches.map((m) => ({
          id: m.id,
          content: m.content,
          metadata: m.metadata,
        }));
      }
    } catch {
      /* fall through to disk */
    }
    const key = this.scopeKey(input.patientId, input.viewerId);
    return (this.disk.get(key) || []).slice(-6).reverse();
  }

  async remember(input: {
    patientId: string;
    viewerId: string;
    kind: MemoryKind;
    text: string;
  }): Promise<CareCircleMemoryItem | null> {
    if (!isSafeMemoryContent(input.text)) return null;
    const id = `mem_${createHash('sha1')
      .update(`${input.patientId}|${input.viewerId}|${input.kind}|${input.text}`)
      .digest('hex')
      .slice(0, 16)}`;
    const item: CareCircleMemoryItem = {
      id,
      content: input.text.trim(),
      metadata: {
        patientId: input.patientId,
        viewerId: input.viewerId,
        kind: input.kind,
        createdAt: new Date().toISOString(),
      },
    };
    await this.mem.upsert({
      id: item.id,
      content: item.content,
      metadata: item.metadata,
    });
    const key = this.scopeKey(input.patientId, input.viewerId);
    const list = (this.disk.get(key) || []).filter((x) => x.id !== id);
    list.push(item);
    this.disk.set(key, list.slice(-40));
    this.persist?.(this.allDisk());
    return item;
  }

  /** Test helper — ensure Tom cannot read Amira labs via Sarah's memories either. */
  async listScoped(patientId: string, viewerId: string): Promise<CareCircleMemoryItem[]> {
    return this.disk.get(this.scopeKey(patientId, viewerId)) || [];
  }

  async close() {
    await this.mem.close().catch(() => undefined);
  }
}
