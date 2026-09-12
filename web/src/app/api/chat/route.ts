import { chatId as resolveChatId } from '@/lib/chat-ids';
import { withRuntimeState } from '@/lib/store';
import { NextResponse } from "next/server";
import { agentTurn } from "@/lib/agent/runtime";
import { ensureLoaded } from "@/lib/store";

export const maxDuration = 180;

async function handlePOST(req: Request) {
  const body = (await req.json()) as { threadId?: string; chatId?: string; actorId: string; text: string };
  const state = await ensureLoaded();
  const requestedId = body.chatId || body.threadId;
  if (typeof requestedId !== 'string') return NextResponse.json({ error: 'Choose a chat.' }, { status: 400 });
  const threadId = resolveChatId(state.patient.simId, requestedId);
  const thread = state.threads[threadId];
  if (!thread) return NextResponse.json({ error: "unknown thread" }, { status: 400 });
  if (!thread.memberIds.includes(body.actorId)) return NextResponse.json({ error: "not a member" }, { status: 403 });
  if (!body.text?.trim()) return NextResponse.json({ error: "empty" }, { status: 400 });
  if (state.busyThreads.includes(threadId)) return NextResponse.json({ error: "Kindred is still replying" }, { status: 409 });
  const msg = await agentTurn({ threadId, actorId: body.actorId, text: body.text.trim() });
  return NextResponse.json({ ok: true, chatId: threadId, messageId: msg.id });
}

export async function POST(req: Request) {
  return withRuntimeState(() => handlePOST(req));
}
