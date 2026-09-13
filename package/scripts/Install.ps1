<#
.SYNOPSIS
  Installs CrustDash for The Crust (Steam): the dashboard app, UE4SS (the mod loader) and the CrustWatcher mod.

.PARAMETER GameDir
  The Crust's folder. Found through your Steam libraries when left out.

.PARAMETER InstallDir
  Where the dashboard and its data go. Default: %LOCALAPPDATA%\CrustDash

.PARAMETER NoShortcuts
  Don't create Start menu and desktop shortcuts.

.PARAMETER NoStartWithGame
  Don't start the dashboard automatically when the game starts.

.PARAMETER Quiet
  Never prompt. An existing, different UE4SS install is kept.
#>
param(
    [string]$GameDir,
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'CrustDash'),
    [switch]$NoShortcuts,
    [switch]$NoStartWithGame,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

$Package = Split-Path -Parent $PSScriptRoot

function Fail([string]$message) {
    Write-Host ''
    Write-Host "Install stopped: $message" -ForegroundColor Red
    if (-not $Quiet) { Read-Host 'Press Enter to close' | Out-Null }
    exit 1
}

function Select-GameFolder {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = 'Select The Crust folder (it contains the TheCrust folder).'
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { return $dialog.SelectedPath }
    return $null
}

function Copy-Fresh([string]$from, [string]$to) {
    if (Test-Path $to) { Remove-Item $to -Recurse -Force }
    Copy-Item $from $to -Recurse -Force
}

Write-Host "CrustDash $(Get-PackageVersion $Package) installer" -ForegroundColor White

foreach ($required in @('app\server.js', 'runtime\node.exe', 'mod\CrustWatcher\Scripts\main.lua', 'ue4ss\dwmapi.dll', 'ue4ss\ue4ss\UE4SS.dll')) {
    if (-not (Test-Path (Join-Path $Package $required))) {
        Fail "the download is incomplete ($required is missing). Extract the whole zip, then run the installer again."
    }
}

Write-Step 'Finding The Crust'
if (-not $GameDir) { $GameDir = Find-CrustGame }
if (-not $GameDir -and -not $Quiet) {
    Write-Host 'The Crust was not found in your Steam libraries. Select its folder.' -ForegroundColor Yellow
    $GameDir = Select-GameFolder
}
if (-not $GameDir) { Fail 'The Crust was not found. Run the installer again with -GameDir "path\to\The Crust".' }
$Win64 = Get-Win64Dir $GameDir
if (-not (Test-Path (Join-Path $Win64 $GameExe))) { Fail "$GameDir is not The Crust's folder ($GameExe is missing)." }
Write-Host "Found $GameDir"
if (Test-GameRunning $Win64) { Fail 'The Crust is running. Close the game, then run the installer again.' }

Write-Step 'Installing the dashboard'
New-Item -ItemType Directory -Force -Path $InstallDir, (Join-Path $InstallDir 'data\live'), (Join-Path $InstallDir 'data\logs') | Out-Null
$running = Get-DashboardProcess $InstallDir
if ($running) { Stop-Process -Id $running.Id -Force }
foreach ($part in @('app', 'runtime', 'scripts')) { Copy-Fresh (Join-Path $Package $part) (Join-Path $InstallDir $part) }
foreach ($file in @('CrustDash.cmd', 'VERSION', 'README.txt', 'THIRD-PARTY-NOTICES.md')) {
    $source = Join-Path $Package $file
    if (Test-Path $source) { Copy-Item $source $InstallDir -Force }
}
Write-Host "Installed to $InstallDir"

