// Server-Sent Events: tails the newest CrustWatcher session file and forwards each NDJSON line.
import { stat } from "node:fs/promises";
import { attachLines, glossaryReplayLines, newestSessionFile, readRange } from "@/lib/crust/live";

const POLL_MS = 1000;
const HEARTBEAT_MS = 15000;

export async function GET(request: Request) {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    async start(controller) {
      let file: string | null = null;
      let offset = 0;
      let partial = "";
      let busy = false;
      const send = (event: string, data: string) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));

      const attach = async (next: string) => {
        file = next;
        offset = (await stat(next)).size;
        partial = "";
        send("session", JSON.stringify({ file: next }));
        // Replay what a fresh client needs (names, save info, game values, history, latest snapshot) before tailing
        for (const line of await glossaryReplayLines(next)) send("line", line);
        for (const line of await attachLines(next)) send("line", line);
      };

      let announcedWaiting = false;
      const tick = async () => {
        if (busy) return;
        busy = true;
        try {
          const newest = await newestSessionFile();
          if (!newest) {
            if (!announcedWaiting) send("waiting", "{}");
            announcedWaiting = true;
            return;
          }
          if (newest !== file) return void (await attach(newest));
          const size = (await stat(newest)).size;
          if (size < offset) return void (await attach(newest));
          if (size === offset) return;
          const chunk = partial + (await readRange(newest, offset, size)).toString("utf8");
          offset = size;
          const lines = chunk.split("\n");
          partial = lines.pop() ?? "";
          for (const line of lines) if (line.trim()) send("line", line);
        } catch (err) {
          send("error", JSON.stringify({ message: String(err) }));
        } finally {
          busy = false;
        }
      };

      // Flush bytes immediately so the browser's EventSource opens without waiting for data
      controller.enqueue(encoder.encode("retry: 3000\n: connected\n\n"));
      await tick();
      timer = setInterval(tick, POLL_MS);
      heartbeat = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), HEARTBEAT_MS);
      request.signal.addEventListener("abort", () => {
        clearInterval(timer);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      clearInterval(timer);
      clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
