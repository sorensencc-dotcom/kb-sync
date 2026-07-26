# ==============================================================================
# KB Sync Task Scheduler Registration with Pre-Flight Health Checks
# ==============================================================================
[CmdletBinding()]
param(
    [string]$TaskName = "KB-Sync-Daily",
    [string]$SyncTime = "03:00",
    [switch]$SkipAuthCheck
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path "$PSScriptRoot\..").Path

Write-Host "[TASK-REGISTER] [INFO] Running pre-flight health checks for $TaskName..." -ForegroundColor Green

# 1. Verify Node.exe
$NodeCmd = Get-Command "node.exe" -ErrorAction SilentlyContinue
if (-not $NodeCmd) {
    Write-Host "[TASK-REGISTER] [WARN] node.exe not found in PATH. Stage 2 artifact report will be skipped." -ForegroundColor Yellow
} else {
    Write-Host "[TASK-REGISTER] [INFO] Node.js version: $(node --version)" -ForegroundColor Green
}

# 2. Verify Git / WSL Bash
$BashCmd = Get-Command "bash.exe" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
if (-not $BashCmd) {
    $BashCmd = "bash"
}

if (-not $BashCmd) {
    Write-Host "[TASK-REGISTER] [ERROR] Git Bash (bash.exe) not found. Required for Stage 1 ingest." -ForegroundColor Red
    exit 1
} else {
    Write-Host "[TASK-REGISTER] [INFO] Git Bash located: $BashCmd" -ForegroundColor Green
}

# 3. Verify NotebookLM CLI Auth Status
if (-not $SkipAuthCheck) {
    $NlmCmd = Get-Command "notebooklm.exe" -ErrorAction SilentlyContinue
    if (-not $NlmCmd) {
        $NlmCmd = Get-Command "notebooklm" -ErrorAction SilentlyContinue
    }

    if ($NlmCmd) {
        Write-Host "[TASK-REGISTER] [INFO] Checking NotebookLM authentication status..." -ForegroundColor Green
        & $NlmCmd --quiet auth check >$null 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[TASK-REGISTER] [INFO] NotebookLM authentication verified." -ForegroundColor Green
        } else {
            Write-Host "[TASK-REGISTER] [WARN] NotebookLM auth check failed. Scheduled task will attempt headless refresh during execution." -ForegroundColor Yellow
        }
    } else {
        Write-Host "[TASK-REGISTER] [WARN] notebooklm.exe not found in PATH." -ForegroundColor Yellow
    }
}

# Register Scheduled Task
Write-Host "[TASK-REGISTER] [INFO] Registering Windows Scheduled Task '$TaskName' to run daily at $SyncTime..." -ForegroundColor Green
$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -Command `"Set-Location '$RepoRoot'; npm run kb:sync`""
$Trigger = New-ScheduledTaskTrigger -Daily -At $SyncTime
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -RunLevel Limited -Force | Out-Null

Write-Host "[TASK-REGISTER] [INFO] Scheduled Task '$TaskName' successfully registered!" -ForegroundColor Green
