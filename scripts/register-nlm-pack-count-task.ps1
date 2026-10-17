# ==============================================================================
# KB Sync NotebookLM Pack-Count Scheduled Task Registration
# Registers KB-Sync-NLM-Pack-Count under \KB-SYNC\ running at 03:45 AM and 20:45 (8:45 PM) daily
# ==============================================================================
[CmdletBinding()]
param(
    [switch]$Uninstall,
    [switch]$List,
    [string]$RepoRoot = 'C:\dev\kb-sync',
    [string]$TaskName = 'KB-Sync-NLM-Pack-Count',
    [string]$TaskPath = '\KB-SYNC\'
)

$ErrorActionPreference = 'Stop'
$ScriptPath = Join-Path $RepoRoot 'scripts\schedule-task-wrapper-KB-Sync-NLM-Pack-Count.ps1'

if (-not (Test-Path -LiteralPath $ScriptPath)) {
    throw "Wrapper script not found: $ScriptPath"
}

if ($List) {
    Get-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction SilentlyContinue |
        Format-List TaskName, TaskPath, State, Author, Description, Triggers
    exit 0
}

if ($Uninstall) {
    $existing = Get-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -Confirm:$false
        Write-Output "Removed scheduled task: $TaskPath$TaskName"
    } else {
        Write-Output "Task not found: $TaskPath$TaskName"
    }
    exit 0
}

$pwshCmd = Get-Command pwsh.exe -ErrorAction SilentlyContinue
$PwshPath = if ($pwshCmd) { $pwshCmd.Source } else { 'powershell.exe' }

$action = New-ScheduledTaskAction `
    -Execute $PwshPath `
    -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$ScriptPath`"" `
    -WorkingDirectory "$RepoRoot"

$triggers = @(
    (New-ScheduledTaskTrigger -Daily -At "03:45"),
    (New-ScheduledTaskTrigger -Daily -At "20:45")
)

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -MultipleInstances IgnoreNew

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$principal = if ($isAdmin) {
    New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Highest
} else {
    New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
}

# Unregister any existing instance to ensure clean registration
$existing = Get-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -Confirm:$false | Out-Null
}

Register-ScheduledTask `
    -TaskName $TaskName `
    -TaskPath $TaskPath `
    -Action $action `
    -Trigger $triggers `
    -Settings $settings `
    -Principal $principal `
    -Description 'Zero-token NotebookLM pack invariant auditor. Runs daily at 03:45 AM and 20:45 (8:45 PM) post-mining and post-master sync.' `
    -Force | Out-Null

Write-Output "Registered scheduled task: $TaskPath$TaskName"
