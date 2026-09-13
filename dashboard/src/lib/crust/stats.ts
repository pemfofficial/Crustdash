// Parser for The Crust's per-save Stats.bin (daily time series written on each save).
// Layout, repeated to EOF:
//   int32 nameLen (UTF-16 code units, no terminator)
//   UTF-16LE name
//   int32 count
//   count × { float32 value, int64 FDateTime ticks }
import { readFile } from "node:fs/promises";

export type StatPoint = { value: number; date: string | null };
export type StatSeries = { name: string; points: StatPoint[] };

// BigInt() rather than n-literals: tsconfig targets ES2017
const TICKS_AT_UNIX_EPOCH = BigInt("621355968000000000");
const TICKS_PER_MS = BigInt(10000);

/** FDateTime ticks (100ns since 0001-01-01) -> ISO string on the in-game calendar. */
export function ticksToIso(ticks: bigint): string | null {
  if (ticks <= BigInt(0)) return null;
  return new Date(Number((ticks - TICKS_AT_UNIX_EPOCH) / TICKS_PER_MS)).toISOString();
}

export function parseStats(buf: Buffer): StatSeries[] {
  const stats: StatSeries[] = [];
  let i = 0;
  while (i + 4 <= buf.length) {
    const nameLen = buf.readInt32LE(i);
    if (nameLen <= 0 || nameLen > 512) throw new Error(`Stats.bin: bad name length ${nameLen} at ${i}`);
    i += 4;
    const name = buf.toString("utf16le", i, i + nameLen * 2);
    i += nameLen * 2;
    const count = buf.readInt32LE(i);
    i += 4;
    const points: StatPoint[] = new Array(count);
    for (let k = 0; k < count; k++, i += 12) {
      points[k] = { value: buf.readFloatLE(i), date: ticksToIso(buf.readBigInt64LE(i + 4)) };
    }
    stats.push({ name, points });
  }
  return stats;
}

export async function readStats(path: string): Promise<StatSeries[]> {
  return parseStats(await readFile(path));
}

/** Human label for raw stat names, e.g. "EResourceType::IronOxide" -> "Iron Oxide". */
export function statLabel(name: string): string {
  const base = name.replace(/^EResourceType::/, "").replace(/Sys$/i, "").replace(/^CPUStat\./, "CPU ");
  return base.replace(/([a-z])([A-Z])/g, "$1 $2");
}

