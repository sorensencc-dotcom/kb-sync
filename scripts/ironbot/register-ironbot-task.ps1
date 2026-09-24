[CmdletBinding()]
param()

$ScriptPath = (Resolve-Path "$PSScriptRoot\ironbot-task-monitor.ps1").Path
$WorkDir    = (Resolve-Path "$PSScriptRoot\..\..").Path
$TaskName   = "IronBot-TaskMonitor"
$TaskPath   = "\IronBot\"

# Once-type trigger with 4h repetition is the only variant that supports RepetitionInterval
$Trigger = New-ScheduledTaskTrigger -Once -At "00:00" `
    -RepetitionInterval (New-TimeSpan -Hours 4) `
    -RepetitionDuration (New-TimeSpan -Days 3650)

$Action   = New-ScheduledTaskAction -Execute "pwsh.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`"" `
    -WorkingDirectory $WorkDir

$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Warning "[IronBot] Not running as Administrator. Registering scheduled tasks with S4U/Highest requires an elevated PowerShell terminal."
    Write-Warning "[IronBot] To complete registration, open PowerShell as Administrator and run: pwsh -NoProfile -ExecutionPolicy Bypass -File `"$PSScriptRoot\register-ironbot-task.ps1`""
    try {
        # Attempt standard user registration
        $Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
        Register-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Force | Out-Null
        Write-Host "[IronBot] Registered $TaskPath$TaskName (Interactive mode)"
    } catch {
        Write-Warning "[IronBot] Could not register task without elevation: $_"
    }
} else {
    $Principal = New-ScheduledTaskPrincipal `
        -UserId "$env:USERDOMAIN\$env:USERNAME" `
        -LogonType S4U `
        -RunLevel Highest

    Register-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath `
        -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Force |
        Out-Null
    Write-Host "[IronBot] Registered $TaskPath$TaskName (S4U Unattended mode)"
}

