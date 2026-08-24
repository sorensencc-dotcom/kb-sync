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

function Send-WebhookNotification($Title, $Message, $Level = "ERROR") {
    $WebhookUrl = $env:WEBHOOK_URL
    if (-not $WebhookUrl -and (Test-Path "$RepoRoot\.env")) {
        $EnvContent = Get-Content "$RepoRoot\.env" -ErrorAction SilentlyContinue
        foreach ($Line in $EnvContent) {
            if ($Line -match '^\s*WEBHOOK_URL\s*=\s*["'']?(.*?)["'']?\s*$') {
                $WebhookUrl = $Matches[1]
                break
            }
        }
    }
    if ($WebhookUrl) {
        try {
            $Payload = @{ text = "*[KB-SYNC] [$Level] $Title*`n$Message" }
            $JsonBody = $Payload | ConvertTo-Json -Compress
            Invoke-RestMethod -Uri $WebhookUrl -Method Post -Body $JsonBody -ContentType "application/json" -TimeoutSec 10 | Out-Null
            Write-LogInfo "Webhook notification sent to $WebhookUrl"
        } catch {
            Write-LogWarn "Failed to send webhook notification: $_"
        }
    }
}

Write-LogInfo "Initializing Native KB Sync Nightly Pipeline..."
Write-LogInfo "REPO_ROOT: $RepoRoot"

$Stage1Script = Join-Path $RepoRoot "modules\notebooklm\ingest-notebooklm.sh"
$Stage2Script = Join-Path $RepoRoot "scripts\notebooklm\generate-kb-sync-artifact.mjs"

# Find bash executable (prioritize Git Bash over System32 WSL shim)
$GitBashCandidates = @(
    "C:\Program Files\Git\bin\bash.exe",
    "C:\Program Files\Git\usr\bin\bash.exe",
    "${env:ProgramFiles}\Git\bin\bash.exe",
    "${env:LOCALAPPDATA}\Programs\Git\bin\bash.exe"
)
$BashPath = $null
foreach ($cand in $GitBashCandidates) {
    if ($cand -and (Test-Path $cand)) {
        $BashPath = $cand
        break
    }
}
if (-not $BashPath) {
    $BashPath = Get-Command "bash.exe" -ErrorAction SilentlyContinue | Where-Object { $_.Source -notlike "*System32*" } | Select-Object -First 1 -ExpandProperty Source
}
if (-not $BashPath) {
    $BashPath = Get-Command "bash.exe" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source
}
if (-not $BashPath) {
    $BashPath = "bash"
}

if (-not $BashPath) {
    Write-LogError "bash executable not found. Please install Git for Windows."
    exit 1
}

# Pre-flight Auth Refresh Check (Fail-soft)
function Resolve-NlmRuntime {
    if ($env:NLM_CLI) {
        return @{ Mode = "explicit"; Cmd = $env:NLM_CLI; PrefixArgs = @() }
    }
    $UvCmd = Get-Command "uv.exe" -ErrorAction SilentlyContinue
    if (-not $UvCmd) { $UvCmd = Get-Command "uv" -ErrorAction SilentlyContinue }
    $PyProject = Join-Path $RepoRoot "notebooklm-mcp-cli\pyproject.toml"
    if ($UvCmd -and (Test-Path -LiteralPath $PyProject)) {
        return @{ Mode = "uv-project"; Cmd = $UvCmd.Source; PrefixArgs = @("--directory", (Join-Path $RepoRoot "notebooklm-mcp-cli"), "run", "nlm") }
    }
    $GlobalCli = Get-Command "notebooklm.exe" -ErrorAction SilentlyContinue
    if (-not $GlobalCli) { $GlobalCli = Get-Command "notebooklm" -ErrorAction SilentlyContinue }
    if (-not $GlobalCli) { $GlobalCli = Get-Command "nlm.exe" -ErrorAction SilentlyContinue }
    if (-not $GlobalCli) { $GlobalCli = Get-Command "nlm" -ErrorAction SilentlyContinue }
    if ($GlobalCli) {
        return @{ Mode = "global"; Cmd = $GlobalCli.Source; PrefixArgs = @() }
    }
    return @{ Mode = "none"; Cmd = $null; PrefixArgs = @() }
}

function Invoke-NlmCli {
    param([string[]]$Args)
    $rt = Resolve-NlmRuntime
    if ($rt.Mode -eq "none") {
        Write-LogError "No NotebookLM CLI runtime available."
        return 1
    }
    $fullArgs = @($rt.PrefixArgs) + @($Args)
    & $rt.Cmd @fullArgs
    return $LASTEXITCODE
}

$runtime = Resolve-NlmRuntime
Write-LogInfo "CLI resolution mode: $($runtime.Mode)"
if ($runtime.Mode -ne "none") {
    Write-LogInfo "Running pre-flight authentication check..."
    $null = Invoke-NlmCli @("login", "--check") >$null 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-LogInfo "Pre-flight auth check passed."
    } else {
        Write-LogWarn "Pre-flight auth check failed. Proceeding to Stage 1 for fallback auth recovery."
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
    Send-WebhookNotification -Title "Stage 1 Ingest Failed" -Message "NotebookLM Knowledge Base Ingest failed with exit code $Stage1ExitCode on $env:COMPUTERNAME." -Level "ERROR"
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
            Send-WebhookNotification -Title "Stage 2 Artifact Generation Failed" -Message "Stage 1 sync succeeded, but Stage 2 artifact report generation exited with code $LASTEXITCODE." -Level "WARN"
        }
    } catch {
        Write-LogWarn "Stage 2 encountered an exception: $_"
        Send-WebhookNotification -Title "Stage 2 Artifact Exception" -Message "Stage 2 threw exception: $_" -Level "WARN"
    }
} else {
    Write-LogWarn "node.exe not found. Stage 2 artifact generation skipped."
}

# --- STAGE 3: SYNC TO GITHUB WIKI ---
Write-Host ""
Write-LogInfo "================================================================================"
Write-LogInfo "STAGE 3: Synchronizing documentation to remote GitHub Wiki"
Write-LogInfo "================================================================================"

$WikiSyncScript = Join-Path $RepoRoot "scripts\sync-github-wiki.mjs"
if ($NodeCmd -and (Test-Path $WikiSyncScript)) {
    try {
        & node "$WikiSyncScript"
        if ($LASTEXITCODE -eq 0) {
            Write-LogInfo "Stage 3 completed: GitHub Wiki synchronized."
        } else {
            Write-LogWarn "Stage 3 GitHub Wiki sync exited with code $LASTEXITCODE."
        }
    } catch {
        Write-LogWarn "Stage 3 GitHub Wiki sync threw exception: $_"
    }
} else {
    Write-LogWarn "sync-github-wiki.mjs not found or node missing. Stage 3 skipped."
}

Write-Host ""
Write-LogInfo "================================================================================"
Write-LogInfo "KB Sync Nightly Pipeline Completed"
Write-LogInfo "================================================================================"
exit 0

