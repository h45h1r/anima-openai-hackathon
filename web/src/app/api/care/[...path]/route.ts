import { handleCareApi } from "@/lib/carecircle/server/runtime";

export const maxDuration = 180;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ path?: string[] }> };

async function handle(req: Request, ctx: Ctx) {
  const { path: parts = [] } = await ctx.params;
  return handleCareApi(req, parts);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
