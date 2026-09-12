import { withRuntimeState } from '@/lib/store';
import { NextResponse } from "next/server";
import { ensureLoaded, setLevelDefinition } from "@/lib/store";
import type { Category, SharingLevel } from "@/lib/types";

async function handlePATCH(req: Request) {
  try {
    const body = (await req.json()) as { level: SharingLevel; categories: Category[]; actorId?: string };
    const state = await ensureLoaded();
    const actorId = body.actorId ?? state.patientId;
    const res = await setLevelDefinition({ level: body.level, categories: Array.isArray(body.categories) ? body.categories : [], actorId });
    return NextResponse.json(res);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Level could not be saved." }, { status: (error as { status?: number }).status || 503 });
  }
}

export async function PATCH(req: Request) {
  return withRuntimeState(() => handlePATCH(req));
}
