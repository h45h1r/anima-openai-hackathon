import { NextResponse } from 'next/server';
import { clearDirectChat, ensureLoaded, withRuntimeState } from '@/lib/store';

export async function POST(request: Request) {
  return withRuntimeState(async () => {
    const { threadId, actorId } = await request.json();
    if (typeof threadId !== 'string' || typeof actorId !== 'string') return NextResponse.json({ error: 'Choose a conversation.' }, { status: 400 });
    await ensureLoaded();
    try { clearDirectChat(threadId, actorId); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not clear this conversation.' }, { status: 400 }); }
    return NextResponse.json({ ok: true });
  });
}
