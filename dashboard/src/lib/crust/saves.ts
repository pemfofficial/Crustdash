// Discovers save "profiles" (one folder per save under Saved/SaveGames) and reads Slot.sav metadata.
import { readFile, readdir, stat } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import path from "node:path";

import { SAVE_DIR } from "./paths";

export { SAVE_DIR };

export type Profile = {
  id: string; // folder name
  name: string;
  isAutosave: boolean;
  savedAt: string; // file mtime (real-world clock)
  difficulty: string | null;
  startParameter: string | null;
  gameVersion: string | null;
  hasStats: boolean;
};

const UE_PACKAGE_TAG = 0x9e2a83c1;

/** Inflate UE4 compressed-chunk archives (FCompressedChunkInfo headers + zlib). Returns input if uncompressed. */
export function decompressUE(buf: Buffer): Buffer {
  if (buf.length < 48 || buf.readUInt32LE(0) !== UE_PACKAGE_TAG) return buf;
  const parts: Buffer[] = [];
  let i = 0;
  while (i + 48 <= buf.length && buf.readUInt32LE(i) === UE_PACKAGE_TAG) {
    const compressed = Number(buf.readBigUInt64LE(i + 16));
    parts.push(inflateSync(buf.subarray(i + 48, i + 48 + compressed)));
    i += 48 + compressed;
  }
  return Buffer.concat(parts);
}

function readFString(buf: Buffer, at: number): { value: string; next: number } {
  const len = buf.readInt32LE(at);
  if (len === 0) return { value: "", next: at + 4 };
  if (len < 0) {
    const bytes = -len * 2;
    return { value: buf.toString("utf16le", at + 4, at + 4 + bytes - 2), next: at + 4 + bytes };
  }
  return { value: buf.toString("utf8", at + 4, at + 4 + len - 1), next: at + 4 + len };
}

/** Finds a top-level-ish StrProperty by name in a GVAS body and returns its value. */
function findStrProperty(buf: Buffer, prop: string): string | null {
  const needle = Buffer.alloc(4 + prop.length + 1);
  needle.writeInt32LE(prop.length + 1, 0);
  needle.write(prop, 4, "latin1");
  const at = buf.indexOf(needle);
  if (at < 0) return null;
  try {
    const type = readFString(buf, at + needle.length);
    if (type.value !== "StrProperty") return null;
    // int64 size, uint8 hasPropertyGuid
    return readFString(buf, type.next + 8 + 1).value;
  } catch {
    return null;
  }
}

async function exists(p: string) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function listProfiles(): Promise<Profile[]> {
  const entries = await readdir(SAVE_DIR, { withFileTypes: true });
  const profiles = await Promise.all(
    entries
      .filter((e) => e.isDirectory())
      .map(async (e): Promise<Profile | null> => {
        const dir = path.join(SAVE_DIR, e.name);
        const slotPath = path.join(dir, "Slot.sav");
        if (!(await exists(slotPath))) return null;
        const [slotBuf, slotStat, hasStats] = await Promise.all([
          readFile(slotPath),
          stat(slotPath),
          exists(path.join(dir, "Stats.bin")),
        ]);
        let body: Buffer | null = null;
        try {
          body = decompressUE(slotBuf);
        } catch {
          body = null;
        }
        return {
          id: e.name,
          name: (body && findStrProperty(body, "Name")) || e.name,
          isAutosave: e.name.startsWith("Autosave_"),
          savedAt: slotStat.mtime.toISOString(),
          difficulty: body && findStrProperty(body, "MainDifficulty"),
          startParameter: body && findStrProperty(body, "OriginalGameStartParameter"),
          gameVersion: body && findStrProperty(body, "GameVersion"),
          hasStats,
        };
      }),
  );
  return profiles
    .filter((p): p is Profile => p !== null)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function profileDir(id: string): string {
  // Guard against path traversal from route params
  if (id.includes("..") || id.includes("/") || id.includes("\\")) throw new Error("invalid profile id");
  return path.join(SAVE_DIR, id);
}
