# ==============================================================================
# TRM Gap Triage Scheduled Task Wrapper
# Runs automated cognitive gap triage against local SQLite context cache
# using --provider=auto (Ollama -> OpenRouter -> Heuristic fallback).
# ==============================================================================
[CmdletBinding()]
param(
    [string]$Provider = "auto",
    [string]$Model = "",
    [switch]$DryRun
)

$ErrorActionPreference = "Continue"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RepoRoot = (Resolve-Path "$ScriptDir\..").Path

$LogDir = Join-Path $RepoRoot "logs"

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogFile = Join-Path $LogDir "TRM-Triage-$Timestamp.log"
$StartTime = Get-Date

. (Join-Path $RepoRoot "scripts\git-sync-preflight.ps1")
Invoke-GitSyncPreflight -RepoRoot $RepoRoot -LogPrefix "[TRM-TRIAGE] [GIT-SYNC]" -LogFile $LogFile

function Write-LogInfo($Message) {
    $msg = "[TRM-TRIAGE] [INFO] $Message"
    Write-Host $msg -ForegroundColor Green
    $msg | Tee-Object -FilePath $LogFile -Append | Out-Null
}

function Write-LogWarn($Message) {
    $msg = "[TRM-TRIAGE] [WARN] $Message"
    Write-Host $msg -ForegroundColor Yellow
    $msg | Tee-Object -FilePath $LogFile -Append | Out-Null
}

function Write-LogError($Message) {
    $msg = "[TRM-TRIAGE] [ERROR] $Message"
    Write-Host $msg -ForegroundColor Red
    $msg | Tee-Object -FilePath $LogFile -Append | Out-Null
}

Write-LogInfo "Starting TRM Automated Gap Triage..."
Write-LogInfo "Repo Root: $RepoRoot"
Write-LogInfo "Provider: $Provider"
Set-Location $RepoRoot

$ExitCode = 0

try {
    # 1. Sync local cache first so newly added wiki nodes/entities are indexed
    Write-LogInfo "Syncing local SQLite context cache..."
    & cmd /c "npm run kb:cache:sync" 2>&1 | Tee-Object -FilePath $LogFile -Append | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-LogWarn "Cache sync completed with non-zero exit code: $LASTEXITCODE. Proceeding with triage..."
    }

    # 2. Evaluate UTC Cadence Mode
    $CadenceStatePath = Join-Path $RepoRoot "_kb-sync-staging\trm\cadence_state.json"
    $CadenceMode = "active"
    if (Test-Path $CadenceStatePath) {
        try {
            $cadenceState = Get-Content $CadenceStatePath -Raw | ConvertFrom-Json
            if ($cadenceState.last_source_delta_utc) {
                $nowUtc = [DateTime]::UtcNow
                $lastDeltaUtc = [DateTime]::Parse($cadenceState.last_source_delta_utc).ToUniversalTime()
                $hoursIdle = ($nowUtc - $lastDeltaUtc).TotalHours
                if ($hoursIdle -gt 72) {
                    $CadenceMode = "weekly"
                }
            }
        } catch {
            Write-LogWarn "Failed reading cadence state: $_"
        }
    }
    Write-LogInfo "TRM Cadence Mode: $CadenceMode"

    if (Test-Path (Join-Path $RepoRoot "scripts\run-closed-loop-research-v2.mjs")) {
        if ($CadenceMode -eq "active") {
            Write-LogInfo "Running closed loop research pass (--mode active)..."
            & node scripts/run-closed-loop-research-v2.mjs --mode active 2>&1 | Tee-Object -FilePath $LogFile -Append | Out-Null
        } else {
            Write-LogInfo "Running closed loop research pass (--mode weekly)..."
            & node scripts/run-closed-loop-research-v2.mjs --mode weekly 2>&1 | Tee-Object -FilePath $LogFile -Append | Out-Null
        }
    }

    # 3. Run TRM Triage
    Write-LogInfo "Executing TRM Gap Triage engine..."
    $triageArgs = @("scripts/trm-triage.mjs", "--provider=$Provider")
    if ($Model) {
        $triageArgs += "--model=$Model"
    }
    if ($DryRun) {
        $triageArgs += "--dry-run"
    }

    & node $triageArgs 2>&1 | Tee-Object -FilePath $LogFile -Append | Out-Null
    $ExitCode = $LASTEXITCODE

    if ($ExitCode -eq 0) {
        Write-LogInfo "TRM Gap Triage completed successfully."
        
        # 3. Export newly active/triaged priority gaps to Google Drive (Evening Drop)
        Write-LogInfo "Dropping priority actionable gaps to Google Drive (Evening Drop)..."
        & node scripts/trm-export-gaps.mjs 2>&1 | Tee-Object -FilePath $LogFile -Append | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-LogWarn "TRM Gap Export exited with code $LASTEXITCODE"
        } else {
            Write-LogInfo "TRM Gap Export completed successfully."
        }
    } else {
        Write-LogError "TRM Gap Triage exited with code $ExitCode"
    }
} catch {
    Write-LogError "TRM Gap Triage encountered an unhandled error: $_"
    $ExitCode = 1
}

$EndTime = Get-Date
$Duration = ($EndTime - $StartTime).TotalSeconds
Write-LogInfo ("TRM Gap Triage Finished (Duration: {0:F2}s, Exit Code: {1})" -f $Duration, $ExitCode)

exit $ExitCode
