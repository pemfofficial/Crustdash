@echo off
rem Opens the CrustDash dashboard (starts it if needed). "CrustDash.cmd -Debug" shows the server log in this window.
if /i "%~1"=="-Debug" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\CrustDash.ps1" %*
) else (
  start "" powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0scripts\CrustDash.ps1" %*
)
