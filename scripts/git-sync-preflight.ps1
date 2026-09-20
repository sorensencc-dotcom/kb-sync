# ==============================================================================
# Git Sync Preflight (shared) - Windows Task Scheduler entry points
# Fetches and fast-forwards the current branch from origin before any
# unattended pipeline stage runs, so scheduled runs never operate on stale
# code after this machine has been offline. Fast-forward only: never
# overwrites local work. Call as the very first statement in any entry-point
# script, before anything else runs or reads repo state.
#
# Mirrors core/run-all.sh's git_sync_preflight_and_reexec:
# - Generated telemetry (.sync-status.json, .drift-report.json,
#   .coverage-report.json, .cross-repo-drift-report.json) is excluded from the
#   dirty-tree check. Local copies are preserved outside the worktree, the
#   checked-in versions are restored so `git merge --ff-only` can proceed, then
#   generated contents are restored on every success and failure path.
# - After a successful fast-forward that changes HEAD, re-execs the original
#   entry point (+ args) so orchestration picks up updated scripts. Guarded by
#   KB_GIT_SYNC_RESYNCED to prevent re-exec loops.
# ==============================================================================
function Invoke-GitSyncPreflight {
    param(
        [Parameter(Mandatory=$true)][string]$RepoRoot,
        [string]$LogPrefix = "[GIT-SYNC]",
        [string]$LogFile = ""
    )

    # One-shot guard: after a re-exec, skip sync so we never loop.
    if ($env:KB_GIT_SYNC_RESYNCED -eq "1") {
        return
    }

    function Write-SyncLog([string]$Message) {
        $line = "$LogPrefix $Message"
        Write-Host $line
        if ($LogFile) {
            try {
                Add-Content -LiteralPath $LogFile -Value $line -ErrorAction SilentlyContinue
            } catch {
                # Logging must never fail the preflight itself.
            }
        }
    }

    $telemetryFiles = @(
        '.sync-status.json',
        '.drift-report.json',
        '.coverage-report.json',
        '.cross-repo-drift-report.json'
    )

    # Capture the entry-point script + args for post-ff re-exec (master/TRM/nightly).
    $reExecScript = $null
    $reExecArgList = $null
    $callerFrame = $null
    try {
        $callerFrame = (Get-PSCallStack)[1]
    } catch {
        $callerFrame = $null
    }
    if ($callerFrame -and $callerFrame.ScriptName) {
        $reExecScript = $callerFrame.ScriptName
    }
    $argv = [Environment]::GetCommandLineArgs()
    $fileIdx = -1
    for ($i = 0; $i -lt $argv.Length; $i++) {
        if ($argv[$i] -ieq '-File' -or $argv[$i] -ieq '-f') {
            $fileIdx = $i
            break
        }
    }
    if ($fileIdx -ge 0 -and ($fileIdx + 1) -lt $argv.Length) {
        # Re-run with the same -File script and trailing user args.
        $reExecArgList = @('-NoProfile', '-ExecutionPolicy', 'Bypass') + $argv[$fileIdx..($argv.Length - 1)]
        if (-not $reExecScript) {
            $reExecScript = $argv[$fileIdx + 1]
        }
    } elseif ($reExecScript) {
        $reExecArgList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $reExecScript)
    }

    $preserveDir = $null
    $needReExec = $false
    $beforeSha = $null
    $afterSha = $null

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

        # Preserve generated telemetry outside the worktree so ff-only can update
        # the tracked copies without refusing over local pipeline rewrites.
        $preserveDir = Join-Path ([System.IO.Path]::GetTempPath()) ("kb-sync-telemetry-" + [guid]::NewGuid().ToString("n"))
        New-Item -ItemType Directory -Path $preserveDir -Force | Out-Null
        foreach ($name in $telemetryFiles) {
            $src = Join-Path $RepoRoot $name
            if (Test-Path -LiteralPath $src) {
                Copy-Item -LiteralPath $src -Destination (Join-Path $preserveDir $name) -Force
            }
        }
        foreach ($name in $telemetryFiles) {
            $src = Join-Path $RepoRoot $name
            if (Test-Path -LiteralPath $src) {
                # Restore the checked-in version so ff-only can update the path.
                git checkout HEAD -- $name 2>$null | Out-Null
            }
        }

        $beforeSha = (git rev-parse HEAD 2>$null)

        Write-SyncLog "Fetching origin/$branch..."
        $fetchOut = git fetch origin $branch --quiet 2>&1
        $fetchExit = $LASTEXITCODE
        foreach ($line in @($fetchOut)) {
            if ($null -ne $line -and "$line".Length -gt 0) { Write-SyncLog "$line" }
        }
        if ($fetchExit -ne 0) {
            Write-SyncLog "Fetch failed (offline or unreachable remote); continuing with current checkout."
            return
        }

        $mergeOut = git merge --ff-only "origin/$branch" --quiet 2>&1
        $mergeExit = $LASTEXITCODE
        foreach ($line in @($mergeOut)) {
            if ($null -ne $line -and "$line".Length -gt 0) { Write-SyncLog "$line" }
        }
        if ($mergeExit -ne 0) {
            Write-SyncLog "Local branch has diverged from origin/$branch or fast-forward isn't possible; skipping auto-sync. Manual intervention needed."
            return
        }

        $afterSha = (git rev-parse HEAD 2>$null)
        $afterShort = (git rev-parse --short HEAD 2>$null)

        if ($beforeSha -eq $afterSha) {
            Write-SyncLog "Up to date with origin/$branch ($afterShort)."
            return
        }

        Write-SyncLog "Fast-forwarded $beforeSha -> $afterSha; restarting entry point on the updated checkout."
        $needReExec = $true
    } finally {
        # Restore generated telemetry on EVERY success and failure path.
        if ($preserveDir -and (Test-Path -LiteralPath $preserveDir)) {
            foreach ($name in $telemetryFiles) {
                $bak = Join-Path $preserveDir $name
                if (Test-Path -LiteralPath $bak) {
                    Copy-Item -LiteralPath $bak -Destination (Join-Path $RepoRoot $name) -Force
                }
            }
            Remove-Item -LiteralPath $preserveDir -Recurse -Force -ErrorAction SilentlyContinue
        }
        Pop-Location
    }

    if ($needReExec) {
        if (-not $reExecArgList -or -not $reExecScript) {
            Write-SyncLog "HEAD changed but could not determine entry point for re-exec; continuing in-process (may run stale orchestration)."
            return
        }
        $env:KB_GIT_SYNC_RESYNCED = "1"
        $pwshCmd = $null
        if (Get-Command pwsh -ErrorAction SilentlyContinue) {
            $pwshCmd = (Get-Command pwsh).Source
        } elseif (Get-Command powershell -ErrorAction SilentlyContinue) {
            $pwshCmd = (Get-Command powershell).Source
        } else {
            # Fall back to current process path.
            $pwshCmd = (Get-Process -Id $PID).Path
        }
        Write-SyncLog "Re-exec: $pwshCmd $($reExecArgList -join ' ')"
        # Call operator preserves arg quoting better than Start-Process -ArgumentList.
        & $pwshCmd @reExecArgList
        exit $LASTEXITCODE
    }
}
