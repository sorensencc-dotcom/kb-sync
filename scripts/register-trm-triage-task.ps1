# ==============================================================================
# TRM Gap Triage Scheduled Task Registration
# Registers Windows Task Scheduler job for daily TRM gap triage automation
# ==============================================================================
[CmdletBinding()]
param(
    [string]$TaskName = "KB-Sync-TRM-Triage",
    [string]$ScheduleTime = "20:30",  # Default: 8:30 PM (after master pipeline)
    [string]$TaskPath = "\KB-SYNC\",
    [switch]$Uninstall,
    [switch]$List
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RepoRoot = (Resolve-Path "$ScriptDir\..").Path
$WrapperScript = Join-Path $RepoRoot "scripts\schedule-task-wrapper-TRM-Triage.ps1"

if ($List) {
    $existing = Get-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "Task '$TaskName' is registered at $TaskPath." -ForegroundColor Green
        Write-Host "  State:    $($existing.State)"
        Write-Host "  Schedule: $($existing.Triggers[0].StartBoundary)"
    } else {
        Write-Host "Task '$TaskName' is NOT registered." -ForegroundColor Yellow
    }
    exit 0
}

if ($Uninstall) {
    $existing = Get-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "Unregistering task '$TaskName'..." -ForegroundColor Yellow
        Unregister-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -Confirm:$false | Out-Null
        Write-Host "Task removed." -ForegroundColor Green
    } else {
        Write-Host "Task '$TaskName' was not registered." -ForegroundColor Yellow
    }
    exit 0
}

if (-not (Test-Path $WrapperScript)) {
    Write-Host "[ERROR] Wrapper script not found: $WrapperScript" -ForegroundColor Red
    exit 1
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
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$WrapperScript`"" `
    -WorkingDirectory "$RepoRoot"

# Trigger: Daily
$trigger = New-ScheduledTaskTrigger `
    -Daily `
    -At $ScheduleTime

# Settings
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -MultipleInstances IgnoreNew

Write-Host "Registering TRM Gap Triage Task: $TaskName" -ForegroundColor Cyan
Write-Host "  Path:     $TaskPath" -ForegroundColor Gray
Write-Host "  Schedule: Daily at $ScheduleTime" -ForegroundColor Gray
Write-Host "  Script:   $WrapperScript" -ForegroundColor Gray

try {
    Register-ScheduledTask `
        -TaskName $TaskName `
        -TaskPath $TaskPath `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal `
        -Description "Daily automated TRM Gap Triage against local SQLite context cache with cognitive query expansion" `
        -Force | Out-Null

    Write-Host ""
    Write-Host "[OK] TRM Gap Triage task successfully registered for $ScheduleTime daily." -ForegroundColor Green
    Write-Host ""
} catch {
    Write-Host "[ERROR] Failed to register task: $_" -ForegroundColor Red
    exit 1
}
