import { NextResponse } from "next/server";
import { getActivePatientSimId, listDemoPatients, searchPatientsForPicker, switchPatient } from "@/lib/store";

export const dynamic = "force-dynamic";

/** List demo cohort, or search live sim patients for the picker. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") || "";
  try {
    if (q.trim()) {
      const res = await searchPatientsForPicker(q);
      return NextResponse.json({ activePatientId: getActivePatientSimId(), ...res });
    }
    return NextResponse.json({
      activePatientId: getActivePatientSimId(),
      total: listDemoPatients().length,
      items: listDemoPatients(),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/** Switch the Kindred patient record + seed their synthetic family circle. */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { patientId?: string };
    const patientId = String(body.patientId || "").trim();
    if (!patientId) return NextResponse.json({ error: "patientId required" }, { status: 400 });
    const state = await switchPatient(patientId);
    if (!state.loaded) {
      return NextResponse.json({ error: state.loadError || "Could not load patient" }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      patient: { simId: state.patient.simId, name: state.patient.name, kindredId: state.patientId },
      circle: state.people
        .filter((p) => p.role === "family" || p.role === "carer")
        .map((p) => ({ id: p.id, name: p.name, relation: p.relation })),
    });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}
