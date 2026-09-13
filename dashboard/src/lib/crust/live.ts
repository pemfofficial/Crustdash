// Locates CrustWatcher session logs (NDJSON written by the UE4SS mod).
import { createReadStream } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

import { LIVE_DIR } from "./paths";

export { LIVE_DIR };

export async function newestSessionFile(): Promise<string | null> {
  let names: string[];
  try {
    names = await readdir(LIVE_DIR);
  } catch {
    return null;
  }
  const sessions = names.filter((n) => n.startsWith("session_") && n.endsWith(".ndjson"));
  if (sessions.length === 0) return null;
  const withTimes = await Promise.all(
    sessions.map(async (n) => ({ n, t: (await stat(path.join(LIVE_DIR, n))).mtimeMs })),
  );
  withTimes.sort((a, b) => b.t - a.t);
  return path.join(LIVE_DIR, withTimes[0].n);
}

/** Reads bytes [from, to) of a file. */
export async function readRange(file: string, from: number, to: number): Promise<Buffer> {
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(to - from);
    await fh.read(buf, 0, buf.length, from);
    return buf;
  } finally {
    await fh.close();
  }
}

/**
 * The newest line of each kind a client needs on connect: enums and session info (written near the
 * start of a session) plus the newest price-history snapshot and the newest snapshot.
 */
export async function attachLines(file: string, tailBytes = 8 * 1024 * 1024): Promise<string[]> {
  const size = (await stat(file)).size;
  const tailFrom = Math.max(0, size - tailBytes);
  const tail = (await readRange(file, tailFrom, size)).toString("utf8").split("\n");
  const head = tailFrom > 0 ? (await readRange(file, 0, Math.min(size, 256 * 1024))).toString("utf8").split("\n") : [];
  const newest = (lines: string[], test: (line: string) => boolean) => {
    for (let i = lines.length - 1; i >= 0; i--) if (lines[i].startsWith('{"') && test(lines[i])) return lines[i];
    return null;
  };
  const pick = (test: (line: string) => boolean) => newest(tail, test) ?? newest(head, test);
  const isSnapshot = (l: string) => l.includes('"type":"snapshot"');
  return [
    pick((l) => l.includes('"type":"enums"')),
    pick((l) => l.includes('"type":"session_info"')),
    pick((l) => isSnapshot(l) && l.includes('"history":true') && l.includes('"SellingPriceHistory"')),
    pick(isSnapshot),
  ].filter((l): l is string => l !== null);
}

/**
 * The watcher only writes glossary values when they change, so a client that connects mid-session would miss
 * everything that hasn't changed since. Rebuild two glossary lines from the whole session: the first value seen
 * for every entry (so "started this session" still works), then the latest one.
 */
export async function glossaryReplayLines(file: string): Promise<string[]> {
  const first = new Map<string, unknown>();
  const latest = new Map<string, unknown>();
  const lines = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.includes('"type":"glossary"')) continue;
    try {
      const entries = (JSON.parse(line) as { entries?: { a: string }[] }).entries ?? [];
      for (const entry of entries) {
        if (!first.has(entry.a)) first.set(entry.a, entry);
        latest.set(entry.a, entry);
      }
    } catch {
      // a line still being written
    }
  }
  if (!latest.size) return [];
  const line = (entries: Map<string, unknown>) => JSON.stringify({ type: "glossary", replay: true, entries: [...entries.values()] });
  return [line(first), line(latest)];
}

