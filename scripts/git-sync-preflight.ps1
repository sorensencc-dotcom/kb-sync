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
        [string]$LogPrefix = "[GIT-SYNC]",
        [string]$LogFile = "",
        [string]$EntryPoint = "",
        [string[]]$EntryArguments = @()
    )

    function Write-SyncLog($Message) {
        $line = "$LogPrefix $Message"
        Write-Host $line
        if ($LogFile) { Add-Content -LiteralPath $LogFile -Value $line }
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

        $beforeSha = (git rev-parse HEAD)
        $telemetry = @('.sync-status.json', '.drift-report.json', '.coverage-report.json', '.cross-repo-drift-report.json')
        $temp = Join-Path ([System.IO.Path]::GetTempPath()) ("kb-sync-telemetry-" + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $temp -Force | Out-Null
        try {
            foreach ($name in $telemetry) {
                $source = Join-Path $RepoRoot $name
                if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination (Join-Path $temp $name) }
                git restore --source=HEAD -- $name 2>$null
            }

            Write-SyncLog "Fetching origin/$branch..."
            git fetch origin $branch --quiet 2>&1 | ForEach-Object { Write-SyncLog $_ }
            if ($LASTEXITCODE -ne 0) {
                Write-SyncLog "Fetch failed (offline or unreachable remote); continuing with current checkout."
                return
            }

            git merge --ff-only "origin/$branch" --quiet 2>&1 | ForEach-Object { Write-SyncLog $_ }
            if ($LASTEXITCODE -ne 0) {
                Write-SyncLog "Local branch has diverged from origin/$branch or fast-forward isn't possible; skipping auto-sync. Manual intervention needed."
                return
            }

            $headSha = (git rev-parse HEAD)
            if ($beforeSha -ne $headSha -and $EntryPoint -and -not $env:KB_SYNC_RESYNCED) {
                Write-SyncLog "Fast-forwarded $beforeSha -> $headSha; restarting entry point on updated checkout."
                $env:KB_SYNC_RESYNCED = '1'
                & pwsh.exe -NoProfile -ExecutionPolicy Bypass -File $EntryPoint @EntryArguments
                exit $LASTEXITCODE
            }
            Write-SyncLog "Up to date with origin/$branch ($headSha)."
        } finally {
            foreach ($name in $telemetry) {
                $saved = Join-Path $temp $name
                if (Test-Path -LiteralPath $saved) { Copy-Item -LiteralPath $saved -Destination (Join-Path $RepoRoot $name) -Force }
            }
            Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
        }
    } finally {
        Pop-Location
    }
}
