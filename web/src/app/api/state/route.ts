import { NextResponse } from "next/server";
import { ensureLoaded } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await ensureLoaded());
}
