# ==============================================================================
# TRM Google Drive Transport Sync Scheduled Task Wrapper (Tier 3 IronBot)
# Runs automated 4-hour sync between local Git repository and Google Drive:
# 1. Ingests completed research findings from 03_grok_completed/
# 2. Refreshes actionable gap cards in 01_actionable_gaps/ & context packs
# 3. Purges expired research leases in _locks/
# ==============================================================================
[CmdletBinding()]
param(
    [switch]$Commit,
    [switch]$Export
)

$ErrorActionPreference = "Continue"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RepoRoot = (Resolve-Path "$ScriptDir\..").Path

$LogDir = Join-Path $RepoRoot "logs"

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogFile = Join-Path $LogDir "TRM-Drive-Sync-$Timestamp.log"
$StartTime = Get-Date

if (Test-Path (Join-Path $RepoRoot "scripts\git-sync-preflight.ps1")) {
    . (Join-Path $RepoRoot "scripts\git-sync-preflight.ps1")
    Invoke-GitSyncPreflight -RepoRoot $RepoRoot -LogPrefix "[TRM-DRIVE-SYNC] [GIT-SYNC]" -LogFile $LogFile
}

function Write-LogInfo($Message) {
    $msg = "[TRM-DRIVE-SYNC] [INFO] $Message"
    Write-Host $msg -ForegroundColor Green
    $msg | Tee-Object -FilePath $LogFile -Append | Out-Null
}

function Write-LogWarn($Message) {
    $msg = "[TRM-DRIVE-SYNC] [WARN] $Message"
    Write-Host $msg -ForegroundColor Yellow
    $msg | Tee-Object -FilePath $LogFile -Append | Out-Null
}

function Write-LogError($Message) {
    $msg = "[TRM-DRIVE-SYNC] [ERROR] $Message"
    Write-Host $msg -ForegroundColor Red
    $msg | Tee-Object -FilePath $LogFile -Append | Out-Null
}

Write-LogInfo "Starting TRM Google Drive Transport Sync..."
Write-LogInfo "Repo Root: $RepoRoot"
Set-Location $RepoRoot

$ExitCode = 0

try {
    # 1. Ingest completed findings from Google Drive
    Write-LogInfo "Running TRM Drive Findings Ingestion..."
    $ingestArgs = @("scripts/trm-ingest-drive.mjs")
    if ($Commit) {
        $ingestArgs += "--commit"
    }

    & node $ingestArgs 2>&1 | Tee-Object -FilePath $LogFile -Append | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-LogError "TRM Drive Ingestion failed with exit code $LASTEXITCODE"
        $ExitCode = $LASTEXITCODE
    } else {
        Write-LogInfo "TRM Drive Ingestion completed successfully."
    }

    # 2. Refresh / top-up actionable gaps on Google Drive (only when explicitly requested)
    if ($Export) {
        Write-LogInfo "Exporting priority actionable gaps to Google Drive..."
        & node scripts/trm-export-gaps.mjs 2>&1 | Tee-Object -FilePath $LogFile -Append | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-LogWarn "TRM Gap Export exited with code $LASTEXITCODE"
        } else {
            Write-LogInfo "TRM Gap Export completed successfully."
        }
    }
} catch {
    Write-LogError "TRM Drive Sync encountered an unhandled error: $_"
    $ExitCode = 1
}

$EndTime = Get-Date
$Duration = ($EndTime - $StartTime).TotalSeconds
Write-LogInfo ("TRM Drive Sync Finished (Duration: {0:F2}s, Exit Code: {1})" -f $Duration, $ExitCode)

exit $ExitCode
