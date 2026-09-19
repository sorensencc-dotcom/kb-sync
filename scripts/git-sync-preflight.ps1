# ==============================================================================
# Git Sync Preflight (shared) - Windows Task Scheduler entry points
# Fetches and fast-forwards the current branch from origin before any
# unattended pipeline stage runs, so scheduled runs never operate on stale
# code after this machine has been offline. Fast-forward only: never
# overwrites local work. Call as the very first statement in any entry-point
# script, before anything else runs or reads repo state.
#
# Mirrors core/run-all.sh's git_sync_preflight_and_reexec: generated
# telemetry (.sync-status.json, .drift-report.json, .coverage-report.json,
# .cross-repo-drift-report.json) is excluded from the dirty-tree check, since
# the pipeline rewrites those every run and they're committed back separately.
# ==============================================================================
function Invoke-GitSyncPreflight {
    param(
        [Parameter(Mandatory=$true)][string]$RepoRoot,
        [string]$LogPrefix = "[GIT-SYNC]"
    )

    function Write-SyncLog($Message) {
        Write-Host "$LogPrefix $Message"
    }

    Push-Location $RepoRoot
    try {
        $branch = (git symbolic-ref --short HEAD 2>$null)
        if (-not $branch) {
            Write-SyncLog "Detached HEAD or not on a branch; skipping auto-sync."
            return
        }

        $excludePaths = @(
            ':!.sync-status.json',
            ':!.drift-report.json',
            ':!.coverage-report.json',
            ':!.cross-repo-drift-report.json'
        )
        $dirty = (git status --porcelain -- . @excludePaths 2>$null)
        if ($dirty) {
            Write-SyncLog "Working tree has uncommitted changes; skipping auto-sync to avoid clobbering local work."
            return
        }

        Write-SyncLog "Fetching origin/$branch..."
        git fetch origin $branch --quiet 2>&1 | Write-Host
        if ($LASTEXITCODE -ne 0) {
            Write-SyncLog "Fetch failed (offline or unreachable remote); continuing with current checkout."
            return
        }

        git merge --ff-only "origin/$branch" --quiet 2>&1 | Write-Host
        if ($LASTEXITCODE -ne 0) {
            Write-SyncLog "Local branch has diverged from origin/$branch or fast-forward isn't possible; skipping auto-sync. Manual intervention needed."
            return
        }

        $headSha = (git rev-parse --short HEAD)
        Write-SyncLog "Up to date with origin/$branch ($headSha)."
    } finally {
        Pop-Location
    }
}
