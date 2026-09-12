import { chatId as resolveChatId } from '@/lib/chat-ids';
import { NextResponse } from 'next/server';
import { clearDirectChat, ensureLoaded, withRuntimeState } from '@/lib/store';

export async function POST(request: Request) {
  return withRuntimeState(async () => {
    const body = await request.json();
    const threadId = body.chatId || body.threadId;
    const actorId = body.actorId;
    if (typeof threadId !== 'string' || typeof actorId !== 'string') return NextResponse.json({ error: 'Choose a conversation.' }, { status: 400 });
    const state = await ensureLoaded();
    const id = resolveChatId(state.patient.simId, threadId);
    try { clearDirectChat(id, actorId); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not clear this conversation.' }, { status: 400 }); }
    return NextResponse.json({ ok: true, chatId: id });
  });
}
