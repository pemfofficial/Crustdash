// Reads the missions in progress from a save's Level.sav.
// The quest manager saves a map "SysNameToQuestObjectSaveStruct": quest tag -> status, name, description and
// stages, each with checkpoints (name, description, done, and the glossary value + target the game watches).
// Level.sav is a UE4 compressed archive; the map is a standard tagged-property (GVAS) block, read here directly.
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { loadGameText, type GameText } from "./gameText";
import type { Quest, QuestCheckpoint, QuestReport, QuestStage } from "./questTypes";
import { profileDir } from "./saves";

const UE_PACKAGE_TAG = 0x9e2a83c1;

/** Inflate every compressed chunk (each chunk can hold several zlib blocks). */
function inflateArchive(buf: Buffer): Buffer {
  if (buf.length < 48 || buf.readUInt32LE(0) !== UE_PACKAGE_TAG) return buf;
  const parts: Buffer[] = [];
  let i = 0;
  while (i + 48 <= buf.length && buf.readUInt32LE(i) === UE_PACKAGE_TAG) {
    const uncompressed = Number(buf.readBigInt64LE(i + 24));
    i += 32;
    const blocks: number[] = [];
    for (let total = 0; total < uncompressed; ) {
      blocks.push(Number(buf.readBigInt64LE(i)));
      total += Number(buf.readBigInt64LE(i + 8));
      i += 16;
    }
    for (const size of blocks) {
      parts.push(inflateSync(buf.subarray(i, i + size)));
      i += size;
    }
  }
  return Buffer.concat(parts);
}

class Reader {
  readonly b: Buffer;
  p: number;
  constructor(b: Buffer, p: number) {
    this.b = b;
    this.p = p;
  }
  i32() {
    const v = this.b.readInt32LE(this.p);
    this.p += 4;
    return v;
  }
  u8() {
    return this.b[this.p++];
  }
  i8() {
    const v = this.b.readInt8(this.p);
    this.p += 1;
    return v;
  }
  f32() {
    const v = this.b.readFloatLE(this.p);
    this.p += 4;
    return v;
  }
  f64() {
    const v = this.b.readDoubleLE(this.p);
    this.p += 8;
    return v;
  }
  i64() {
    const v = Number(this.b.readBigInt64LE(this.p));
    this.p += 8;
    return v;
  }
  guid() {
    if (this.u8()) this.p += 16;
  }
  fstr() {
    const n = this.i32();
    if (n === 0) return "";
    if (n > 0) {
      if (n > 1 << 20) throw new Error("string too long");
      const s = this.b.toString("latin1", this.p, this.p + n - 1);
      this.p += n;
      return s;
    }
    const bytes = -n * 2;
    if (bytes > 1 << 21) throw new Error("string too long");
    const s = this.b.toString("utf16le", this.p, this.p + bytes - 2);
    this.p += bytes;
    return s;
  }
}

type Props = Record<string, unknown>;
const cleanName = (name: string) => name.replace(/_\d+_[0-9A-F]{32}$/i, "");

const TEXT_HISTORIES = new Set([-1, 0, 11]);

function readText(r: Reader, text: GameText | null): string {
  r.i32(); // flags
  // The Crust's saves put five extra bytes (a byte, then an int32) before the history type; standard archives don't
  if (!TEXT_HISTORIES.has(r.b.readInt8(r.p)) && TEXT_HISTORIES.has(r.b.readInt8(r.p + 5))) r.p += 5;
  const history = r.i8();
  if (history === -1) return r.i32() ? r.fstr() : "";
  if (history === 0) {
    r.fstr(); // namespace
    const key = r.fstr();
    const source = r.fstr();
    return text?.byKey.get(key) ?? source;
  }
  if (history === 11) {
    const table = r.fstr();
    const key = r.fstr();
    return text?.byTable.get(`${table.split(".").pop()}:${key}`) ?? key;
  }
  throw new Error(`text history ${history}`);
}

function readPrim(r: Reader, t: GameText | null, type: string): unknown {
  switch (type) {
    case "IntProperty":
      return r.i32();
    case "Int64Property":
      return r.i64();
    case "FloatProperty":
      return r.f32();
    case "DoubleProperty":
      return r.f64();
    case "ByteProperty":
      return r.u8();
    case "BoolProperty":
      return r.u8() !== 0;
    case "StrProperty":
    case "NameProperty":
    case "ObjectProperty":
    case "EnumProperty":
      return r.fstr();
    case "SoftObjectProperty": {
      const asset = r.fstr();
      r.fstr();
      return asset;
    }
    case "TextProperty":
      return readText(r, t);
    default:
      throw new Error(`unsupported ${type}`);
  }
}

function readStruct(r: Reader, t: GameText | null, name: string): unknown {
  switch (name) {
    case "DateTime":
    case "Timespan":
      return r.i64();
    case "Guid":
    case "LinearColor":
    case "Quat":
      r.p += 16;
      return null;
    case "Vector":
    case "Rotator":
      r.p += 12;
      return null;
    case "Vector2D":
    case "IntPoint":
      r.p += 8;
      return null;
    default:
      return readProps(r, t);
  }
}

const readElement = (r: Reader, t: GameText | null, type: string) => (type === "StructProperty" ? readProps(r, t) : readPrim(r, t, type));

