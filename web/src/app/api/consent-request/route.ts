import { NextResponse } from "next/server";
import { addAudit, addMessage, ensureLoaded, mutate, setConsent, threadForPair } from "@/lib/store";
import { CATEGORIES, personById } from "@/lib/types";

export async function POST(req: Request) {
  const body = (await req.json()) as { requestId: string; approve: boolean };
  const state = await ensureLoaded();
  const reqRec = state.consentRequests.find((r) => r.id === body.requestId);
  if (!reqRec || reqRec.status !== "pending") return NextResponse.json({ error: "no such pending request" }, { status: 400 });
  const status = body.approve ? "approved" : "declined";
  const requester = personById(state, reqRec.requesterId);
  const cat = CATEGORIES.find((c) => c.id === reqRec.category)!;
  if (body.approve) {
    try { await setConsent({ granteeId: reqRec.requesterId, category: reqRec.category, allowed: true, actorId: state.patientId, via: "request" }); }
    catch (error) { return NextResponse.json({error:error instanceof Error ? error.message : 'Consent could not be saved.'},{status:503}); }
  } else {
    addAudit({ kind: "consent.request", actorId: state.patientId, summary: `${personById(state, state.patientId).shortName} declined ${requester.shortName}'s request to see ${cat.label}`, detail: reqRec, ok: false });
  }
  mutate((d) => {
    d.consentRequests = d.consentRequests.map((r) => (r.id === reqRec.id ? { ...r, status } : r));
  });
  const dm = threadForPair(reqRec.requesterId, state.agentId);
  if (dm) {
    addMessage({
      threadId: dm.id,
      senderId: state.agentId,
      kind: "notification",
      text: body.approve
        ? `Good news — ${personById(state, state.patientId).shortName} has shared her ${cat.label.toLowerCase()} with you. Ask me anything about them whenever you're ready.`
        : `${personById(state, state.patientId).shortName} has decided not to share her ${cat.label.toLowerCase()} for now. That's her call to make; I'm still here for everything she has shared.`,
    });
  }
  return NextResponse.json({ ok: true, status });
}
