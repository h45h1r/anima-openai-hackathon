import { withRuntimeState } from '@/lib/store';
import { NextResponse } from "next/server";
import { resetState } from "@/lib/store";

async function handlePOST() {
  await resetState();
  return NextResponse.json({ ok: true });
}

export async function POST() {
  return withRuntimeState(() => handlePOST());
}