function readValue(r: Reader, t: GameText | null, type: string, size: number): unknown {
  if (type === "BoolProperty") {
    const v = r.u8() !== 0;
    r.guid();
    return v;
  }
  let start = r.p;
  try {
    switch (type) {
      case "StructProperty": {
        const name = r.fstr();
        r.p += 16;
        r.guid();
        start = r.p;
        return readStruct(r, t, name);
      }
      case "ByteProperty":
      case "EnumProperty": {
        const enumName = r.fstr();
        r.guid();
        start = r.p;
        return type === "ByteProperty" && enumName === "None" ? r.u8() : r.fstr();
      }
      case "ArrayProperty":
      case "SetProperty": {
        const inner = r.fstr();
        r.guid();
        start = r.p;
        if (type === "SetProperty") r.i32();
        const n = r.i32();
        if (n < 0 || n > 100000) throw new Error("bad array length");
        if (inner === "StructProperty") {
          r.fstr();
          r.fstr();
          r.i32();
          r.i32();
          const name = r.fstr();
          r.p += 16;
          r.guid();
          return Array.from({ length: n }, () => readStruct(r, t, name));
        }
        return Array.from({ length: n }, () => readPrim(r, t, inner));
      }
      case "MapProperty": {
        const keyType = r.fstr();
        const valueType = r.fstr();
        r.guid();
        start = r.p;
        const removed = r.i32();
        for (let i = 0; i < removed; i++) readElement(r, t, keyType);
        const n = r.i32();
        if (n < 0 || n > 100000) throw new Error("bad map length");
        return Array.from({ length: n }, () => ({ key: readElement(r, t, keyType), value: readElement(r, t, valueType) }));
      }
      default:
        r.guid();
        start = r.p;
        return readPrim(r, t, type);
    }
  } catch {
    return null;
  } finally {
    r.p = start + size;
  }
}

function readProps(r: Reader, t: GameText | null): Props {
  const out: Props = {};
  for (let guard = 0; guard < 5000; guard++) {
    const name = r.fstr();
    if (name === "None" || name === "") return out;
    const type = r.fstr();
    const size = r.i32();
    r.i32(); // array index
    out[cleanName(name)] = readValue(r, t, type, size);
  }
  return out;
}

// ------------------------------------------------------------------ shaping
const isObj = (v: unknown): v is Props => typeof v === "object" && v !== null && !Array.isArray(v);
function find(v: unknown, key: string, depth = 0): unknown {
  if (depth > 12) return undefined;
  if (Array.isArray(v)) {
    for (const x of v) {
      const hit = find(x, key, depth + 1);
      if (hit !== undefined) return hit;
    }
  } else if (isObj(v)) {
    if (key in v) return v[key];
    for (const x of Object.values(v)) {
      const hit = find(x, key, depth + 1);
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function toCheckpoint(v: unknown): QuestCheckpoint {
  const info = find(v, "QuestCheckpointInfo") ?? v;
  const tag = find(find(info, "BindonGlossaryProperty"), "TagName");
  return {
    name: str(find(info, "CheckpointName")),
    description: str(find(info, "CheckpointDescription")),
    completed: find(v, "bCompleted") === true,
    glossary: str(tag) || null,
    target: num(find(info, "GlossaryValue")),
    last: num(find(v, "LastValue")),
    targetName: str(find(v, "TargetName")) || null,
  };
}

function toQuest(entry: { key: unknown; value: unknown }): Quest | null {
  const tag = str(find(entry.key, "TagName"));
  if (!tag) return null;
  const v = entry.value;
  const stages = find(v, "StageSaveStructs");
  const status = str(find(v, "QuestStatus"));
  return {
    tag,
    name: str(find(v, "QuestName")) || tag.split(".").pop() || tag,
    description: str(find(v, "Description")),
    status: status ? status.replace(/^.*::/, "") : null,
    tracked: find(v, "isTracked") === true,
    stages: (Array.isArray(stages) ? stages : []).map(
      (s): QuestStage => ({
        name: str(find(s, "StageName")),
        active: find(s, "bActiveStage") === true,
        checkpoints: (() => {
          const cps = isObj(s) ? s.Checkpoints : undefined;
          return (Array.isArray(cps) ? cps : []).map(toCheckpoint);
        })(),
      }),
    ),
  };
}

export function parseQuests(level: Buffer, text: GameText | null): Quest[] {
  const name = "SysNameToQuestObjectSaveStruct";
  const needle = Buffer.alloc(4 + name.length + 1);
  needle.writeInt32LE(name.length + 1, 0);
  needle.write(name, 4, "latin1");
  const at = level.indexOf(needle);
  if (at < 0) return [];
  const r = new Reader(level, at);
  r.fstr();
  const type = r.fstr();
  const size = r.i32();
  r.i32();
  const map = readValue(r, text, type, size);
  return (Array.isArray(map) ? map : []).map((e) => toQuest(e as { key: unknown; value: unknown })).filter((q): q is Quest => q !== null);
}

const cache = new Map<string, { mtimeMs: number; report: QuestReport }>();

/** Missions in progress in a profile's last save (cached until the save changes). */
export async function readQuests(profileId: string): Promise<QuestReport> {
  const file = path.join(profileDir(profileId), "Level.sav");
  const text = await loadGameText();
  const titles = text?.questTitles ?? [];
  const info = await stat(file);
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === info.mtimeMs) return { ...hit.report, titles };
  const quests = parseQuests(inflateArchive(await readFile(file)), text);
  const report: QuestReport = { savedAt: info.mtime.toISOString(), quests, titles: [] };
  cache.set(file, { mtimeMs: info.mtimeMs, report });
  return { ...report, titles };
}
