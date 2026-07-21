# ==============================================================================
# KB-Sync Scheduled Tasks Setup
# Registers Windows Task Scheduler jobs for kb-sync pipeline automation
# ==============================================================================

# Requires: PowerShell 5.0+, Run as Administrator
# Purpose: Schedule staging, validation, and synthesis tasks to avoid bash constraints

param(
    [switch]$Uninstall,
    [switch]$List,
    [string]$ScheduleTime = "00:30"  # Default: 12:30 AM UTC
)

$ErrorActionPreference = "Stop"
$RepoRoot = "C:\dev\kb-sync"
$TaskPrefix = "KB-Sync"
$TaskUser = "SYSTEM"

# ==============================================================================
# TASK DEFINITIONS
# ==============================================================================

$Tasks = @(
    @{
        Name        = "$TaskPrefix-Stage-Sources"
        Description = "Stage raw sources for Obsidian wiki ingest (immutable, timestamped)"
        Schedule    = "00:30"
        Script      = "npm run kb:sync:obsidian"
        WorkDir     = $RepoRoot
        Priority    = "High"
        RunLevel    = "Limited"
    },
    @{
        Name        = "$TaskPrefix-Validate-Staging"
        Description = "Validate staged sources and check for errors"
        Schedule    = "00:35"  # 5 min after staging
        Script      = "npm run wiki:validate-staging"
        WorkDir     = $RepoRoot
        Priority    = "Normal"
        RunLevel    = "Limited"
    },
    @{
        Name        = "$TaskPrefix-Generate-Prompt"
        Description = "Generate Claude Code ingest prompt from staged sources"
        Schedule    = "00:40"  # 10 min after validation
        Script      = "npm run wiki:ingest:obsidian:prompt"
        WorkDir     = $RepoRoot
        Priority    = "Normal"
        RunLevel    = "Limited"
    },
    @{
        Name        = "$TaskPrefix-Consolidate-Pack"
        Description = "Generate knowledge pack from staged sources"
        Schedule    = "01:00"  # 30 min after staging (allow time for synthesis)
        Script      = "npm run kb:sync:notebooklm"
        WorkDir     = $RepoRoot
        Priority    = "Normal"
        RunLevel    = "Limited"
    },
    @{
        Name        = "$TaskPrefix-Cleanup-Archives"
        Description = "Clean up old staging archives (retention policy)"
        Schedule    = "02:00"  # 1.5 hours after start
        Script      = "npm run wiki:cleanup-archives"
        WorkDir     = $RepoRoot
        Priority    = "Low"
        RunLevel    = "Limited"
    }
)

# ==============================================================================
# FUNCTIONS
# ==============================================================================

function Create-ScheduledTask {
    param(
        [hashtable]$Task
    )

    $TaskName = $Task.Name
    $ScriptPath = Join-Path $Task.WorkDir -ChildPath "schedule-task-wrapper.ps1"

    # Create wrapper script that logs output and handles errors
    $WrapperContent = @"
# Auto-generated wrapper for $TaskName
`$ErrorActionPreference = "Continue"
`$DebugPreference = "Continue"

`$LogDir = "$RepoRoot\logs"
if (-not (Test-Path `$LogDir)) { mkdir `$LogDir | Out-Null }

`$LogFile = Join-Path `$LogDir "$($Task.Name)-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
`$StartTime = Get-Date

"`n=== $($Task.Name) ===" | Tee-Object -FilePath `$LogFile -Append
"Started: `$StartTime" | Tee-Object -FilePath `$LogFile -Append
"Working Directory: $($Task.WorkDir)" | Tee-Object -FilePath `$LogFile -Append

try {
    Set-Location "$($Task.WorkDir)"
    & cmd /c "$($Task.Script)" 2>&1 | Tee-Object -FilePath `$LogFile -Append
    `$ExitCode = `$LASTEXITCODE
} catch {
    "ERROR: `$_" | Tee-Object -FilePath `$LogFile -Append
    `$ExitCode = 1
}

