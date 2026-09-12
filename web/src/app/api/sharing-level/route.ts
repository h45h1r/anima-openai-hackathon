import { NextResponse } from "next/server";
import { ensureLoaded, setSharingLevel } from "@/lib/store";
import type { SharingLevel } from "@/lib/types";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { granteeId: string; level: SharingLevel; actorId?: string };
    const state = await ensureLoaded();
    if (!state.consent[body.granteeId]) return NextResponse.json({ error: "unknown grantee" }, { status: 400 });
    const actorId = body.actorId ?? state.patientId;
    const res = await setSharingLevel({ granteeId: body.granteeId, level: body.level, actorId, via: "app" });
    return NextResponse.json({ ok: true, ...res });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sharing level could not be saved." }, { status: (error as { status?: number }).status || 503 });
  }
}
