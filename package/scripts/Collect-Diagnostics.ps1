<#
.SYNOPSIS
  Zips CrustDash's logs and settings to your desktop, for a bug report. Your task list and saves are not included.
#>
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

$InstallDir = Split-Path -Parent $PSScriptRoot
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$work = Join-Path $env:TEMP "CrustDash-diagnostics-$stamp"
New-Item -ItemType Directory -Force -Path $work | Out-Null

function Add-Copy([string]$source, [string]$name) {
    if (Test-Path $source) { Copy-Item $source (Join-Path $work $name) -Recurse -Force }
}

$lines = @("CrustDash diagnostics $stamp", "Version: $(Get-PackageVersion $InstallDir)", "Windows: $([Environment]::OSVersion.VersionString)")
$node = Join-Path $InstallDir 'runtime\node.exe'
if (Test-Path $node) { $lines += "Node: $(& $node --version)" }
$install = $null
if (Test-Path (Join-Path $InstallDir 'install.json')) {
    $install = Get-Content (Join-Path $InstallDir 'install.json') -Raw | ConvertFrom-Json
    Add-Copy (Join-Path $InstallDir 'install.json') 'install.json'
}
$dashboardUp = $false
try { $dashboardUp = (Invoke-WebRequest "http://127.0.0.1:$DashboardPort/api/profiles" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { }
$lines += "Dashboard responding: $dashboardUp"
$lines += "Game running: $([bool](Get-Process -Name $GameProcess -ErrorAction SilentlyContinue))"

if ($install -and $install.gameDir) {
    $win64 = Get-Win64Dir $install.gameDir
    $lines += "Game folder: $($install.gameDir)"
    foreach ($file in @('dwmapi.dll', 'ue4ss\UE4SS.dll')) {
        $path = Join-Path $win64 $file
        $lines += if (Test-Path $path) { "${file}: $((Get-FileHash $path -Algorithm SHA256).Hash)" } else { "${file}: missing" }
    }
    Add-Copy (Join-Path $win64 'ue4ss\UE4SS.log') 'UE4SS.log'
    Add-Copy (Join-Path $win64 'ue4ss\UE4SS-settings.ini') 'UE4SS-settings.ini'
    Add-Copy (Join-Path $win64 'ue4ss\Mods\mods.txt') 'mods.txt'
    Add-Copy (Join-Path $win64 'ue4ss\Mods\CrustWatcher\Scripts\settings.lua') 'CrustWatcher-settings.lua'
}

Add-Copy (Join-Path $InstallDir 'data\logs') 'logs'
$live = Join-Path $InstallDir 'data\live'
if (Test-Path $live) {
    $sessions = Get-ChildItem $live -Filter 'session_*.ndjson' | Sort-Object LastWriteTime -Descending
    $lines += "Session logs: $($sessions.Count)"
    $sessions | Select-Object -First 5 | ForEach-Object { $lines += "  $($_.Name)  $([math]::Round($_.Length / 1KB)) KB  $($_.LastWriteTime)" }
    if ($sessions) { Get-Content $sessions[0].FullName -Tail 40 | Set-Content (Join-Path $work 'newest-session-tail.ndjson') }
}

Set-Content (Join-Path $work 'summary.txt') $lines
$zip = Join-Path ([Environment]::GetFolderPath('Desktop')) "CrustDash-diagnostics-$stamp.zip"
Compress-Archive -Path (Join-Path $work '*') -DestinationPath $zip -Force
Remove-Item $work -Recurse -Force
Write-Host "Saved $zip" -ForegroundColor Green
Write-Host 'Attach it to your bug report.'
Read-Host 'Press Enter to close' | Out-Null
