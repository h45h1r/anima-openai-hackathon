import { NextResponse } from "next/server";
import { ensureLoaded, setConsent } from "@/lib/store";
import { CATEGORIES, type Category } from "@/lib/types";

export async function PATCH(req: Request) {
  try {
  const body = (await req.json()) as { granteeId: string; category: Category; allowed: boolean; actorId?: string; expectedVersion?: number };
  const state = await ensureLoaded();
  if (!state.consent[body.granteeId]) return NextResponse.json({ error: "unknown grantee" }, { status: 400 });
  if (!CATEGORIES.some((c) => c.id === body.category)) return NextResponse.json({ error: "unknown category" }, { status: 400 });
  const actorId = body.actorId ?? state.patientId;
  if (actorId !== state.patientId) return NextResponse.json({ error: "only the patient can change consent" }, { status: 403 });
  if (typeof body.allowed !== 'boolean' || !Number.isInteger(body.expectedVersion)) return NextResponse.json({error:'A boolean choice and current member version are required.'},{status:400});
  const res = await setConsent({ granteeId: body.granteeId, category: body.category, allowed: body.allowed, expectedVersion: body.expectedVersion, actorId, via: "app" });
  return NextResponse.json({ ok: true, ...res });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Consent could not be saved.' }, {status:(error as {status?:number}).status || 503}); }
}
