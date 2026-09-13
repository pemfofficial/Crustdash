@echo off
rem Installs CrustDash: finds The Crust through Steam, installs UE4SS and the CrustWatcher mod, and the dashboard app.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Install.ps1" %*
if errorlevel 1 pause
