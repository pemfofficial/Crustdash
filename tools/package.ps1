<#
.SYNOPSIS
  Builds the Steam release zip: the dashboard as a standalone server, a portable Node.js runtime, UE4SS, the
  CrustWatcher mod and the install scripts.

.PARAMETER OutDir
  Where the staging folder and the zip go. Default: release\ in the repository.
#>
param(
    [string]$OutDir = (Join-Path (Split-Path -Parent $PSScriptRoot) 'release')
)

$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$NodeVersion = '24.15.0'
$Ue4ssUrl = 'https://github.com/UE4SS-RE/RE-UE4SS/releases/download/experimental-latest/UE4SS_v3.0.1-1133-gb4cefa18.zip'
$Ue4ssSha256 = '89B7EED47C37D6FF6EAA144A41311A75098279A3454777F4EDD2446CEA1EA7A8'

$version = (Get-Content (Join-Path $Repo 'dashboard\package.json') -Raw | ConvertFrom-Json).version
$stage = Join-Path $OutDir "CrustDash-$version"
$downloads = Join-Path $OutDir 'downloads'
New-Item -ItemType Directory -Force -Path $downloads | Out-Null
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

# Windows PowerShell treats anything a native tool writes to stderr (npm's warnings) as an error under 'Stop';
# run it with 'Continue' and judge success by the exit code instead
function Invoke-Native([string]$what, [scriptblock]$command) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $command 2>&1 | ForEach-Object { Write-Host "$_" }
    } finally {
        $ErrorActionPreference = $previous
    }
    if ($LASTEXITCODE) { throw "$what failed (exit code $LASTEXITCODE)" }
}

function Save-Verified([string]$url, [string]$file, [string]$sha256) {
    if (-not (Test-Path $file) -or (Get-FileHash $file -Algorithm SHA256).Hash -ne $sha256) {
        Write-Host "Downloading $url"
        Invoke-WebRequest $url -OutFile $file -UseBasicParsing
    }
    if ((Get-FileHash $file -Algorithm SHA256).Hash -ne $sha256) { throw "Checksum mismatch: $url" }
}

Write-Host '== Building the dashboard' -ForegroundColor Cyan
# Build from a clean copy so a running development server (and its node_modules and .next) is left alone
$build = Join-Path $OutDir 'build\dashboard'
if (Test-Path $build) { Remove-Item $build -Recurse -Force }
New-Item -ItemType Directory -Force -Path $build | Out-Null
robocopy (Join-Path $Repo 'dashboard') $build /E /XD node_modules .next /XF *.md *.log /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'Copying the dashboard sources failed' }
Push-Location $build
try {
    Invoke-Native 'npm ci' { npm ci --no-audit --no-fund }
    Invoke-Native 'next build' { npm run build }
} finally {
    Pop-Location
}
$standalone = Join-Path $build '.next\standalone'
if (-not (Test-Path (Join-Path $standalone 'server.js'))) { throw 'The build has no .next\standalone\server.js' }
Copy-Item $standalone (Join-Path $stage 'app') -Recurse
Copy-Item (Join-Path $build '.next\static') (Join-Path $stage 'app\.next\static') -Recurse
if (Test-Path (Join-Path $build 'public')) { Copy-Item (Join-Path $build 'public') (Join-Path $stage 'app\public') -Recurse }

Write-Host "== Node.js $NodeVersion runtime" -ForegroundColor Cyan
$nodeZipName = "node-v$NodeVersion-win-x64.zip"
$sums = (Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt" -UseBasicParsing).Content
$nodeSha = ([regex]::Match($sums, "(?m)^([0-9a-f]{64})\s+$([regex]::Escape($nodeZipName))$")).Groups[1].Value.ToUpper()
if (-not $nodeSha) { throw "No checksum for $nodeZipName" }
$nodeZip = Join-Path $downloads $nodeZipName
Save-Verified "https://nodejs.org/dist/v$NodeVersion/$nodeZipName" $nodeZip $nodeSha
$nodeDir = Join-Path $downloads "node-v$NodeVersion-win-x64"
if (-not (Test-Path $nodeDir)) { Expand-Archive $nodeZip $downloads }
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'runtime') | Out-Null
Copy-Item (Join-Path $nodeDir 'node.exe'), (Join-Path $nodeDir 'LICENSE') (Join-Path $stage 'runtime')

Write-Host '== UE4SS' -ForegroundColor Cyan
$ue4ssZip = Join-Path $downloads 'UE4SS_v3.0.1-1133-gb4cefa18.zip'
Save-Verified $Ue4ssUrl $ue4ssZip $Ue4ssSha256
Expand-Archive $ue4ssZip (Join-Path $stage 'ue4ss')

Write-Host '== Mod and scripts' -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'mod') | Out-Null
Copy-Item (Join-Path $Repo 'watcher\CrustWatcher') (Join-Path $stage 'mod\CrustWatcher') -Recurse
Remove-Item (Join-Path $stage 'mod\CrustWatcher\Scripts\settings.lua') -ErrorAction SilentlyContinue
Copy-Item (Join-Path $Repo 'package\scripts') (Join-Path $stage 'scripts') -Recurse
Copy-Item (Join-Path $Repo 'package\*') $stage -Include '*.cmd', '*.txt', '*.md'
Set-Content (Join-Path $stage 'VERSION') $version -Encoding ASCII

Write-Host '== Zip' -ForegroundColor Cyan
$zip = Join-Path $OutDir "CrustDash-$version-steam.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $stage -DestinationPath $zip
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash
Set-Content "$zip.sha256" "$hash  $(Split-Path -Leaf $zip)" -Encoding ASCII
Write-Host "Built $zip" -ForegroundColor Green
Write-Host "SHA-256 $hash"