Write-Step 'Installing UE4SS'
$ue4ssDir = Join-Path $Win64 'ue4ss'
$backups = @()
$installUe4ss = $true
$existingDll = Join-Path $ue4ssDir 'UE4SS.dll'
if ((Test-Path $existingDll) -and ((Get-FileHash $existingDll -Algorithm SHA256).Hash -ne $Ue4ssHashes['UE4SS.dll'])) {
    Write-Host 'A different UE4SS version is already installed.' -ForegroundColor Yellow
    $keep = $true
    if (-not $Quiet) {
        $answer = Read-Host 'Replace it with the version CrustDash was tested with? Other UE4SS mods may need their own version. [y/N]'
        $keep = $answer -notmatch '^(y|yes)$'
    }
    if ($keep) {
        $installUe4ss = $false
        Write-Host 'Keeping your UE4SS. If the dashboard shows no live data, reinstall and choose to replace it.'
    }
}
if ($installUe4ss) {
    $proxy = Join-Path $Win64 'dwmapi.dll'
    if ((Test-Path $proxy) -and ((Get-FileHash $proxy -Algorithm SHA256).Hash -ne $Ue4ssHashes['dwmapi.dll'])) {
        $backup = "$proxy.crustdash-backup"
        Move-Item $proxy $backup -Force
        $backups += $backup
        Write-Host "Moved an existing dwmapi.dll to $backup" -ForegroundColor Yellow
    }
    $freshSettings = -not (Test-Path (Join-Path $ue4ssDir 'UE4SS-settings.ini'))
    Copy-Item (Join-Path $Package 'ue4ss\dwmapi.dll') $Win64 -Force
    New-Item -ItemType Directory -Force -Path (Join-Path $ue4ssDir 'Mods') | Out-Null
    foreach ($item in @('UE4SS.dll', 'LICENSE', 'UE4SS_SDK_Backends')) { Copy-Item (Join-Path $Package "ue4ss\ue4ss\$item") $ue4ssDir -Recurse -Force }
    if ($freshSettings) {
        $settings = Join-Path $ue4ssDir 'UE4SS-settings.ini'
        Copy-Item (Join-Path $Package 'ue4ss\ue4ss\UE4SS-settings.ini') $settings -Force
        # The UE4SS console windows make the mouse cursor flicker in The Crust
        foreach ($key in @('ConsoleEnabled', 'GuiConsoleEnabled', 'GuiConsoleVisible')) { Set-IniValue $settings $key '0' }
    }
    # UE4SS's bundled mods (keybinds and shared libraries); never overwrite ones you already have
    Get-ChildItem (Join-Path $Package 'ue4ss\ue4ss\Mods') | ForEach-Object {
        $target = Join-Path (Join-Path $ue4ssDir 'Mods') $_.Name
        if (-not (Test-Path $target)) { Copy-Item $_.FullName $target -Recurse -Force }
    }
    Write-Host 'UE4SS installed.'
}

Write-Step 'Installing the CrustWatcher mod'
$modDir = Join-Path $ue4ssDir 'Mods\CrustWatcher'
Copy-Fresh (Join-Path $Package 'mod\CrustWatcher') $modDir
Write-WatcherSettings -ModDir $modDir -InstallDir $InstallDir -StartWithGame (-not $NoStartWithGame) -DebugMode $false
Enable-ModInList (Join-Path $ue4ssDir 'Mods\mods.txt') 'CrustWatcher'
Write-Host 'CrustWatcher installed.'

$manifest = [ordered]@{
    version        = Get-PackageVersion $Package
    installedAt    = (Get-Date).ToString('o')
    gameDir        = $GameDir
    ue4ssInstalled = $installUe4ss
    backups        = $backups
}
$manifest | ConvertTo-Json | Set-Content (Join-Path $InstallDir 'install.json') -Encoding UTF8

if (-not $NoShortcuts) {
    Write-Step 'Adding shortcuts'
    $launcher = Join-Path $InstallDir 'CrustDash.cmd'
    $menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'CrustDash'
    New-Item -ItemType Directory -Force -Path $menu | Out-Null
    $powershell = Join-Path $PSHOME 'powershell.exe'
    $scripts = Join-Path $InstallDir 'scripts'
    New-Shortcut (Join-Path $menu 'CrustDash.lnk') $launcher '' $InstallDir 'Open the CrustDash dashboard' 7
    New-Shortcut (Join-Path $menu 'CrustDash (debug).lnk') $launcher '-Debug' $InstallDir 'Run the dashboard with its log visible' 1
    New-Shortcut (Join-Path $menu 'Stop CrustDash.lnk') $launcher '-Stop' $InstallDir 'Stop the dashboard server' 7
    New-Shortcut (Join-Path $menu 'Collect CrustDash diagnostics.lnk') $powershell "-NoProfile -ExecutionPolicy Bypass -File `"$scripts\Collect-Diagnostics.ps1`"" $InstallDir 'Zip logs for a bug report' 1
    New-Shortcut (Join-Path $menu 'Uninstall CrustDash.lnk') $powershell "-NoProfile -ExecutionPolicy Bypass -File `"$scripts\Uninstall.ps1`"" $InstallDir 'Remove CrustDash' 1
    New-Shortcut (Join-Path ([Environment]::GetFolderPath('Desktop')) 'CrustDash.lnk') $launcher '' $InstallDir 'Open the CrustDash dashboard' 7
    Write-Host 'Start menu: CrustDash, CrustDash (debug), Stop CrustDash, Collect CrustDash diagnostics, Uninstall CrustDash. Desktop: CrustDash.'
}

Write-Host ''
Write-Host 'CrustDash is installed.' -ForegroundColor Green
if ($NoStartWithGame) {
    Write-Host 'Start The Crust from Steam, then open CrustDash from the Start menu.'
} else {
    Write-Host 'Start The Crust from Steam as usual: the dashboard opens in your browser a few seconds later.'
}
Write-Host 'The dashboard runs only on this PC, at http://127.0.0.1:3000'
if (-not $Quiet) {
    $open = Read-Host 'Open the dashboard now? [Y/n]'
    if ($open -notmatch '^(n|no)$') { & (Join-Path $InstallDir 'CrustDash.cmd') }
}
