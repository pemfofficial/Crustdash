<#
.SYNOPSIS
  Opens the CrustDash dashboard, starting its local server first when needed.

.PARAMETER Debug
  Run the server in this window so its log is visible (also saved to data\logs\dashboard-debug.log), with extra logging
  from the dashboard and the CrustWatcher mod. Close the window to stop the dashboard.

.PARAMETER FromGame
  Used by the CrustWatcher mod when the game starts: start the server, open the browser once, and stop the server
  after the game closes.

.PARAMETER NoBrowser
  Start the server without opening the browser.

.PARAMETER Stop
  Stop the dashboard server.
#>
param(
    [switch]$Debug,
    [switch]$FromGame,
    [switch]$NoBrowser,
    [switch]$Stop
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

$Root = Split-Path -Parent $PSScriptRoot
$Data = Join-Path $Root 'data'
$Logs = Join-Path $Data 'logs'
$PidFile = Join-Path $Data 'dashboard.pid'
$Url = "http://127.0.0.1:$DashboardPort"
New-Item -ItemType Directory -Force -Path $Logs | Out-Null

function Test-Dashboard {
    try { return (Invoke-WebRequest "$Url/api/profiles" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { return $false }
}

function Stop-Dashboard {
    $process = Get-DashboardProcess $Root
    if ($process) { Stop-Process -Id $process.Id -Force }
    Remove-Item $PidFile -ErrorAction SilentlyContinue
}

function Set-ModDebug([bool]$on) {
    $install = Get-InstallInfo
    if (-not $install) { return }
    $settings = Join-Path (Get-Win64Dir $install.gameDir) 'ue4ss\Mods\CrustWatcher\Scripts\settings.lua'
    if (Test-Path $settings) {
        $value = if ($on) { 'true' } else { 'false' }
        Write-Utf8 $settings ([regex]::Replace([IO.File]::ReadAllText($settings), 'debug\s*=\s*(true|false)', "debug = $value"))
    }
}

function Get-InstallInfo {
    $file = Join-Path $Root 'install.json'
    if (Test-Path $file) { return Get-Content $file -Raw | ConvertFrom-Json }
    return $null
}

if ($Stop) {
    Stop-Dashboard
    Write-Host 'CrustDash stopped.'
    exit 0
}

if (Test-Dashboard) {
    # Already running: just show it (the game's own start doesn't reopen the browser)
    if (-not $NoBrowser -and -not $FromGame) { Start-Process $Url }
    exit 0
}

$install = Get-InstallInfo
$env:CRUST_DATA_DIR = $Data
if ($install -and $install.gameDir) { $env:CRUST_GAME_DIR = $install.gameDir }
$env:PORT = "$DashboardPort"
$env:HOSTNAME = '127.0.0.1'
$env:NODE_ENV = 'production'
$node = Join-Path $Root 'runtime\node.exe'
$server = Join-Path $Root 'app\server.js'

if ($Debug) {
    $env:CRUST_DEBUG = '1'
    Set-ModDebug $true
    Write-Host "CrustDash $(Get-PackageVersion $Root), debug mode" -ForegroundColor Cyan
    Write-Host "  Dashboard:  $Url"
    Write-Host "  Data:       $Data"
    if ($install) {
        Write-Host "  Game:       $($install.gameDir)"
        Write-Host "  Mod log:    $(Join-Path (Get-Win64Dir $install.gameDir) 'ue4ss\UE4SS.log')"
    }
    Write-Host '  The mod writes extra detail to its log from the next game start. Close this window to stop the dashboard.'
    Write-Host ''
    Start-Job -ScriptBlock {
        param($url)
        for ($i = 0; $i -lt 90; $i++) {
            try { if ((Invoke-WebRequest "$url/api/profiles" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { Start-Process $url; return } } catch { }
            Start-Sleep -Milliseconds 500
        }
    } -ArgumentList $Url | Out-Null
    # The server logs warnings to stderr; under 'Stop' Windows PowerShell would treat those as fatal
    $ErrorActionPreference = 'Continue'
    try {
        & $node $server 2>&1 | ForEach-Object { "$_" } | Tee-Object -FilePath (Join-Path $Logs 'dashboard-debug.log')
    } finally {
        Set-ModDebug $false
    }
    exit 0
}

$process = Start-Process -FilePath $node -ArgumentList "`"$server`"" -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $Logs 'dashboard.log') -RedirectStandardError (Join-Path $Logs 'dashboard-errors.log')
Set-Content $PidFile $process.Id

$deadline = (Get-Date).AddSeconds(45)
while (-not (Test-Dashboard)) {
    if ($process.HasExited -or (Get-Date) -gt $deadline) {
        Write-Host "The dashboard didn't start. Details: $Logs\dashboard-errors.log" -ForegroundColor Red
        if (-not $FromGame) { Read-Host 'Press Enter to close' | Out-Null }
        exit 1
    }
    Start-Sleep -Milliseconds 500
}
if (-not $NoBrowser) { Start-Process $Url }

if ($FromGame) {
    # Stop the server once the game has closed
    Start-Sleep -Seconds 20
    while (Get-Process -Name $GameProcess -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 10 }
    Stop-Dashboard
}
