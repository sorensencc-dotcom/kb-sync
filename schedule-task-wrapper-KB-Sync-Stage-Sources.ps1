# Auto-generated wrapper for KB-Sync-Stage-Sources
$ErrorActionPreference = "Continue"
$DebugPreference = "Continue"

$LogDir = "C:\dev\kb-sync\logs"
if (-not (Test-Path $LogDir)) { mkdir $LogDir | Out-Null }

$LogFile = Join-Path $LogDir "KB-Sync-Stage-Sources-20260720-232320.log"
$StartTime = Get-Date

"
=== KB-Sync-Stage-Sources ===" | Tee-Object -FilePath $LogFile -Append
"Started: $StartTime" | Tee-Object -FilePath $LogFile -Append
"Working Directory: C:\dev\kb-sync" | Tee-Object -FilePath $LogFile -Append

try {
    Set-Location "C:\dev\kb-sync"
    & cmd /c "npm run kb:sync:obsidian" 2>&1 | Tee-Object -FilePath $LogFile -Append
    $ExitCode = $LASTEXITCODE
} catch {
    "ERROR: $_" | Tee-Object -FilePath $LogFile -Append
    $ExitCode = 1
}

$EndTime = Get-Date
$Duration = ($EndTime - $StartTime).TotalSeconds
"Completed: $EndTime (Duration: {0:F2}s, Exit Code: {1})" -f $Duration, $ExitCode | Tee-Object -FilePath $LogFile -Append

exit $ExitCode
