import type { AgentRunResult, MemorySnippet } from '../types/domain.js';

/** Wire events for /ws/ask (and optional REST progress hooks). */
export type AskStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'tool'; tool: string; status: 'ok' | 'error' | 'skipped'; detail?: string }
  | { type: 'token'; text: string }
  | {
      type: 'final';
      run: AgentRunResult;
      memoriesUsed: MemorySnippet[];
      memoriesWritten: MemorySnippet[];
      suggestions?: string[];
    }
  | { type: 'error'; message: string; code?: string };

export type AskEventSink = (event: AskStreamEvent) => void;
