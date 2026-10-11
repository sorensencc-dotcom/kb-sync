<#
.SYNOPSIS
Launches a dedicated Google Chrome instance for interactive NotebookLM authentication/session repair.

.DESCRIPTION
Manages a dedicated Chrome profile directory (C:\Users\soren\.config\chrome-notebooklm-profile)
bound to remote debugging (CDP). This provides a persistent browser environment
for manual login, 2FA renewal, or backing external session providers like 'nlm login --provider openclaw'.
Incorporates single-instance locking and stale lockfile recovery to prevent port contention.

.PARAMETER Port
Remote debugging port. Defaults to 9222.

.PARAMETER ProfileDir
Path to the dedicated Chrome user data directory.

.EXAMPLE
.\launch-nlm-chrome.ps1
Launches the dedicated Chrome browser headed for operator authentication.
#>
[CmdletBinding()]
param (
    [int]$Port = 9222,
    [string]$ProfileDir = "C:\Users\soren\.config\chrome-notebooklm-profile"
)

$ErrorActionPreference = "Stop"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " NotebookLM Dedicated Chrome Session Manager (Interactive Repair)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# 1. Ensure Profile Directory Exists
if (-not (Test-Path $ProfileDir)) {
    Write-Host "[+] Creating persistent profile directory: $ProfileDir" -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $ProfileDir -Force | Out-Null
} else {
    Write-Host "[*] Using existing profile directory: $ProfileDir" -ForegroundColor Gray
}

# 2. Check if Port is Already Listening and Responsive
$portActive = $false
try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect("127.0.0.1", $Port)
    $portActive = $true
    $tcp.Close()
} catch {
    $portActive = $false
}

if ($portActive) {
    Write-Host "[!] Port $Port is currently open." -ForegroundColor Yellow
    try {
        $versionInfo = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 3
        Write-Host "[✓] Chrome CDP endpoint already alive: $($versionInfo.Browser)" -ForegroundColor Green
        Write-Host "    WebSocket: $($versionInfo.webSocketDebuggerUrl)" -ForegroundColor Gray
        Write-Host "`n[✓] Session host is ready for 'nlm login --provider openclaw --cdp-url http://127.0.0.1:$Port'" -ForegroundColor Green
        return
    } catch {
        Write-Warning "Port $Port is open but did not respond to /json/version. Ensure no other process occupies port $Port."
        exit 1
    }
}

# 3. Clean Stale Singleton Locks
$lockFiles = @(
    Join-Path $ProfileDir "SingletonLock",
    Join-Path $ProfileDir "SingletonCookie",
    Join-Path $ProfileDir "SingletonSocket"
)
$hasLocks = ($lockFiles | Where-Object { Test-Path $_ }).Count -gt 0
if ($hasLocks) {
    $runningChrome = Get-Process chrome -ErrorAction SilentlyContinue
    if ($runningChrome) {
        Write-Warning "Chrome processes are currently running on the system. Skipping removal of Singleton locks to avoid profile corruption."
    } else {
        foreach ($lockFile in $lockFiles) {
            if (Test-Path $lockFile) {
                Write-Host "[!] Removing stale profile lock: $(Split-Path $lockFile -Leaf)" -ForegroundColor Yellow
                Remove-Item -Path $lockFile -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

# 4. Locate Chrome Binary
$chromePaths = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chromeExe = $null
foreach ($path in $chromePaths) {
    if (Test-Path $path) {
        $chromeExe = $path
        break
    }
}

if (-not $chromeExe) {
    Write-Error "Google Chrome executable not found in standard installation paths."
    exit 1
}

Write-Host "[*] Found Chrome: $chromeExe" -ForegroundColor Gray

# 5. Build Arguments
# Launch in visible, interactive mode so Google account challenges/2FA succeed naturally without bot flags.
$arguments = @(
    "--remote-debugging-port=$Port",
    "--user-data-dir=`"$ProfileDir`"",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate,OptimizationHints",
    "--disable-component-update",
    "`"https://notebooklm.google.com`""
)

$argString = $arguments -join " "

Write-Host "[+] Launching Chrome on port $Port for operator authentication..." -ForegroundColor Cyan
$process = Start-Process -FilePath $chromeExe -ArgumentList $argString -PassThru

# 6. Verify Port Readiness
$maxAttempts = 15
$attempt = 0
$ready = $false
Write-Host "[*] Waiting for CDP endpoint on http://127.0.0.1:$Port/json/version..." -NoNewline

while ($attempt -lt $maxAttempts -and -not $ready) {
    Start-Sleep -Milliseconds 600
    try {
        $ver = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2
        $ready = $true
        Write-Host " [READY]" -ForegroundColor Green
        Write-Host "[✓] Browser: $($ver.Browser)" -ForegroundColor Green
        Write-Host "[✓] WebSocket URL: $($ver.webSocketDebuggerUrl)" -ForegroundColor Green
    } catch {
        $attempt++
        Write-Host "." -NoNewline
    }
}

if (-not $ready) {
    Write-Warning "`n[!] Timed out waiting for Chrome CDP to respond on port $Port."
    Write-Warning " Process ID: $($process.Id)"
    exit 1
}

Write-Host "`n[✓] Session host initialized successfully." -ForegroundColor Cyan
Write-Host "--> Complete login in the opened browser window if needed." -ForegroundColor White
Write-Host "--> To link credentials into nlm CLI: nlm login --provider openclaw --cdp-url http://127.0.0.1:$Port" -ForegroundColor White
