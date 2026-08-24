# ==============================================================================
# KB Sync Scheduled Task Migration & Consolidation
# Removes old fragmented tasks under \KB-SYNC\ and registers single 8:00 PM master task
# ==============================================================================
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RepoRoot = (Resolve-Path "$ScriptDir\..").Path

$MasterScript = Join-Path $RepoRoot "scripts\schedule-task-wrapper-KB-Sync-Master.ps1"
$TaskPath = "\KB-SYNC\"
$MasterTaskName = "KB-Sync-Master-Pipeline"

if (-not (Test-Path $MasterScript)) {
    Write-Host "[ERROR] Master script not found: $MasterScript" -ForegroundColor Red
    exit 1
}

# List of old legacy/fragmented tasks to clean up
$LegacyTasks = @(
    "KB-Sync-Cleanup-Archives",
    "KB-Sync-Consolidate-Pack",
    "KB-Sync-Daily",
    "KB-Sync-Generate-Prompt",
    "KB-Sync-Nightly-NotebookLM",
    "KB-Sync-Nightly-Obsidian",
    "KB-Sync-Stage-Sources",
    "KB-Sync-Validate-Staging"
)

Write-Host "KB Sync Schedule Consolidation to 8:00 PM" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""

# Unregister legacy tasks
foreach ($legacy in $LegacyTasks) {
    $existing = Get-ScheduledTask -TaskName $legacy -TaskPath $TaskPath -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "Unregistering legacy task: $legacy..." -ForegroundColor Yellow
        Unregister-ScheduledTask -TaskName $legacy -TaskPath $TaskPath -Confirm:$false | Out-Null
    }
}

# Check if master task already exists
$existingMaster = Get-ScheduledTask -TaskName $MasterTaskName -TaskPath $TaskPath -ErrorAction SilentlyContinue
if ($existingMaster) {
    Write-Host "Unregistering existing master task for fresh setup..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $MasterTaskName -TaskPath $TaskPath -Confirm:$false | Out-Null
}

# Principal
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$principal = if ($isAdmin) {
    New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
} else {
    New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
}

# Action
$action = New-ScheduledTaskAction `
    -Execute "pwsh.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$MasterScript`"" `
    -WorkingDirectory "$RepoRoot"

# Trigger: Daily at 8:00 PM (20:00)
$trigger = New-ScheduledTaskTrigger `
    -Daily `
    -At "20:00"

# Settings
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -MultipleInstances IgnoreNew

Write-Host "Registering consolidated Master Task: $MasterTaskName" -ForegroundColor Cyan
Write-Host "  Path:     $TaskPath" -ForegroundColor Gray
Write-Host "  Schedule: Daily at 8:00 PM (20:00)" -ForegroundColor Gray
Write-Host "  Script:   $MasterScript" -ForegroundColor Gray

try {
    Register-ScheduledTask `
        -TaskName $MasterTaskName `
        -TaskPath $TaskPath `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal `
        -Description "Master KB Sync Pipeline executing staging, validation, NotebookLM ingestion, drift audit, and log cleanup" `
        -Force | Out-Null

    Write-Host ""
    Write-Host "[OK] Schedule consolidation complete. Master pipeline registered for 8:00 PM." -ForegroundColor Green
    Write-Host ""
} catch {
    Write-Host "[ERROR] Failed to register master task: $_" -ForegroundColor Red
    exit 1
}
