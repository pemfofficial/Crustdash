CrustDash for The Crust (Steam)
===============================

A live dashboard for The Crust that runs on your own PC while you play: credits, resources and market
prices as they change, your missions step by step, a task list, alerts, advice, and a Wiki for The Crust 1.0.


Install
-------
1. Close The Crust.
2. Extract this whole zip to any folder (right-click the zip > Extract All).
3. Double-click "Install CrustDash.cmd" in the extracted folder.
   The installer finds The Crust through Steam, installs UE4SS (the mod loader) and the CrustWatcher mod into
   the game folder, and installs the dashboard to %LOCALAPPDATA%\CrustDash.
   If Windows SmartScreen warns about the file, choose "More info", then "Run anyway".
4. Start The Crust from Steam as usual. The dashboard opens in your browser a few seconds later.

You can delete the extracted folder after installing.


Opening the dashboard
---------------------
- It opens by itself when you start the game.
- To open it any other time (for example to read the Wiki): double-click the CrustDash icon on your desktop,
  or press the Windows key, type CrustDash and press Enter.
- It shows your saves. Pick the one you're playing. Live numbers appear a few seconds after the save loads.
- Everything stays on this PC. Nothing is sent over the internet.

While the dashboard runs, a moon icon sits in the system tray (bottom right of the taskbar; click the ^ arrow
if it's hidden). Right-click it for:
  Status             whether the dashboard is running and the game is connected
  Open dashboard     (or double-click the icon)
  Restart            restart the dashboard if something looks stuck
  Open logs folder
  Quit CrustDash     stop the dashboard and remove the icon

The installer also adds a CrustDash folder to the Windows Start menu (press the Windows key, then look under
All apps > CrustDash). It has:
  CrustDash                        open the dashboard
  CrustDash (debug)                open it with its log visible, for troubleshooting
  Stop CrustDash                   stop the dashboard (it also stops by itself when the game closes)
  Collect CrustDash diagnostics    zip the logs to your desktop for a bug report
  Uninstall CrustDash              remove everything

Your task list is kept in %LOCALAPPDATA%\CrustDash\data\tasks.json until you delete the tasks.


Something isn't working?
------------------------
- The dashboard says "Waiting for the game" or shows no live numbers: make sure The Crust is running with a
  save loaded (not the main menu). Then open "CrustDash (debug)" to see what the dashboard is doing.
- The game's log for the mod: TheCrust\Binaries\Win64\ue4ss\UE4SS.log inside the game folder
  (Steam > right-click The Crust > Manage > Browse local files).
- "Collect CrustDash diagnostics" puts a zip of the logs on your desktop to attach to a bug report.
  It doesn't include your saves or your task list.
- If another program already uses port 3000, CrustDash picks the next free port by itself.


Uninstall
---------
Press the Windows key, type "Uninstall CrustDash" and press Enter. It removes the mod, UE4SS if CrustDash
installed it and no other mods need it, the shortcuts and the dashboard. It asks before deleting your task list.


What gets changed in the game folder
------------------------------------
TheCrust\Binaries\Win64\dwmapi.dll                  UE4SS loader (an existing different dwmapi.dll is backed up)
TheCrust\Binaries\Win64\ue4ss\                      UE4SS and its settings
TheCrust\Binaries\Win64\ue4ss\Mods\CrustWatcher\    the mod that reads the game's values

Steam's "Verify integrity of game files" does not remove these; use the uninstaller.
