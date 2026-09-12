import { withRuntimeState } from '@/lib/store';
import { NextResponse } from "next/server";
import { ensureLoaded } from "@/lib/store";

export const dynamic = "force-dynamic";

async function handleGET() {
  return NextResponse.json(await ensureLoaded());
}

export async function GET() {
  return withRuntimeState(() => handleGET(), false);
}
