import { NextResponse } from "next/server";
import { agentTurn } from "@/lib/agent/runtime";
import { ensureLoaded } from "@/lib/store";

export const maxDuration = 120;

export async function POST(req: Request) {
  const body = (await req.json()) as { threadId: string; actorId: string; text: string };
  const state = await ensureLoaded();
  const thread = state.threads[body.threadId];
  if (!thread) return NextResponse.json({ error: "unknown thread" }, { status: 400 });
  if (!thread.memberIds.includes(body.actorId)) return NextResponse.json({ error: "not a member" }, { status: 403 });
  if (!body.text?.trim()) return NextResponse.json({ error: "empty" }, { status: 400 });
  if (state.busyThreads.includes(body.threadId)) return NextResponse.json({ error: "Kindred is still replying" }, { status: 409 });
  const msg = await agentTurn({ threadId: body.threadId, actorId: body.actorId, text: body.text.trim() });
  return NextResponse.json({ ok: true, messageId: msg.id });
}
