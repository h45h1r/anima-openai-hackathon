import { withRuntimeState } from '@/lib/store';
import { NextResponse } from "next/server";
import { runProactiveCheck } from "@/lib/agent/proactive";
import { ensureLoaded } from "@/lib/store";

export const maxDuration = 120;

async function handlePOST() {
  await ensureLoaded();
  const res = await runProactiveCheck();
  return NextResponse.json({ ok: true, ...res });
}

export async function POST() {
  return withRuntimeState(() => handlePOST());
}
