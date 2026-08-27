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

    # 2. Run TRM Triage
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
