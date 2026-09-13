// Extracts the English game text (Localization/Game/en/Game.locres) from your own copy of The Crust.
// CrustDash doesn't ship the game's text: it reads it from the game's pak file the first time it's needed.
// Server only. The pak is UE 4.27 format (version 11), unencrypted, zlib-compressed.
import { execFile } from "node:child_process";
import { open, readFile, stat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { inflateSync } from "node:zlib";
import { GAME_DIR } from "./paths";

const STEAM_APP_DIR = "The Crust";
const PAK = path.join("TheCrust", "Content", "Paks", "pakchunk0-WindowsNoEditor.pak");
const LOCRES = "/en/Game.locres";

/** The game folder: CRUST_GAME_DIR, or the Steam library that has The Crust installed. */
export async function findGameDir(): Promise<string | null> {
  if (GAME_DIR) return GAME_DIR;
  const roots = new Set<string>();
  try {
    const { stdout } = await promisify(execFile)("reg", ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"]);
    const match = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/);
    if (match) roots.add(path.normalize(match[1].trim()));
  } catch {
    // no Steam registry key: try the default location
  }
  roots.add("C:\\Program Files (x86)\\Steam");
  for (const root of roots) {
    let libraries = [root];
    try {
      const vdf = await readFile(path.join(root, "steamapps", "libraryfolders.vdf"), "utf8");
      libraries = [root, ...[...vdf.matchAll(/"path"\s+"([^"]+)"/g)].map((m) => m[1].replace(/\\\\/g, "\\"))];
    } catch {
      // older Steam installs have no library list
    }
    for (const library of libraries) {
      const dir = path.join(library, "steamapps", "common", STEAM_APP_DIR);
      try {
        await stat(path.join(dir, PAK));
        return dir;
      } catch {
        // not in this library
      }
    }
  }
  return null;
}

class Cursor {
  readonly b: Buffer;
  p: number;
  constructor(b: Buffer, p = 0) {
    this.b = b;
    this.p = p;
  }
  i32() {
    const v = this.b.readInt32LE(this.p);
    this.p += 4;
    return v;
  }
  u32() {
    const v = this.b.readUInt32LE(this.p);
    this.p += 4;
    return v;
  }
  i64() {
    const v = Number(this.b.readBigInt64LE(this.p));
    this.p += 8;
    return v;
  }
  skip(n: number) {
    this.p += n;
  }
  fstr() {
    const n = this.i32();
    if (n === 0) return "";
    if (n < 0) {
      const s = this.b.toString("utf16le", this.p, this.p - n * 2).replace(/\0$/, "");
      this.p += -n * 2;
      return s;
    }
    const s = this.b.toString("utf8", this.p, this.p + n).replace(/\0$/, "");
    this.p += n;
    return s;
  }
}

async function readAt(file: Awaited<ReturnType<typeof open>>, position: number, length: number) {
  const buf = Buffer.alloc(length);
  await file.read(buf, 0, length, position);
  return buf;
}

/** Game.locres bytes from the pak, via its full directory index and encoded entry table. */
async function readLocres(pakPath: string): Promise<Buffer> {
  const file = await open(pakPath, "r");
  try {
    const size = (await file.stat()).size;
    const footer = await readAt(file, size - 221, 221);
    const version = footer.readInt32LE(21);
    if (version !== 11) throw new Error(`unsupported pak version ${version}`);
    const indexOffset = Number(footer.readBigInt64LE(25));
    const indexSize = Number(footer.readBigInt64LE(33));
    const methods = Array.from({ length: 5 }, (_, i) => footer.toString("latin1", 61 + i * 32, 93 + i * 32).replace(/\0+$/, ""));

    const index = new Cursor(await readAt(file, indexOffset, indexSize));
    index.fstr(); // mount point
    index.i32(); // entry count
    index.skip(8); // path hash seed
    if (index.i32()) index.skip(8 + 8 + 20);
    if (!index.i32()) throw new Error("pak has no directory index");
    const dirOffset = index.i64();
    const dirSize = index.i64();
    index.skip(20);
    const encoded = index.b.subarray(index.p + 4, index.p + 4 + index.i32());

    const dirs = new Cursor(await readAt(file, dirOffset, dirSize));
    let entryOffset = -1;
    for (let d = dirs.i32(); d > 0 && entryOffset < 0; d--) {
      const dir = dirs.fstr();
      for (let n = dirs.i32(); n > 0; n--) {
        const name = dirs.fstr();
        const at = dirs.i32();
        if (`${dir}${name}`.endsWith(LOCRES) && dir.includes("Localization/Game")) entryOffset = at;
      }
    }
    if (entryOffset < 0) throw new Error("Game.locres not found in the pak");

    // FPakEntry, bit-packed (UE 4.27 FPakFile::DecodePakEntry)
    const e = new Cursor(encoded, entryOffset);
    const bits = e.u32();
    const blockSizeBits = bits & 0x3f;
    const blockCount = (bits >>> 6) & 0xffff;
    const encrypted = (bits >>> 22) & 1;
    const method = (bits >>> 23) & 0x3f;
    const size32 = (bits >>> 29) & 1;
    const usize32 = (bits >>> 30) & 1;
    const offset32 = (bits >>> 31) & 1;
    if (encrypted) throw new Error("Game.locres is encrypted");
    const offset = offset32 ? e.u32() : e.i64();
    const usize = usize32 ? e.u32() : e.i64();
    const csize = method ? (size32 ? e.u32() : e.i64()) : usize;
    if (blockSizeBits === 0x3f) e.u32();

    const header = 8 + 8 + 8 + 4 + 20 + 1 + 4 + (method ? 4 + 16 * blockCount : 0);
    if (!method) return readAt(file, offset + header, usize);
    if (methods[method - 1]?.toLowerCase() !== "zlib") throw new Error(`unsupported compression ${methods[method - 1]}`);
    const sizes = blockCount === 1 ? [csize] : Array.from({ length: blockCount }, () => e.u32());
    const parts: Buffer[] = [];
    let start = offset + header;
    for (const blockSize of sizes) {
      parts.push(inflateSync(await readAt(file, start, blockSize)));
      start += blockSize;
    }
    return Buffer.concat(parts);
  } finally {
    await file.close();
  }
}

/** Locres v2/v3 rows: [namespace, key, text]. */
function parseLocres(data: Buffer): [string, string, string][] {
  const c = new Cursor(data, 16);
  const version = data[c.p++];
  const stringsAt = Number(data.readBigInt64LE(c.p));
  c.skip(8);
  const body = c.p;
  c.p = stringsAt;
  const strings = Array.from({ length: c.i32() }, () => {
    const s = c.fstr();
    if (version >= 2) c.skip(4); // reference count
    return s;
  });
  c.p = body;
  if (version >= 3) c.skip(4); // entries count
  const rows: [string, string, string][] = [];
  for (let ns = c.i32(); ns > 0; ns--) {
    c.skip(4); // namespace hash
    const namespace = c.fstr();
    for (let keys = c.i32(); keys > 0; keys--) {
      c.skip(4); // key hash
      const key = c.fstr();
      c.skip(4); // source string hash
      rows.push([namespace, key, strings[c.i32()] ?? ""]);
    }
  }
  return rows;
}

let running: Promise<boolean> | null = null;

/** Writes the game text TSV (namespace, key, text) if it doesn't exist yet. Returns whether the file is available. */
export function ensureGameText(target: string): Promise<boolean> {
  running ??= (async () => {
    try {
      await stat(target);
      return true;
    } catch {
      // not extracted yet
    }
    try {
      const gameDir = await findGameDir();
      if (!gameDir) return false;
      const rows = parseLocres(await readLocres(path.join(gameDir, PAK)));
      await mkdir(path.dirname(target), { recursive: true });
      const tsv = rows.map(([ns, key, text]) => `${ns}\t${key}\t${text.replace(/\r/g, "").replace(/\n/g, " ¶ ")}`).join("\n");
      await writeFile(target, `${tsv}\n`, "utf8");
      return true;
    } catch (err) {
      console.error(`[CrustDash] couldn't extract game text: ${String(err)}`);
      running = null; // try again next time
      return false;
    }
  })();
  return running;
}
