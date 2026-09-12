import { createHash } from 'node:crypto';
import type { AppState } from './types';

const namespace = Buffer.from('12c2396362cf4dfca6403692c36b7ce0', 'hex');
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// UUIDv5 keeps existing conversations stable across serverless instances.
export function chatId(patientId: string, previousId: string): string {
  if (uuidPattern.test(previousId)) return previousId.toLowerCase();
  const bytes = createHash('sha1').update(namespace).update(`${patientId}:${previousId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type ChatState = Pick<AppState, 'threads' | 'messages' | 'busyThreads'> & { patient: { simId: string } };

export function normaliseChatIds<T extends ChatState>(state: T): T {
  const id = (previousId: string) => chatId(state.patient.simId, previousId);
  return { ...state,
    threads: Object.fromEntries(Object.values(state.threads).map(thread => [id(thread.id), { ...thread, id: id(thread.id) }])),
    messages: state.messages.map(message => ({ ...message, threadId: id(message.threadId) })),
    busyThreads: state.busyThreads.map(id),
  };
}
