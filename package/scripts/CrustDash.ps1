<#
.SYNOPSIS
  Opens the CrustDash dashboard, starting its local server when needed, and shows a tray icon with its status,
  Open, Restart and Quit.

.PARAMETER Debug
  Run the server in this window so its log is visible (also saved to data\logs\dashboard-debug.log), with extra logging
  from the dashboard and the CrustWatcher mod. Close the window to stop the dashboard.

.PARAMETER FromGame
  Used by the CrustWatcher mod when the game starts: start the server, open the browser once, and quit after the game
  closes.

.PARAMETER NoBrowser
  Start the server without opening the browser.

.PARAMETER Stop
  Stop the dashboard and close its tray icon.
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
$StopFile = Join-Path $Data 'stop.request'
New-Item -ItemType Directory -Force -Path $Logs | Out-Null

function Write-Log([string]$message) {
    Add-Content (Join-Path $Logs 'launcher.log') "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $message"
}

function Stop-Dashboard {
    $process = Get-DashboardProcess $Root
    if ($process) { Stop-Process -Id $process.Id -Force }
    Remove-Item $PidFile -ErrorAction SilentlyContinue
}

function Get-InstallInfo {
    $file = Join-Path $Root 'install.json'
    if (Test-Path $file) { return Get-Content $file -Raw | ConvertFrom-Json }
    return $null
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

function Start-Server {
    Write-Log "starting on port $script:Port$(if ($FromGame) { ' (from the game)' })"
    $process = Start-Process -FilePath $script:Node -ArgumentList "`"$script:Server`"" -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $Logs 'dashboard.log') -RedirectStandardError (Join-Path $Logs 'dashboard-errors.log')
    Set-Content $PidFile $process.Id
    $deadline = (Get-Date).AddSeconds(45)
    while (-not (Test-OurDashboard $script:Port $Data)) {
        if ($process.HasExited -or (Get-Date) -gt $deadline) {
            Write-Log "server didn't start (exited: $($process.HasExited))"
            return $false
        }
        Start-Sleep -Milliseconds 500
    }
    Write-Log 'running'
    return $true
}

# One line of status: is the dashboard up, and is the game feeding it live data?
function Get-StatusText {
    try {
        $health = Invoke-RestMethod "http://127.0.0.1:$script:Port/api/health" -TimeoutSec 1
    } catch {
        return 'Stopped'
    }
    if (-not ($health.app -eq 'CrustDash' -and $health.dataDir -ieq $Data)) { return 'Stopped' }
    if ($null -ne $health.liveAgeSeconds -and $health.liveAgeSeconds -lt 20) { return 'Running, game connected' }
    if (Get-Process -Name $GameProcess -ErrorAction SilentlyContinue) { return 'Running, waiting for a save to load' }
    return 'Running, game not started'
}

function New-TrayIcon {
    # A cratered moon in the dashboard's hazard orange
    $bitmap = New-Object System.Drawing.Bitmap 32, 32
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(240, 138, 36))), 2, 2, 28, 28)
    $crater = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(40, 30, 20))
    $graphics.FillEllipse($crater, 7, 14, 11, 11)
    $graphics.FillEllipse($crater, 19, 7, 6, 6)
    $graphics.FillEllipse($crater, 20, 20, 4, 4)
    $graphics.Dispose()
    return [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
}

function Start-Tray {
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    $created = $false
    $script:Mutex = New-Object System.Threading.Mutex($true, 'Local\CrustDashTray', [ref]$created)
    if (-not $created) { return }  # a tray icon is already showing
    Remove-Item $StopFile -ErrorAction SilentlyContinue
    [System.Windows.Forms.Application]::EnableVisualStyles()

    $script:Tray = New-Object System.Windows.Forms.NotifyIcon
    $script:Tray.Icon = New-TrayIcon
    $script:Tray.Text = 'CrustDash'
    $menu = New-Object System.Windows.Forms.ContextMenuStrip
    $script:StatusItem = $menu.Items.Add('Status: starting')
    $script:StatusItem.Enabled = $false
    [void]$menu.Items.Add('-')
    $openItem = $menu.Items.Add('Open dashboard')
    $openItem.Font = New-Object System.Drawing.Font($openItem.Font, [System.Drawing.FontStyle]::Bold)
    $script:RestartItem = $menu.Items.Add('Restart')
    $logsItem = $menu.Items.Add('Open logs folder')
    [void]$menu.Items.Add('-')
    $quitItem = $menu.Items.Add('Quit CrustDash')
    $script:Tray.ContextMenuStrip = $menu
    $script:Tray.Visible = $true
    $script:SawGame = [bool](Get-Process -Name $GameProcess -ErrorAction SilentlyContinue)

    $openItem.add_Click({ Start-Process "http://127.0.0.1:$script:Port" })
    $script:Tray.add_DoubleClick({ Start-Process "http://127.0.0.1:$script:Port" })
    $logsItem.add_Click({ Start-Process explorer.exe $Logs })
    $script:RestartItem.add_Click({
        try {
            $script:StatusItem.Text = 'Status: restarting'
            Stop-Dashboard
            if (Start-Server) {
                $script:Tray.ShowBalloonTip(3000, 'CrustDash', 'The dashboard restarted.', [System.Windows.Forms.ToolTipIcon]::Info)
            } else {
                $script:Tray.ShowBalloonTip(5000, 'CrustDash', "The dashboard didn't start. Open the logs folder for details.", [System.Windows.Forms.ToolTipIcon]::Error)
            }
            Update-TrayStatus
        } catch {
            Write-Log "restart failed: $_"
        }
    })
    $quitItem.add_Click({ Close-Tray })

    $script:Timer = New-Object System.Windows.Forms.Timer
    $script:Timer.Interval = 5000
    $script:Timer.add_Tick({
        try {
            if (Test-Path $StopFile) { Close-Tray; return }
            if ($FromGame) {
                # Started with the game: quit once the game has closed
                $gameRunning = [bool](Get-Process -Name $GameProcess -ErrorAction SilentlyContinue)
                if ($gameRunning) { $script:SawGame = $true } elseif ($script:SawGame) { Write-Log 'game closed'; Close-Tray; return }
            }
            Update-TrayStatus
        } catch {
            Write-Log "status check failed: $_"
        }
    })
    $script:Timer.Start()
    Update-TrayStatus
    $script:Tray.ShowBalloonTip(4000, 'CrustDash is running', 'Right-click the moon icon for status, Restart and Quit.', [System.Windows.Forms.ToolTipIcon]::Info)
    [System.Windows.Forms.Application]::Run()
}

function Update-TrayStatus {
    $status = Get-StatusText
    $script:StatusItem.Text = "Status: $status"
    $script:RestartItem.Text = if ($status -eq 'Stopped') { 'Start' } else { 'Restart' }
    $tip = "CrustDash: $status"
    $script:Tray.Text = $tip.Substring(0, [Math]::Min(63, $tip.Length))
}

function Close-Tray {
    $script:Timer.Stop()
    Stop-Dashboard
    Remove-Item $StopFile -ErrorAction SilentlyContinue
    Write-Log 'quit'
    $script:Tray.Visible = $false
    $script:Tray.Dispose()
    [System.Windows.Forms.Application]::Exit()
}

if ($Stop) {
    # Ask a running tray icon to quit (it stops the server), and stop the server in case there is no tray
    Set-Content $StopFile (Get-Date -Format o)
    Stop-Dashboard
    Write-Log 'stop requested'
    Write-Host 'CrustDash stopped.'
    exit 0
}

$script:Port = Get-DashboardPort $Root
if (Test-OurDashboard $script:Port $Data) {
    # Already running: just show it (the game's own start doesn't reopen the browser)
    if (-not $NoBrowser -and -not $FromGame) { Start-Process "http://127.0.0.1:$script:Port" }
    if (-not $Debug) { Start-Tray }
    exit 0
}

# Something else holds the port: use the next free one and remember it
if (-not (Test-PortFree $script:Port)) {
    $taken = $script:Port
    $script:Port = (3000..3050 | Where-Object { $_ -ne $taken -and (Test-PortFree $_) } | Select-Object -First 1)
    if (-not $script:Port) {
        Write-Log 'no free port between 3000 and 3050'
        Write-Host 'No free port between 3000 and 3050 for the dashboard.' -ForegroundColor Red
        if (-not $FromGame) { Read-Host 'Press Enter to close' | Out-Null }
        exit 1
    }
    Write-Log "port $taken is used by another program; using $script:Port"
    if (-not $env:CRUSTDASH_PORT) { Set-Content (Join-Path $Data 'port.txt') $script:Port -Encoding ASCII }
}
$Url = "http://127.0.0.1:$script:Port"

$install = Get-InstallInfo
$env:CRUST_DATA_DIR = $Data
if ($install -and $install.gameDir) { $env:CRUST_GAME_DIR = $install.gameDir }
$env:PORT = "$script:Port"
$env:HOSTNAME = '127.0.0.1'
$env:NODE_ENV = 'production'
$script:Node = Join-Path $Root 'runtime\node.exe'
$script:Server = Join-Path $Root 'app\server.js'

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
            try { if ((Invoke-RestMethod "$url/api/health" -TimeoutSec 2).app -eq 'CrustDash') { Start-Process $url; return } } catch { }
            Start-Sleep -Milliseconds 500
        }
    } -ArgumentList $Url | Out-Null
    # The server logs warnings to stderr; under 'Stop' Windows PowerShell would treat those as fatal
    $ErrorActionPreference = 'Continue'
    try {
        & $script:Node $script:Server 2>&1 | ForEach-Object { "$_" } | Tee-Object -FilePath (Join-Path $Logs 'dashboard-debug.log')
    } finally {
        Set-ModDebug $false
    }
    exit 0
}

if (-not (Start-Server)) {
    Write-Host "The dashboard didn't start. Details: $Logs\dashboard-errors.log" -ForegroundColor Red
    if (-not $FromGame) { Read-Host 'Press Enter to close' | Out-Null }
    exit 1
}
if (-not $NoBrowser) { Start-Process $Url }
Start-Tray
