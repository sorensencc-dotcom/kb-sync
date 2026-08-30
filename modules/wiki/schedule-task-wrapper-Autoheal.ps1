[CmdletBinding()]
param(
    [ValidateSet('Register', 'Unregister', 'Status', 'Test')]
    [string]$Action = 'Status',

    [string]$RepositoryPath = 'C:\dev\dev-sandbox\autoheal-wrapper',
    [string]$VaultRoot = 'C:\dev\dev-sandbox\autoheal-wrapper\vault',
    [string]$NodePath = 'node.exe',
    [string]$LogDirectory = 'C:\dev\dev-sandbox\autoheal-wrapper\logs\autoheal',
    [ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')]
    [string]$ScheduleTime = '02:00',
    [string]$TaskName = 'Autoheal Sweeper',
    [switch]$DryRun,
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path $RepositoryPath 'autoheal-sweeper.mjs'
$stdoutLog = Join-Path $LogDirectory 'autoheal.stdout.log'
$stderrLog = Join-Path $LogDirectory 'autoheal.stderr.log'

function Quote-Argument {
    param([string]$Value)

    if ($null -eq $Value) {
        return '""'
    }

    '"' + ($Value -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}

function Get-NodeArguments {
    $arguments = @(
        $scriptPath
        "--vault-root=$VaultRoot"
    )

    if ($DryRun) {
        $arguments += '--dry-run'
    }

    ($arguments | ForEach-Object { Quote-Argument $_ }) -join ' '
}

function Get-CommandLine {
    "$(Quote-Argument $NodePath) $(Get-NodeArguments)"
}

function New-AutohealTaskAction {
    $command = Get-CommandLine
    $workingDirectory = Quote-Argument $RepositoryPath
    $stdout = Quote-Argument $stdoutLog
    $stderr = Quote-Argument $stderrLog

    $commandScript = @"
Set-Location -LiteralPath $workingDirectory
& $command 1>> $stdout 2>> $stderr
"@

    New-ScheduledTaskAction `
        -Execute 'PowerShell.exe' `
        -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command $(Quote-Argument $commandScript)" `
        -WorkingDirectory $RepositoryPath
}

function New-AutohealTaskSettings {
    New-ScheduledTaskSettingsSet `
        -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
        -MultipleInstances IgnoreNew `
        -StartWhenAvailable
}

switch ($Action) {
    'Register' {
        if (-not (Test-Path -LiteralPath $RepositoryPath -PathType Container)) {
            throw "Repository path does not exist: $RepositoryPath"
        }

        if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
            throw "Autoheal sweeper does not exist: $scriptPath"
        }

        New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null

        $trigger = New-ScheduledTaskTrigger `
            -Daily `
            -At ([datetime]::ParseExact($ScheduleTime, 'HH:mm', $null))

        $task = New-ScheduledTask `
            -Action (New-AutohealTaskAction) `
            -Trigger $trigger `
            -Settings (New-AutohealTaskSettings) `
            -Description 'Run the repository autoheal sweeper.'

        Register-ScheduledTask `
            -TaskName $TaskName `
            -InputObject $task `
            -Force:$Force | Out-Null

        Write-Output "Registered scheduled task '$TaskName'."
    }

    'Unregister' {
        Unregister-ScheduledTask `
            -TaskName $TaskName `
            -Confirm:$false `
            -ErrorAction SilentlyContinue

        Write-Output "Scheduled task '$TaskName' is absent or removed."
    }

    'Status' {
        $task = Get-ScheduledTask `
            -TaskName $TaskName `
            -ErrorAction SilentlyContinue

        if ($null -eq $task) {
            Write-Output "Scheduled task '$TaskName' does not exist."
            break
        }

        $info = $task | Get-ScheduledTaskInfo

        Write-Output "Scheduled task '$TaskName' exists."
        Write-Output "State: $($task.State)"
        Write-Output "Last run: $($info.LastRunTime)"
        Write-Output "Next run: $($info.NextRunTime)"
        Write-Output "Action: $($task.Actions.Execute) $($task.Actions.Arguments)"
        Write-Output "Working directory: $($task.Actions.WorkingDirectory)"
        Write-Output "Multiple instances: $($task.Settings.MultipleInstances)"
        Write-Output "Execution time limit: $($task.Settings.ExecutionTimeLimit)"
    }

    'Test' {
        if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
            throw "Autoheal sweeper does not exist: $scriptPath"
        }

        New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null

        Write-Output "Testing: $(Get-CommandLine)"

        $arguments = @(
            $scriptPath
            "--vault-root=$VaultRoot"
        )

        if ($DryRun) {
            $arguments += '--dry-run'
        }

        & $NodePath @arguments

        if ($LASTEXITCODE -ne 0) {
            throw "Autoheal sweeper exited with code $LASTEXITCODE."
        }
    }
}
