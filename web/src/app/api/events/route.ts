import { ensureLoaded, getState, subscribe, refreshConsent, withRuntimeState } from "@/lib/store";

export const dynamic = "force-dynamic";

async function localGET(req: Request) {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let keepalive: NodeJS.Timeout | null = null;
  let consentRefresh: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* closed */
        }
      };
      send(getState());
      unsubscribe = subscribe(send);
      void ensureLoaded().then((s) => send(s));
      consentRefresh = setInterval(() => { void refreshConsent(); }, 2500);
      keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          /* closed */
        }
      }, 15000);
      req.signal.addEventListener("abort", () => {
        unsubscribe?.();
        if (keepalive) clearInterval(keepalive);
        if (consentRefresh) clearInterval(consentRefresh);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      unsubscribe?.();
      if (keepalive) clearInterval(keepalive);
      if (consentRefresh) clearInterval(consentRefresh);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export const maxDuration = 60;

export async function GET(req: Request) {
  if (!process.env.DATABASE_URL) return localGET(req);
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let polling = false;
  let end: () => void = () => {};
  const stream = new ReadableStream({
    start(controller) {
      end = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        clearTimeout(deadline);
        req.signal.removeEventListener('abort', end);
        try { controller.close(); } catch { /* Already cancelled. */ }
      };
      const poll = async () => {
        if (closed || polling) return;
        polling = true;
        try {
          const state = await withRuntimeState(() => ensureLoaded(), false);
          if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(state)}\n\n`));
        } catch { end(); }
        finally { polling = false; }
      };
      if (req.signal.aborted) { end(); return; }
      req.signal.addEventListener('abort', end, { once: true });
      timer = setInterval(() => { void poll(); }, 2500);
      deadline = setTimeout(end, 55000);
      void poll();
    },
    cancel() { end(); },
  });
  return new Response(stream, { headers: {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-store, no-transform', Connection: 'keep-alive',
  } });
}
