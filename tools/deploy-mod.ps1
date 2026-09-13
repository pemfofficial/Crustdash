<#
.SYNOPSIS
  Development: copies watcher\CrustWatcher into the game's UE4SS Mods folder, writing into this checkout's data\live.
  UE4SS must already be installed (run the release installer once, or install UE4SS by hand).

.PARAMETER GameDir
  The Crust's folder. Found through Steam when left out.

.PARAMETER DebugMode
  Turn on the mod's extra logging.
#>
param(
    [string]$GameDir,
    [switch]$DebugMode
)

$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'package\scripts\Common.ps1')
$Repo = Split-Path -Parent $PSScriptRoot

if (-not $GameDir) { $GameDir = Find-CrustGame }
if (-not $GameDir) { throw 'The Crust was not found. Pass -GameDir.' }
$mods = Join-Path (Get-Win64Dir $GameDir) 'ue4ss\Mods'
if (-not (Test-Path $mods)) { throw "UE4SS isn't installed in $GameDir" }

$target = Join-Path $mods 'CrustWatcher'
if (Test-Path $target) { Remove-Item $target -Recurse -Force }
Copy-Item (Join-Path $Repo 'watcher\CrustWatcher') $target -Recurse
New-Item -ItemType Directory -Force -Path (Join-Path $Repo 'data\live') | Out-Null
# No launcher in development: run dev.cmd yourself
$live = (Join-Path $Repo 'data\live') -replace '\\', '/'
$debug = if ($DebugMode) { 'true' } else { 'false' }
Write-Utf8 (Join-Path $target 'Scripts\settings.lua') "return { outDir = `"$live`", startWithGame = false, debug = $debug }`n"
Enable-ModInList (Join-Path $mods 'mods.txt') 'CrustWatcher'
Write-Host "Deployed CrustWatcher to $target (output: $live)"
