import { withRuntimeState } from '@/lib/store';
import { NextResponse } from 'next/server';
import { addFamilyMember, removeFamilyMember, ensureLoaded } from '@/lib/store';

async function handlePOST(req: Request) {
  try {
    const state = await ensureLoaded();
    const input = await req.json();
    if (input.actorId && input.actorId !== state.patientId) return NextResponse.json({error:'Only the patient can add a family member.'},{status:403});
    const result = await addFamilyMember({name:input.name,relationship:input.relationship,email:input.email});
    return NextResponse.json(result,{status:201});
  } catch (error) { return NextResponse.json({error:error instanceof Error ? error.message : 'Could not add family member.'},{status:(error as {status?:number}).status || 503}); }
}
async function handleDELETE(req: Request) {
  try {
    const state = await ensureLoaded();
    const input = await req.json();
    if (input.actorId && input.actorId !== state.patientId) return NextResponse.json({error:'Only the patient can remove access.'},{status:403});
    if (!state.people.some(p=>p.id===input.granteeId)) return NextResponse.json({error:'Family member not found.'},{status:404});
    return NextResponse.json(await removeFamilyMember(input.granteeId));
  } catch (error) { return NextResponse.json({error:error instanceof Error ? error.message : 'Could not remove family access.'},{status:(error as {status?:number}).status || 503}); }
}

export async function POST(req: Request) {
  return withRuntimeState(() => handlePOST(req));
}

export async function DELETE(req: Request) {
  return withRuntimeState(() => handleDELETE(req));
}
