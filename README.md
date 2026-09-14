# CrustDash

A live dashboard, companion and guide for **The Crust** (1.0, Steam). It runs on your own PC while you play.

- **Live now**: a board of widgets you arrange yourself (credits, power, CPU, research, drones, missions, key resources, market moves…), with layouts for different play styles.
- **Missions and tasks**: the game's missions step by step with live progress, and your own task list, kept until you delete it.
- **Colony history**: credits, net worth, resources, income and spending, and buildings from your saves, with charts.
- **Assistant**: findings about your numbers with what to do, custom alerts on prices, stock, credits, power, CPU, drones, research, missions, pause/disconnect or any game value, with quick-start templates and a chime, and a notification panel.
- **Wiki**: 269 articles for The Crust 1.0 from The Crust Wiki and the game's own encyclopedia text, each marked with how current it is and linked back to your colony.
- **Calculator** for trades, contracts and credit goals.

Nothing leaves your PC: the dashboard is served at `http://127.0.0.1:3000` and reads the game through a local mod.

## Install (players)

**[Download the latest release](https://github.com/pemfofficial/Crustdash/releases/latest)**: get `CrustDash-<version>-steam.zip`, extract it, and double-click **Install CrustDash.cmd**. Then start The Crust from Steam; the dashboard opens with it and a moon icon appears in the system tray (right-click it for status, Restart and Quit). The zip's `README.txt` covers troubleshooting and uninstalling.

The installer:

- finds The Crust through your Steam libraries (or asks for the folder);
- installs [UE4SS](https://github.com/UE4SS-RE/RE-UE4SS) v3.0.1-1133 (the mod loader; an existing different version is kept unless you choose to replace it) and the CrustWatcher mod into the game folder;
- installs the dashboard with its own Node.js runtime to `%LOCALAPPDATA%\CrustDash`;
- adds Start menu entries: CrustDash, CrustDash (debug), Stop CrustDash, Collect CrustDash diagnostics, Uninstall CrustDash.

## How it works

| Part | Folder | What it does |
|---|---|---|
| CrustWatcher (UE4SS Lua mod) | `watcher/CrustWatcher` | Every 2 seconds, on the game thread, reads the market (prices, supply, price bands, 30-day history), credits, the game's glossary values (resource counts, power, CPU, research, quest flags), the in-game date and the loaded save, and appends JSON lines to `data/live/session_<time>.ndjson`. Starts the dashboard when the game starts. F8 writes a full field dump. |
| Dashboard (Next.js) | `dashboard` | Reads save profiles from `%LOCALAPPDATA%\TheCrust\Saved\SaveGames`, each save's `Stats.bin` history and `Level.sav` missions, streams the watcher's session log over Server-Sent Events, and serves the interface. |
| Package | `package` | Install, launch, uninstall and diagnostics scripts that ship in the release zip. |
| Tools | `tools` | `package.ps1` builds the release zip; `deploy-mod.ps1` copies the mod into the game for development; `build_wiki.py` rebuilds the Wiki. |

### Watcher rules

UE4SS crashes are native, so Lua's `pcall` can't catch them. Each rule below fixed a game crash:

- **Game thread only.** Polling uses `LoopInGameThreadWithDelay`. `LoopAsync` with `ExecuteInGameThread` used the mod's Lua state from two threads and crashed inside UE4SS's garbage collector. Keybinds only set flags.
- **Never deep-read referenced objects.** Reading `Float_GlossaryProperty_C` field by field crashed; the watcher reads known scalar fields directly.
- **Guard struct lookups.** `UScriptStruct:GetProperty()` is only called when `IsMappedToProperty()` is true.
- **Let loads settle.** Deep reads wait until the game's objects are unchanged for 2 polls.
- **Breadcrumbs.** The first reads after each load log every field to `UE4SS.log`, so a crash's last line names the field. Debug mode logs more.

### File formats

- `*.sav`: UE4 SaveGame (GVAS) inside UE compressed chunks (`C1 83 2A 9E` tag, zlib). Missions are the `SysNameToQuestObjectSaveStruct` map in `Level.sav`: quest tag → status, name, description, and stages of checkpoints, each with the glossary value and target the game watches. See `dashboard/src/lib/crust/quests.ts`.
- `Stats.bin`: repeated `{ int32 nameLen, UTF-16 name, int32 count, count × { float32 value, int64 FDateTime ticks } }`. Finance series are per-day amounts; quantities are levels. See `dashboard/src/lib/crust/stats.ts`.
- Game text: the English `Game.locres` is extracted from the player's own `pakchunk0-WindowsNoEditor.pak` on first use (pak v11, zlib). See `dashboard/src/lib/crust/gameTextExtract.ts`.

## Develop

Requirements: Windows, Node.js 24, The Crust with UE4SS installed (run a release installer once, or install UE4SS by hand).

```
dev.cmd                                   # dashboard with live reload at http://localhost:3000
powershell -File tools\deploy-mod.ps1     # copy the mod into the game, writing to this checkout's data\live
```

Checks: `cd dashboard`, then `npx tsc --noEmit` and `npm run lint`.

Environment variables (the launcher sets these for the installed app):

| Variable | Default |
|---|---|
| `CRUST_DATA_DIR` | `../data` from `dashboard` |
| `CRUST_LIVE_DIR` | `<data>/live` |
| `CRUST_TASKS_FILE` | `<data>/tasks.json` |
| `CRUST_GAME_TEXT` | `<data>/game-text/game_en.tsv` |
| `CRUST_SAVE_DIR` | `%LOCALAPPDATA%\TheCrust\Saved\SaveGames` |
| `CRUST_GAME_DIR` | found through Steam |

### Rebuild the Wiki

```
python tools/build_wiki.py --fetch   # download the wiki and Steam news, then build
python tools/build_wiki.py           # build from data/wiki-cache
```

It needs the extracted game text in `data/game-text` (the dashboard writes it on first run). Output goes to `dashboard/src/data/wiki/`. Quotes from the game are checked against the game text, and the build fails if one is missing.

### Build the release

```
powershell -File tools\package.ps1
```

Produces `release/CrustDash-<version>-steam.zip` with a SHA-256 file. Node.js and UE4SS are downloaded and checked against their published checksums.

## Credits

- The Crust is made by Veom Studio. CrustDash is a fan-made tool, not affiliated with or endorsed by Veom Studio.
- Wiki articles are adapted from [The Crust Wiki](https://thecrust.wiki.gg/) under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); each article links to its source page.
- [UE4SS](https://github.com/UE4SS-RE/RE-UE4SS) (MIT), Node.js (MIT), Next.js and React (MIT). See `package/THIRD-PARTY-NOTICES.md`.
