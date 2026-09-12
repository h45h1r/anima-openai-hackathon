import { ensureLoaded, getState, subscribe, refreshConsent } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
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
