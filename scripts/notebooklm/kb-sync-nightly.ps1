# ==============================================================================
# KB Sync Nightly Orchestrator — Native Windows (PowerShell)
# Stage 1: Sync CIC/Rewrite docs to NotebookLM knowledge base
# Stage 2: Generate interactive artifact report with impact scoring
# ==============================================================================
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RepoRoot = (Resolve-Path "$ScriptDir\..\..").Path

function Write-LogInfo($Message) {
    Write-Host "[KB-SYNC-NIGHTLY] [INFO] $Message" -ForegroundColor Green
}

function Write-LogError($Message) {
    Write-Host "[KB-SYNC-NIGHTLY] [ERROR] $Message" -ForegroundColor Red
}

function Write-LogWarn($Message) {
    Write-Host "[KB-SYNC-NIGHTLY] [WARN] $Message" -ForegroundColor Yellow
}

Write-LogInfo "Initializing Native KB Sync Nightly Pipeline..."
Write-LogInfo "REPO_ROOT: $RepoRoot"

$Stage1Script = Join-Path $RepoRoot "modules\notebooklm\ingest-notebooklm.sh"
$Stage2Script = Join-Path $RepoRoot "scripts\notebooklm\generate-kb-sync-artifact.mjs"

# Find bash executable (prefer Git Bash over WSL)
$BashPath = Get-Command "bash.exe" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
if (-not $BashPath -and (Test-Path "C:\Program Files\Git\bin\bash.exe")) {
    $BashPath = "C:\Program Files\Git\bin\bash.exe"
}

if (-not $BashPath) {
    Write-LogError "bash executable not found. Please install Git for Windows."
    exit 1
}

# Pre-flight Auth Refresh Check (Fail-soft)
$NlmCli = Get-Command "notebooklm.exe" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
if (-not $NlmCli) {
    $NlmCli = Get-Command "notebooklm" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
}

if ($NlmCli) {
    Write-LogInfo "Running pre-flight authentication check..."
    & $NlmCli --quiet auth check >$null 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-LogWarn "Pre-flight auth check failed; attempting master token session refresh..."
        & $NlmCli login --master-token-refresh --quiet 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-LogInfo "Pre-flight master token session refresh succeeded."
        } else {
            Write-LogWarn "Pre-flight master token refresh failed/skipped. Proceeding to Stage 1 for fallback auth recovery."
        }
    } else {
        Write-LogInfo "Pre-flight auth check passed."
    }
}

# --- STAGE 1: SYNC TO NOTEBOOKLM ---
Write-LogInfo "================================================================================"
Write-LogInfo "STAGE 1: Syncing CIC & Rewrite Labs docs to NotebookLM"
Write-LogInfo "================================================================================"

Set-Location $RepoRoot
& $BashPath "modules/notebooklm/ingest-notebooklm.sh"
$Stage1ExitCode = $LASTEXITCODE

if ($Stage1ExitCode -eq 0) {
    Write-LogInfo "Stage 1 completed successfully."
} else {
    Write-LogError "Stage 1 failed with exit code $Stage1ExitCode. Aborting pipeline."
    exit 1
}

# --- STAGE 2: GENERATE ARTIFACT ---
Write-Host ""
Write-LogInfo "================================================================================"
Write-LogInfo "STAGE 2: Generating interactive KB sync artifact"
Write-LogInfo "================================================================================"

$NodeCmd = Get-Command "node.exe" -ErrorAction SilentlyContinue
if ($NodeCmd) {
    try {
        & node "$Stage2Script"
        if ($LASTEXITCODE -eq 0) {
            Write-LogInfo "Stage 2 completed successfully."
            Write-LogInfo "Artifact output: $RepoRoot\_integration\kb-sync-interactive-report.html"
        } else {
            Write-LogWarn "Stage 2 failed, but Stage 1 succeeded. Sync completed."
        }
    } catch {
        Write-LogWarn "Stage 2 encountered an exception: $_"
    }
} else {
    Write-LogWarn "node.exe not found in PATH. Stage 2 skipped."
}

Write-Host ""
Write-LogInfo "================================================================================"
Write-LogInfo "KB Sync Nightly Pipeline Completed"
Write-LogInfo "================================================================================"
exit 0
