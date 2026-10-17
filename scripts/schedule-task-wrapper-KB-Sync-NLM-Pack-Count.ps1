# ==============================================================================
# KB Sync NotebookLM Pack-Count Check Wrapper
# Verifies NotebookLM thematic knowledge pack invariants across all active swept notebooks
# Scheduled for 03:45 AM and 20:45 (8:45 PM) EDT daily.
# ==============================================================================
[CmdletBinding()]
param(
    [string]$OutPath
)

$ErrorActionPreference = "Continue"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RepoRoot = (Resolve-Path "$ScriptDir\..").Path
$LogDir = Join-Path $RepoRoot "logs"

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogFile = Join-Path $LogDir "KB-Sync-NLM-Pack-Count-$Timestamp.log"
$StartTime = Get-Date

function Write-LogInfo($Message) {
    $msg = "[NLM-PACK-COUNT] [INFO] $Message"
    Write-Host $msg -ForegroundColor Green
    $msg | Tee-Object -FilePath $LogFile -Append | Out-Null
}

function Write-LogWarn($Message) {
    $msg = "[NLM-PACK-COUNT] [WARN] $Message"
    Write-Host $msg -ForegroundColor Yellow
    $msg | Tee-Object -FilePath $LogFile -Append | Out-Null
}

function Write-LogError($Message) {
    $msg = "[NLM-PACK-COUNT] [ERROR] $Message"
    Write-Host $msg -ForegroundColor Red
    $msg | Tee-Object -FilePath $LogFile -Append | Out-Null
}

Write-LogInfo "Starting NotebookLM Pack-Count Invariant Verification..."
Write-LogInfo "Repo Root: $RepoRoot"

$CheckScript = Join-Path $RepoRoot "scripts\nlm-pack-count-check.mjs"
$ArgsList = @("$CheckScript")
if ($OutPath) {
    $ArgsList += @("--out", "$OutPath")
}

$OverallStatus = 0

try {
    Write-LogInfo "Invoking: node $($ArgsList -join ' ')"
    & node.exe $ArgsList 2>&1 | Tee-Object -FilePath $LogFile -Append
    $OverallStatus = $LASTEXITCODE

    $Duration = [math]::Round(((Get-Date) - $StartTime).TotalSeconds, 2)

    if ($OverallStatus -eq 0) {
        Write-LogInfo "Pack-count check finished GREEN in ${Duration}s. Invariants satisfied."
    } elseif ($OverallStatus -eq 2) {
        Write-LogError "Pack-count check finished RED in ${Duration}s. Invariant violation detected."
    } elseif ($OverallStatus -eq 3) {
        Write-LogWarn "Pack-count check finished UNKNOWN in ${Duration}s (auth expired or CLI unavailable)."
    } else {
        Write-LogError "Pack-count check finished with unexpected exit code: $OverallStatus."
    }
} catch {
    Write-LogError "Fatal exception executing pack-count check: $_"
    $OverallStatus = 1
}

$AlertDispatcher = "C:\dev\scripts\send-critical-alert.ps1"
if (Test-Path $AlertDispatcher) {
    if ($OverallStatus -eq 2) {
        & pwsh -NoProfile -File $AlertDispatcher -Source "KB-Sync-NLM-Pack-Count" `
            -Title "🚨 NotebookLM Pack Invariant Violation (RED)" `
            -Message "NotebookLM pack-count check detected invariant violations across active knowledge plane notebooks. Check _status-feed/nlm_pack_counts.json." `
            -Severity "CRITICAL" `
            -ActionRequired "Inspect findings in _status-feed/nlm_pack_counts.json and log: $LogFile" `
            -LogFile $LogFile
    } elseif ($OverallStatus -eq 3) {
        & pwsh -NoProfile -File $AlertDispatcher -Source "KB-Sync-NLM-Pack-Count" `
            -Title "⚠️ NotebookLM Auth Expired / CLI Missing (UNKNOWN)" `
            -Message "NotebookLM pack-count check encountered auth expiration or missing CLI. Invariant status is UNKNOWN." `
            -Severity "WARNING" `
            -ActionRequired "Refresh NotebookLM CLI session and inspect log: $LogFile" `
            -LogFile $LogFile
    } elseif ($OverallStatus -eq 0) {
        & pwsh -NoProfile -File $AlertDispatcher -Source "KB-Sync-NLM-Pack-Count" -ClearAlert
    }
}

exit $OverallStatus
