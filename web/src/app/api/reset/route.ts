import { NextResponse } from "next/server";
import { resetState } from "@/lib/store";

export async function POST() {
  await resetState();
  return NextResponse.json({ ok: true });
}
