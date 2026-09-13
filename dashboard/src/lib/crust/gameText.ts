// English game text from Game.locres, extracted from your copy of the game to data/game-text/game_en.tsv
// (namespace, key, text). Server only.
import { readFile, stat } from "node:fs/promises";
import { ensureGameText } from "./gameTextExtract";
import { GAME_TEXT_FILE } from "./paths";

export type GameText = {
  /** Text by localization key (keys are unique hashes for most game text). */
  byKey: Map<string, string>;
  /** Text by "Namespace:Key", for string tables such as QuestTitles. */
  byTable: Map<string, string>;
  /** Quest titles: string-table key without the _ST suffix, and the English title. */
  questTitles: { key: string; title: string }[];
};

let cache: { mtimeMs: number; text: GameText } | null = null;

const tidy = (s: string) =>
  s
    .replace(/<[^>]*>/g, "")
    .replace(/\s*¶\s*/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();

export async function loadGameText(): Promise<GameText | null> {
  if (!(await ensureGameText(GAME_TEXT_FILE))) return null;
  try {
    const info = await stat(GAME_TEXT_FILE);
    if (cache && cache.mtimeMs === info.mtimeMs) return cache.text;
    const byKey = new Map<string, string>();
    const byTable = new Map<string, string>();
    const questTitles: GameText["questTitles"] = [];
    for (const line of (await readFile(GAME_TEXT_FILE, "utf8")).split(/\r?\n/)) {
      const a = line.indexOf("\t");
      const b = line.indexOf("\t", a + 1);
      if (a < 0 || b < 0) continue;
      const ns = line.slice(0, a);
      const key = line.slice(a + 1, b);
      const value = tidy(line.slice(b + 1));
      if (!byKey.has(key)) byKey.set(key, value);
      if (ns) byTable.set(`${ns}:${key}`, value);
      if (ns === "QuestTitles" && value) questTitles.push({ key: key.replace(/_ST$/, ""), title: value });
    }
    const text = { byKey, byTable, questTitles };
    cache = { mtimeMs: info.mtimeMs, text };
    return text;
  } catch {
    return null;
  }
}
