# ==============================================================================
# KB Sync Master Pipeline Orchestrator
# Runs all staging, validation, NotebookLM ingestion, drift audit, and cleanup
# sequentially in strict dependency order at 8:00 PM daily.
# ==============================================================================
[CmdletBinding()]
param()

$ErrorActionPreference = "Continue"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RepoRoot = (Resolve-Path "$ScriptDir\..").Path
$LogDir = Join-Path $RepoRoot "logs"

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogFile = Join-Path $LogDir "KB-Sync-Master-Pipeline-$Timestamp.log"
$StartTime = Get-Date

function Write-LogInfo($Message) {
    $msg = "[KB-SYNC-MASTER] [INFO] $Message"
    Write-Host $msg -ForegroundColor Green
    $msg | Tee-Object -FilePath $LogFile -Append | Out-Null
}

function Write-LogWarn($Message) {
    $msg = "[KB-SYNC-MASTER] [WARN] $Message"
    Write-Host $msg -ForegroundColor Yellow
    $msg | Tee-Object -FilePath $LogFile -Append | Out-Null
}

function Write-LogError($Message) {
    $msg = "[KB-SYNC-MASTER] [ERROR] $Message"
    Write-Host $msg -ForegroundColor Red
    $msg | Tee-Object -FilePath $LogFile -Append | Out-Null
}

Write-LogInfo "Starting KB Sync Master Pipeline..."
Write-LogInfo "Repo Root: $RepoRoot"
Set-Location $RepoRoot

$OverallStatus = 0

# Use the same auth wrapper and CLI dialect as the NotebookLM ingest stage.
Write-LogInfo "Running pre-flight authentication check..."
& cmd /c "npm run kb:sync:notebooklm -- --check-auth-only" 2>&1 | Tee-Object -FilePath $LogFile -Append | Out-Null
$AuthCheckExitCode = $LASTEXITCODE
if ($AuthCheckExitCode -eq 0) {
    Write-LogInfo "Pre-flight auth check passed."
} else {
    Write-LogWarn "Pre-flight auth check requires recovery; Stage 3 will run the same recovery path."
}

# --- STAGE 1: OBSIDIAN STAGING & VALIDATION ---
Write-LogInfo "================================================================================"
Write-LogInfo "STAGE 1: Obsidian Staging & Validation"
Write-LogInfo "================================================================================"

try {
    Write-LogInfo "Staging Obsidian sources..."
    & cmd /c "npm run kb:sync:obsidian" 2>&1 | Tee-Object -FilePath $LogFile -Append | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-LogError "Obsidian staging failed with exit code $LASTEXITCODE"
        $OverallStatus = 1
    }

    Write-LogInfo "Validating staging documentation..."
    & cmd /c "npm run wiki:validate-staging -- --json=./.validation-report.json" 2>&1 | Tee-Object -FilePath $LogFile -Append | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-LogError "Staging validation failed with exit code $LASTEXITCODE"
        $OverallStatus = 1
    }
} catch {
    Write-LogError "Stage 1 encountered error: $_"
    $OverallStatus = 1
}

# --- STAGE 2: WIKI METADATA & FRONTMATTER ---
Write-LogInfo "================================================================================"
Write-LogInfo "STAGE 2: Wiki Metadata & Frontmatter"
Write-LogInfo "================================================================================"

try {
    Write-LogInfo "Auto-filling frontmatter metadata..."
    & cmd /c "npm run wiki:autofill-frontmatter" 2>&1 | Tee-Object -FilePath $LogFile -Append | Out-Null
} catch {
    Write-LogWarn "Stage 2 frontmatter auto-fill encountered warning: $_"
}

# --- STAGE 3: NOTEBOOKLM INGESTION & ARTIFACT REPORT ---
Write-LogInfo "================================================================================"
Write-LogInfo "STAGE 3: NotebookLM Ingestion & Telemetry Report"
Write-LogInfo "================================================================================"

try {
    $NightlyScript = Join-Path $RepoRoot "scripts\notebooklm\kb-sync-nightly.ps1"
    if (Test-Path $NightlyScript) {
        Write-LogInfo "Executing NotebookLM Nightly pipeline..."
        & pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "$NightlyScript" 2>&1 | Tee-Object -FilePath $LogFile -Append | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-LogError "NotebookLM Nightly pipeline exited with code $LASTEXITCODE"
            $OverallStatus = 1
        }
    } else {
        Write-LogError "Nightly script not found at $NightlyScript"
        $OverallStatus = 1
    }
} catch {
    Write-LogError "Stage 3 NotebookLM pipeline failed: $_"
    $OverallStatus = 1
}

# --- STAGE 4: DRIFT & FRESHNESS AUDIT ---
Write-LogInfo "================================================================================"
Write-LogInfo "STAGE 4: Drift & Freshness Audit"
Write-LogInfo "================================================================================"

try {
    Write-LogInfo "Running drift detection audit..."
    & cmd /c "npm run kb:drift" 2>&1 | Tee-Object -FilePath $LogFile -Append | Out-Null
} catch {
    Write-LogWarn "Stage 4 drift detection encountered error: $_"
}

# --- STAGE 5: TRM GAP TRIAGE & SYNTHESIS ---
Write-LogInfo "================================================================================"
Write-LogInfo "STAGE 5: TRM Gap Triage & Synthesis"
Write-LogInfo "================================================================================"

try {
    Write-LogInfo "Running automated TRM gap triage with cognitive query expansion..."
    & cmd /c "npm run trm:triage -- --provider=auto" 2>&1 | Tee-Object -FilePath $LogFile -Append | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-LogWarn "TRM gap triage finished with exit code $LASTEXITCODE"
    } else {
        Write-LogInfo "TRM gap triage completed successfully."
    }
} catch {
    Write-LogWarn "Stage 5 TRM gap triage encountered warning: $_"
}

# --- STAGE 6: ARCHIVE & LOG CLEANUP ---
Write-LogInfo "================================================================================"
Write-LogInfo "STAGE 6: Archive & Log Cleanup"
Write-LogInfo "================================================================================"

try {
    Write-LogInfo "Cleaning up staging archives..."
    & cmd /c "npm run wiki:cleanup-archives" 2>&1 | Tee-Object -FilePath $LogFile -Append | Out-Null

    Write-LogInfo "Cleaning up old log files..."
    & cmd /c "npm run logs:cleanup" 2>&1 | Tee-Object -FilePath $LogFile -Append | Out-Null
} catch {
    Write-LogWarn "Stage 6 cleanup encountered warning: $_"
}

$EndTime = Get-Date
$Duration = ($EndTime - $StartTime).TotalSeconds
Write-LogInfo "================================================================================"
Write-LogInfo ("KB Sync Master Pipeline Finished (Duration: {0:F2}s, Status Code: {1})" -f $Duration, $OverallStatus)
Write-LogInfo "================================================================================"

exit $OverallStatus
