# ==============================================================================
# KB Sync Operations Pipeline Wrapper
# Executes Clusters C, D, and E (Core Dev, Tooling, Canonical KB, Operational Radars)
# Scheduled for 06:45 PM EDT daily. Bounded runtime (~20-30m).
# ==============================================================================
[CmdletBinding()]
param(
    [switch]$DryRun
)

$ErrorActionPreference = "Continue"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RepoRoot = (Resolve-Path "$ScriptDir\..").Path
Set-Location $RepoRoot
$LogDir = Join-Path $RepoRoot "logs"

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogFile = Join-Path $LogDir "KB-Sync-Ops-$Timestamp.log"
$StartTime = Get-Date

function Write-LogInfo($Message) {
    $msg = "[KB-SYNC-OPS] [INFO] $Message"
    Write-Host $msg -ForegroundColor Green
    $msg | Tee-Object -FilePath $LogFile -Append | Out-Null
}

function Write-LogError($Message) {
    $msg = "[KB-SYNC-OPS] [ERROR] $Message"
    Write-Host $msg -ForegroundColor Red
    $msg | Tee-Object -FilePath $LogFile -Append | Out-Null
}

Write-LogInfo "Starting KB Sync Operations Pipeline (Clusters C, D, E)..."
Write-LogInfo "Repo Root: $RepoRoot"

$RunnerScript = Join-Path $RepoRoot "scripts\pipeline\cluster-sync-runner.mjs"
$ArgsList = @("$RunnerScript", "--mode=ops")
if ($DryRun) {
    $ArgsList += "--dry-run"
}

try {
    Write-LogInfo "Invoking: node $($ArgsList -join ' ')"
    & node.exe $ArgsList 2>&1 | Tee-Object -FilePath $LogFile -Append
    $exitCode = $LASTEXITCODE
    if ($exitCode -eq 0) {
        Write-LogInfo "Operations pipeline completed successfully in $([math]::Round(((Get-Date) - $StartTime).TotalMinutes, 2)) min."
        exit 0
    } else {
        Write-LogError "Operations pipeline failed with exit code $exitCode."
        exit $exitCode
    }
} catch {
    Write-LogError "Fatal exception executing operations pipeline: $_"
    exit 1
}
