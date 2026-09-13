// Where CrustDash reads and writes its files. The launcher sets these; the defaults suit a development checkout.
import path from "node:path";

/** data/ holds the live session logs, the task list and the game text extracted from your copy of the game. */
export const DATA_DIR = process.env.CRUST_DATA_DIR ?? path.resolve(process.cwd(), "..", "data");

export const LIVE_DIR = process.env.CRUST_LIVE_DIR ?? path.join(DATA_DIR, "live");
export const TASKS_FILE = process.env.CRUST_TASKS_FILE ?? path.join(DATA_DIR, "tasks.json");
export const GAME_TEXT_FILE = process.env.CRUST_GAME_TEXT ?? path.join(DATA_DIR, "game-text", "game_en.tsv");

export const SAVE_DIR = process.env.CRUST_SAVE_DIR ?? path.join(process.env.LOCALAPPDATA ?? "", "TheCrust", "Saved", "SaveGames");

/** The Crust's install folder, when the launcher knows it (otherwise found through Steam). */
export const GAME_DIR = process.env.CRUST_GAME_DIR ?? null;
