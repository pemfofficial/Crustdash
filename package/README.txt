CrustDash for The Crust (Steam)
===============================

A live dashboard for The Crust that runs on your own PC while you play: credits, resources and market
prices as they change, your missions step by step, a task list, alerts, advice, and a Wiki for The Crust 1.0.


Install
-------
1. Close The Crust.
2. Extract this whole zip to any folder (for example your Downloads folder).
3. Double-click "Install CrustDash.cmd".
   The installer finds The Crust through Steam, installs UE4SS (the mod loader) and the CrustWatcher mod into
   the game folder, and installs the dashboard to %LOCALAPPDATA%\CrustDash.
   If Windows SmartScreen warns about the file, choose "More info", then "Run anyway".
4. Start The Crust from Steam as usual. The dashboard opens in your browser a few seconds later.

You can delete the extracted folder after installing.


Using it
--------
- The dashboard is at http://127.0.0.1:3000 while it runs. Nothing is sent over the internet.
- Load a save in the game. Live numbers appear within a few seconds; save history appears after the game saves.
- Start menu > CrustDash opens the dashboard any time (for example to read the Wiki without the game).
- Start menu > Stop CrustDash stops the dashboard server. It also stops by itself when the game closes.
- Your task list is kept in %LOCALAPPDATA%\CrustDash\data\tasks.json until you delete the tasks.


Something isn't working?
------------------------
- No live numbers: make sure the game is running with a save loaded, then check Start menu >
  "CrustDash (debug)". It shows the dashboard's log and turns on extra logging in the mod.
- The game's own log for the mod is TheCrust\Binaries\Win64\ue4ss\UE4SS.log in the game folder.
- Start menu > "Collect CrustDash diagnostics" puts a zip of the logs on your desktop to attach to a bug report.
  It doesn't include your saves or your task list.
- Another program uses port 3000: stop it, or ask for help with a bug report.


Uninstall
---------
Start menu > Uninstall CrustDash. It removes the mod, UE4SS if CrustDash installed it and no other mods need it,
the shortcuts and the dashboard. It asks before deleting your task list.


What gets changed in the game folder
------------------------------------
TheCrust\Binaries\Win64\dwmapi.dll          UE4SS loader (an existing different dwmapi.dll is backed up)
TheCrust\Binaries\Win64\ue4ss\              UE4SS and its settings
TheCrust\Binaries\Win64\ue4ss\Mods\CrustWatcher\   the mod that reads the game's values

Steam's "Verify integrity of game files" does not remove these; use the uninstaller.
