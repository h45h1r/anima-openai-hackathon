import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  applyAction,
  createDemo,
  snapshot,
  type DemoState,
} from "@/lib/nhs-demo/model";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("login"),
    actor: z.enum(["eleanor", "sarah", "tom", "gp"]),
  }),
  z.object({
    type: z.literal("consent"),
    relative: z.enum(["sarah", "tom"]),
    category: z.enum(["appointments", "results"]),
    allowed: z.boolean(),
  }),
  z.object({
    type: z.literal("chat"),
    text: z.string().trim().min(1).max(2000),
  }),
  z.object({ type: z.literal("remind") }),
  z.object({ type: z.literal("read"), id: z.number().int().positive() }),
  z.object({ type: z.literal("reset") }),
]);

declare global {
  var __nhsDemoSessions:
    Map<string, { state: DemoState; touched: number }> | undefined;
}
const sessions = (globalThis.__nhsDemoSessions ??= new Map());
const COOKIE = "kindred-nhs-demo";
const TTL = 8 * 60 * 60 * 1000;

function session(req: NextRequest) {
  const now = Date.now();
  for (const [key, value] of sessions)
    if (now - value.touched > TTL) sessions.delete(key);
  const supplied = req.cookies.get(COOKIE)?.value;
  const id =
    supplied && sessions.has(supplied) ? supplied : crypto.randomUUID();
  let entry = sessions.get(id);
  if (!entry) {
    entry = { state: createDemo(), touched: now };
    sessions.set(id, entry);
  }
  entry.touched = now;
  return { id, state: entry.state };
}

function respond(req: NextRequest, id: string, body: unknown, status = 200) {
  const response = NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
  response.cookies.set(COOKIE, id, {
    httpOnly: true,
    sameSite: "strict",
    secure: req.nextUrl.protocol === "https:",
    path: "/api/nhs-demo",
    maxAge: TTL / 1000,
  });
  return response;
}

export function GET(req: NextRequest) {
  const { id, state } = session(req);
  return respond(req, id, snapshot(state));
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin)
    return NextResponse.json(
      { error: "Use the demo from the same origin." },
      { status: 403 },
    );
  const { id, state } = session(req);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return respond(req, id, { error: "Send a JSON action." }, 400);
  }
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success)
    return respond(req, id, { error: "Invalid demo action." }, 400);
  try {
    applyAction(state, parsed.data);
    return respond(req, id, snapshot(state));
  } catch (error) {
    return respond(
      req,
      id,
      { error: error instanceof Error ? error.message : "Demo action failed." },
      403,
    );
  }
}
