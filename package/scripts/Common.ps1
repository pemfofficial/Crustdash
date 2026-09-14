# Shared by the CrustDash install, launch, uninstall and diagnostics scripts. Windows PowerShell 5.1 compatible.

$SteamAppId = '1465470'
$GameExe = 'TheCrust-Win64-Shipping.exe'
$GameProcess = 'TheCrust-Win64-Shipping'
$DefaultPort = 3000

# UE4SS v3.0.1-1133-gb4cefa18 (github.com/UE4SS-RE/RE-UE4SS, experimental-latest): the build CrustDash is tested with
$Ue4ssHashes = @{
    'dwmapi.dll' = 'E6DFAFA038D0D913B59BA33CBC8412CF73F8EB32BF053F19757A0AFF7C453481'
    'UE4SS.dll'  = '03C9D35F6A55666839565358EDEA09F5F11C7929440FE5C809E457D6D527C71F'
}

function Write-Step([string]$text) {
    Write-Host ''
    Write-Host "== $text" -ForegroundColor Cyan
}

function Get-PackageVersion([string]$root) {
    $file = Join-Path $root 'VERSION'
    if (Test-Path $file) { return (Get-Content $file -Raw).Trim() }
    return 'dev'
}

function Get-SteamLibraries {
    $roots = @()
    foreach ($key in @(@('HKCU:\Software\Valve\Steam', 'SteamPath'), @('HKLM:\SOFTWARE\WOW6432Node\Valve\Steam', 'InstallPath'))) {
        try { $roots += (Get-ItemProperty $key[0] -ErrorAction Stop).($key[1]) } catch { }
    }
    $roots += (Join-Path ${env:ProgramFiles(x86)} 'Steam')
    $libraries = @()
    foreach ($root in ($roots | Where-Object { $_ } | ForEach-Object { $_ -replace '/', '\' } | Select-Object -Unique)) {
        $libraries += $root
        $vdf = Join-Path $root 'steamapps\libraryfolders.vdf'
        if (Test-Path $vdf) {
            foreach ($match in [regex]::Matches((Get-Content $vdf -Raw), '"path"\s+"([^"]+)"')) {
                $libraries += ($match.Groups[1].Value -replace '\\\\', '\')
            }
        }
    }
    return $libraries | Select-Object -Unique
}

function Find-CrustGame {
    foreach ($library in Get-SteamLibraries) {
        $folder = 'The Crust'
        $manifest = Join-Path $library "steamapps\appmanifest_$SteamAppId.acf"
        if (Test-Path $manifest) {
            $match = [regex]::Match((Get-Content $manifest -Raw), '"installdir"\s+"([^"]+)"')
            if ($match.Success) { $folder = $match.Groups[1].Value }
        }
        $dir = Join-Path $library "steamapps\common\$folder"
        if (Test-Path (Join-Path (Get-Win64Dir $dir) $GameExe)) { return $dir }
    }
    return $null
}

function Get-Win64Dir([string]$gameDir) { return Join-Path $gameDir 'TheCrust\Binaries\Win64' }

# True when the copy of the game in this folder is running (files there are locked while it runs)
function Test-GameRunning([string]$win64) {
    $exe = Join-Path $win64 $GameExe
    return [bool](Get-Process -Name $GameProcess -ErrorAction SilentlyContinue | Where-Object { $_.Path -and ($_.Path -ieq $exe) })
}

function Set-IniValue([string]$file, [string]$key, [string]$value) {
    $text = [IO.File]::ReadAllText($file)
    $pattern = "(?m)^[ \t]*$([regex]::Escape($key))[ \t]*=.*$"
    if ([regex]::IsMatch($text, $pattern)) { $text = [regex]::Replace($text, $pattern, "$key = $value") }
    [IO.File]::WriteAllText($file, $text)
}

function Write-Utf8([string]$path, [string]$text) {
    [IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding $false))
}

function Write-WatcherSettings([string]$ModDir, [string]$InstallDir, [bool]$StartWithGame, [bool]$DebugMode) {
    $live = (Join-Path $InstallDir 'data\live') -replace '\\', '/'
    $launcher = (Join-Path $InstallDir 'scripts\CrustDash.ps1') -replace '\\', '/'
    $start = if ($StartWithGame) { 'true' } else { 'false' }
    $debug = if ($DebugMode) { 'true' } else { 'false' }
    $lua = @"
-- Written by the CrustDash installer; reinstalling rewrites it.
return {
    outDir = "$live",
    launcher = "$launcher",
    startWithGame = $start,
    debug = $debug,
}
"@
    Write-Utf8 (Join-Path $ModDir 'Scripts\settings.lua') $lua
}

# UE4SS reads mods.txt when it exists; add the mod above the built-in Keybinds entry, which must stay last
function Enable-ModInList([string]$modsTxt, [string]$mod) {
    if (-not (Test-Path $modsTxt)) { return }
    $lines = @(Get-Content $modsTxt)
    $pattern = "^\s*$([regex]::Escape($mod))\s*:"
    if ($lines | Where-Object { $_ -match $pattern }) {
        $lines = $lines | ForEach-Object { if ($_ -match $pattern) { "$mod : 1" } else { $_ } }
    } else {
        $at = $lines.Count
        for ($i = 0; $i -lt $lines.Count; $i++) {
            if ($lines[$i] -match '^\s*;\s*Built-in keybinds' -or $lines[$i] -match '^\s*Keybinds\s*:') { $at = $i; break }
        }
        $before = if ($at -gt 0) { $lines[0..($at - 1)] } else { @() }
        $after = if ($at -lt $lines.Count) { $lines[$at..($lines.Count - 1)] } else { @() }
        $lines = @($before) + "$mod : 1" + @($after)
    }
    Set-Content $modsTxt $lines -Encoding ASCII
}

function Disable-ModInList([string]$modsTxt, [string]$mod) {
    if (-not (Test-Path $modsTxt)) { return }
    $pattern = "^\s*$([regex]::Escape($mod))\s*:"
    Set-Content $modsTxt (@(Get-Content $modsTxt) | Where-Object { $_ -notmatch $pattern }) -Encoding ASCII
}

function New-Shortcut([string]$path, [string]$target, [string]$arguments, [string]$workingDir, [string]$description, [int]$windowStyle) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($path)
    $shortcut.TargetPath = $target
    $shortcut.Arguments = $arguments
    $shortcut.WorkingDirectory = $workingDir
    $shortcut.Description = $description
    $shortcut.WindowStyle = $windowStyle
    $shortcut.Save()
}

# The port the dashboard uses: CRUSTDASH_PORT, else the one the launcher last picked (data\port.txt), else 3000
function Get-DashboardPort([string]$installDir) {
    if ($env:CRUSTDASH_PORT) { return [int]$env:CRUSTDASH_PORT }
    $file = Join-Path $installDir 'data\port.txt'
    if (Test-Path $file) { return [int](Get-Content $file -Raw).Trim() }
    return $DefaultPort
}

# True only when this install's dashboard answers on the port (not some other program, not another copy)
function Test-OurDashboard([int]$port, [string]$dataDir) {
    try {
        $health = Invoke-RestMethod "http://127.0.0.1:$port/api/health" -TimeoutSec 2
        return $health.app -eq 'CrustDash' -and $health.dataDir -ieq $dataDir
    } catch {
        return $false
    }
}

function Test-PortFree([int]$port) {
    if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { return $false }
    $listener = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Loopback), $port
    try { $listener.Start(); return $true } catch { return $false } finally { $listener.Stop() }
}

function Get-DashboardProcess([string]$installDir) {
    $pidFile = Join-Path $installDir 'data\dashboard.pid'
    if (-not (Test-Path $pidFile)) { return $null }
    $process = Get-Process -Id ([int](Get-Content $pidFile -Raw)) -ErrorAction SilentlyContinue
    if ($process -and $process.ProcessName -eq 'node') { return $process }
    return $null
}
