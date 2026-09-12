import { NextResponse } from "next/server";
import { runProactiveCheck } from "@/lib/agent/proactive";
import { ensureLoaded } from "@/lib/store";

export const maxDuration = 120;

export async function POST() {
  await ensureLoaded();
  const res = await runProactiveCheck();
  return NextResponse.json({ ok: true, ...res });
}
