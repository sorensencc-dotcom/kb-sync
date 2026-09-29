$ErrorActionPreference = "Stop"

$scriptPath = Join-Path (Get-Location) "scripts/schedule-task-wrapper-TRM-Triage.ps1"
if (!(Test-Path $scriptPath)) {
  throw "Scheduler wrapper missing: $scriptPath"
}

$content = Get-Content $scriptPath -Raw
foreach ($needle in @("DateTime]::UtcNow", "--mode active", "--mode weekly", "last_source_delta_utc")) {
  if ($content -notlike "*$needle*") {
    throw "Expected scheduler wrapper to contain '$needle'"
  }
}

Write-Output "scheduler wrapper static checks passed"
