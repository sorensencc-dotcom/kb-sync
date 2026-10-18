# ==============================================================================
# KB Sync Operations Audit Wrapper
# Evaluates completed dev and operational state post-ops-sync
# Scheduled for 07:45 PM EDT daily.
# ==============================================================================
[CmdletBinding()]
param()

$ErrorActionPreference = "Continue"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RepoRoot = (Resolve-Path "$ScriptDir\..").Path
Set-Location $RepoRoot
$LogDir = Join-Path $RepoRoot "logs"

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogFile = Join-Path $LogDir "KB-Sync-Ops-Audit-$Timestamp.log"
$StartTime = Get-Date

function Write-LogInfo($Message) {
    $msg = "[KB-SYNC-OPS-AUDIT] [INFO] $Message"
    Write-Host $msg -ForegroundColor Green
    $msg | Tee-Object -FilePath $LogFile -Append | Out-Null
}

function Write-LogError($Message) {
    $msg = "[KB-SYNC-OPS-AUDIT] [ERROR] $Message"
    Write-Host $msg -ForegroundColor Red
    $msg | Tee-Object -FilePath $LogFile -Append | Out-Null
}

Write-LogInfo "Starting KB Sync Operations Audit (Evaluating Dev/Ops State)..."
Write-LogInfo "Repo Root: $RepoRoot"

$OverallStatus = 0

# Check drift and governance validation
try {
    Write-LogInfo "Running drift scan..."
    & npm run kb:drift 2>&1 | Tee-Object -FilePath $LogFile -Append
    if ($LASTEXITCODE -ne 0) {
        Write-LogError "Drift scan reported exit code $LASTEXITCODE"
        $OverallStatus = 1
    }
} catch {
    Write-LogError "Drift scan failed: $_"
    $OverallStatus = 1
}

try {
    Write-LogInfo "Running replace gate test audit..."
    & npm run test:replace-gate 2>&1 | Tee-Object -FilePath $LogFile -Append
    if ($LASTEXITCODE -ne 0) {
        Write-LogError "Replace gate test audit reported exit code $LASTEXITCODE"
        $OverallStatus = 1
    }
} catch {
    Write-LogError "Replace gate test audit failed: $_"
    $OverallStatus = 1
}

Write-LogInfo "Operations audit finished in $([math]::Round(((Get-Date) - $StartTime).TotalMinutes, 2)) min with overall status: $OverallStatus."
exit $OverallStatus
