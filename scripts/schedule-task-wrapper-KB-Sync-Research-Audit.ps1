# ==============================================================================
# KB Sync Research Audit Wrapper
# Evaluates completed research state before 07:00 AM ingestion
# Scheduled for 06:45 AM EDT daily.
# ==============================================================================
[CmdletBinding()]
param()

$ErrorActionPreference = "Continue"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RepoRoot = (Resolve-Path "$ScriptDir\..").Path
Set-Location $RepoRoot
$LogDir = Join-Path $RepoRoot "logs"

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogFile = Join-Path $LogDir "KB-Sync-Research-Audit-$Timestamp.log"
$StartTime = Get-Date

function Write-LogInfo($Message) {
    $msg = "[KB-SYNC-RESEARCH-AUDIT] [INFO] $Message"
    Write-Host $msg -ForegroundColor Green
    $msg | Tee-Object -FilePath $LogFile -Append | Out-Null
}

function Write-LogError($Message) {
    $msg = "[KB-SYNC-RESEARCH-AUDIT] [ERROR] $Message"
    Write-Host $msg -ForegroundColor Red
    $msg | Tee-Object -FilePath $LogFile -Append | Out-Null
}

Write-LogInfo "Starting KB Sync Research Audit (Evaluating Research State)..."
Write-LogInfo "Repo Root: $RepoRoot"

$OverallStatus = 0

# Check dynamic question battery verification
try {
    Write-LogInfo "Running dynamic question battery entropy checks..."
    & node --test tests/dynamic-question-battery.test.mjs 2>&1 | Tee-Object -FilePath $LogFile -Append
    if ($LASTEXITCODE -ne 0) {
        Write-LogError "Dynamic question battery audit failed with exit code $LASTEXITCODE"
        $OverallStatus = 1
    }
} catch {
    Write-LogError "Battery audit failed: $_"
    $OverallStatus = 1
}

# Verify clean state (no quarantined notebooks remaining)
try {
    Write-LogInfo "Verifying zero remaining quarantined notebooks..."
    & node scripts/pipeline/cluster-sync-runner.mjs --check-quarantine 2>&1 | Tee-Object -FilePath $LogFile -Append
    if ($LASTEXITCODE -ne 0) {
        Write-LogError "Quarantine check detected unrecovered notebooks (exit code $LASTEXITCODE)."
        $OverallStatus = 1
    }
} catch {
    Write-LogError "Quarantine audit failed: $_"
    $OverallStatus = 1
}

# Dry-run catchup preview (non-destructive)
try {
    Write-LogInfo "Running catchup dry-run preview..."
    & node scripts/pipeline/cluster-sync-runner.mjs --mode=catchup --dry-run 2>&1 | Tee-Object -FilePath $LogFile -Append
    if ($LASTEXITCODE -ne 0) {
        Write-LogError "Catchup dry-run preview failed with exit code $LASTEXITCODE."
        $OverallStatus = 1
    }
} catch {
    Write-LogError "Catchup dry-run preview failed: $_"
    $OverallStatus = 1
}

Write-LogInfo "Research audit finished in $([math]::Round(((Get-Date) - $StartTime).TotalMinutes, 2)) min with overall status: $OverallStatus."
exit $OverallStatus