`$EndTime = Get-Date
`$Duration = (`$EndTime - `$StartTime).TotalSeconds
"Completed: `$EndTime (Duration: {0:F2}s, Exit Code: {1})" -f `$Duration, `$ExitCode | Tee-Object -FilePath `$LogFile -Append

exit `$ExitCode
"@

    # Write wrapper script
    $WrapperPath = Join-Path $RepoRoot "schedule-task-wrapper-$($Task.Name).ps1"
    Set-Content -Path $WrapperPath -Value $WrapperContent -Force

    # Create scheduled task
    $TaskExists = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

    if ($TaskExists) {
        Write-Host "Updating existing task: $TaskName"
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    }

    $Action = New-ScheduledTaskAction `
        -Execute "powershell.exe" `
        -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$WrapperPath`""

    $Trigger = New-ScheduledTaskTrigger `
        -Daily `
        -At $Task.Schedule

    $Settings = New-ScheduledTaskSettingsSet `
        -MultipleInstances IgnoreNew `
        -StartWhenAvailable `
        -DontStopIfGoingOnBatteries

    $Principal = New-ScheduledTaskPrincipal `
        -UserId "SYSTEM" `
        -LogonType ServiceAccount `
        -RunLevel Highest

    $Params = @{
        TaskName    = $TaskName
        Action      = $Action
        Trigger     = $Trigger
        Settings    = $Settings
        Principal   = $Principal
        Description = $Task.Description
        Force       = $true
    }

    $RegisteredTask = Register-ScheduledTask @Params
    Write-Host "✓ Registered: $TaskName (Daily @ $($Task.Schedule))"

    return $RegisteredTask
}

function List-ScheduledTasks {
    Write-Host "`n=== KB-Sync Scheduled Tasks ===" -ForegroundColor Green

    foreach ($Task in $Tasks) {
        $Existing = Get-ScheduledTask -TaskName $Task.Name -ErrorAction SilentlyContinue

        if ($Existing) {
            $NextRun = $Existing.Triggers[0].StartBoundary
            Write-Host "`n✓ $($Task.Name)"
            Write-Host "  Schedule: $($Task.Schedule) UTC"
            Write-Host "  Description: $($Task.Description)"
            Write-Host "  Status: $($Existing.State)"
            Write-Host "  Next Run: $NextRun"
        } else {
            Write-Host "`n✗ $($Task.Name) — NOT INSTALLED"
        }
    }
}

function Remove-AllScheduledTasks {
    Write-Host "Uninstalling KB-Sync scheduled tasks..." -ForegroundColor Yellow

    foreach ($Task in $Tasks) {
        $Existing = Get-ScheduledTask -TaskName $Task.Name -ErrorAction SilentlyContinue

        if ($Existing) {
            Unregister-ScheduledTask -TaskName $Task.Name -Confirm:$false
            Write-Host "✓ Removed: $($Task.Name)"
        }
    }

    Write-Host "All tasks removed." -ForegroundColor Green
}

# ==============================================================================
# MAIN
# ==============================================================================

# Verify repo exists
if (-not (Test-Path $RepoRoot)) {
    Write-Error "Repo root not found: $RepoRoot"
    exit 1
}

if ($List) {
    List-ScheduledTasks
    exit 0
}

if ($Uninstall) {
    Remove-AllScheduledTasks
    exit 0
}

# Create tasks
Write-Host "Installing KB-Sync scheduled tasks..." -ForegroundColor Green
Write-Host "Repo: $RepoRoot"
Write-Host "User: $TaskUser`n"

foreach ($Task in $Tasks) {
    Create-ScheduledTask -Task $Task
}

Write-Host "`n✓ All tasks installed successfully!" -ForegroundColor Green
Write-Host "View logs: $RepoRoot\logs\`n"

# List installed tasks
List-ScheduledTasks
