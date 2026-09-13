<#
.SYNOPSIS
  Removes CrustDash: the CrustWatcher mod, UE4SS when CrustDash installed it, shortcuts and the dashboard app.

.PARAMETER RemoveData
  Also delete your task list and live session logs.

.PARAMETER Quiet
  Never prompt: keep your data, and keep UE4SS if other mods use it.
#>
param(
    [switch]$RemoveData,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

$InstallDir = Split-Path -Parent $PSScriptRoot
$manifestFile = Join-Path $InstallDir 'install.json'
$install = if (Test-Path $manifestFile) { Get-Content $manifestFile -Raw | ConvertFrom-Json } else { $null }
$UE4SS_BUNDLED_MODS = @('BPML_GenericFunctions', 'BPModLoaderMod', 'CheatManagerEnablerMod', 'ConsoleCommandsMod', 'ConsoleEnablerMod',
    'Keybinds', 'LineTraceMod', 'SplitScreenMod', 'shared', 'CrustWatcher')

function Finish([string]$message, [string]$color) {
    Write-Host ''
    Write-Host $message -ForegroundColor $color
    if (-not $Quiet) { Read-Host 'Press Enter to close' | Out-Null }
}

Write-Host 'CrustDash uninstaller' -ForegroundColor White
if ($install -and $install.gameDir -and (Test-GameRunning (Get-Win64Dir $install.gameDir))) {
    Finish 'The Crust is running. Close the game, then run the uninstaller again.' 'Red'
    exit 1
}
if (-not $Quiet) {
    $answer = Read-Host 'Remove CrustDash? [y/N]'
    if ($answer -notmatch '^(y|yes)$') { exit 0 }
}

Write-Step 'Stopping the dashboard'
$process = Get-DashboardProcess $InstallDir
if ($process) { Stop-Process -Id $process.Id -Force }

if ($install -and $install.gameDir) {
    $win64 = Get-Win64Dir $install.gameDir
    $ue4ssDir = Join-Path $win64 'ue4ss'

    Write-Step 'Removing the CrustWatcher mod'
    $modDir = Join-Path $ue4ssDir 'Mods\CrustWatcher'
    if (Test-Path $modDir) { Remove-Item $modDir -Recurse -Force }
    Disable-ModInList (Join-Path $ue4ssDir 'Mods\mods.txt') 'CrustWatcher'

    if ($install.ue4ssInstalled -and (Test-Path $ue4ssDir)) {
        $otherMods = @(Get-ChildItem (Join-Path $ue4ssDir 'Mods') -Directory -ErrorAction SilentlyContinue | Where-Object { $UE4SS_BUNDLED_MODS -notcontains $_.Name })
        $removeUe4ss = $otherMods.Count -eq 0
        if (-not $removeUe4ss -and -not $Quiet) {
            Write-Host "Other UE4SS mods are installed: $(($otherMods | ForEach-Object Name) -join ', ')" -ForegroundColor Yellow
            $removeUe4ss = (Read-Host 'Remove UE4SS anyway? Those mods will stop working. [y/N]') -match '^(y|yes)$'
        }
        if ($removeUe4ss) {
            Write-Step 'Removing UE4SS'
            $proxy = Join-Path $win64 'dwmapi.dll'
            if ((Test-Path $proxy) -and (Get-FileHash $proxy -Algorithm SHA256).Hash -eq $Ue4ssHashes['dwmapi.dll']) { Remove-Item $proxy -Force }
            Remove-Item $ue4ssDir -Recurse -Force
            foreach ($backup in @($install.backups)) {
                if ($backup -and (Test-Path $backup)) { Move-Item $backup ($backup -replace '\.crustdash-backup$', '') -Force }
            }
        } else {
            Write-Host 'Kept UE4SS for your other mods.'
        }
    }
}

Write-Step 'Removing shortcuts'
Remove-Item (Join-Path ([Environment]::GetFolderPath('Programs')) 'CrustDash') -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) 'CrustDash.lnk') -Force -ErrorAction SilentlyContinue

Write-Step 'Removing the dashboard'
if (-not $RemoveData -and -not $Quiet) {
    $RemoveData = (Read-Host 'Also delete your task list and session logs? [y/N]') -match '^(y|yes)$'
}
Set-Location $env:TEMP
foreach ($item in @('app', 'runtime', 'CrustDash.cmd', 'VERSION', 'README.txt', 'THIRD-PARTY-NOTICES.md', 'install.json')) {
    Remove-Item (Join-Path $InstallDir $item) -Recurse -Force -ErrorAction SilentlyContinue
}
if ($RemoveData) { Remove-Item (Join-Path $InstallDir 'data') -Recurse -Force -ErrorAction SilentlyContinue }
Remove-Item (Join-Path $InstallDir 'scripts') -Recurse -Force -ErrorAction SilentlyContinue
if (-not (Get-ChildItem $InstallDir -ErrorAction SilentlyContinue)) { Remove-Item $InstallDir -Force -ErrorAction SilentlyContinue }

$kept = if ($RemoveData) { '' } else { " Your data is still in $InstallDir\data." }
Finish "CrustDash is removed.$kept" 'Green'
