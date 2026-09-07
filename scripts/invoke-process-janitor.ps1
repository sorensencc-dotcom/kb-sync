<#
.SYNOPSIS
  Preflight wrapper for Toolforge node-process-janitor.ps1

.DESCRIPTION
  Always dry-runs and logs output. Pass -Apply (nightly/unattended) to also
  terminate candidates. Override script path with -ScriptPath or env
  TOOLFORGE_JANITOR_PS1 / JANITOR_PS1 (default: C:\dev\utilities\node-process-janitor.ps1).

  Missing script or janitor errors: warn and continue (never throws / never
  fails the caller).
#>
[CmdletBinding()]
param(
    [switch]$Apply,
    [string]$ScriptPath
)

function Write-JanitorLog {
    param(
        [ValidateSet('INFO', 'WARN', 'ERROR')]
        [string]$Level,
        [string]$Message
    )
    $color = switch ($Level) {
        'WARN'  { 'Yellow' }
        'ERROR' { 'Red' }
        default { 'Cyan' }
    }
    Write-Host "[process-janitor] [$Level] $Message" -ForegroundColor $color
}

$resolved = $ScriptPath
if (-not $resolved) { $resolved = $env:TOOLFORGE_JANITOR_PS1 }
if (-not $resolved) { $resolved = $env:JANITOR_PS1 }
if (-not $resolved) { $resolved = 'C:\dev\utilities\node-process-janitor.ps1' }

if (-not (Test-Path -LiteralPath $resolved)) {
    Write-JanitorLog -Level WARN -Message "Janitor script not found at $resolved; skipping."
    return
}

$psExe = $null
$pwsh = Get-Command 'pwsh.exe' -ErrorAction SilentlyContinue
if ($pwsh) {
    $psExe = $pwsh.Source
} else {
    $psExe = (Get-Command 'powershell.exe' -ErrorAction SilentlyContinue).Source
    if (-not $psExe) { $psExe = 'powershell.exe' }
}

function Invoke-JanitorPass {
    param([switch]$DoApply)

    $mode = if ($DoApply) { 'APPLY' } else { 'dry-run' }
    Write-JanitorLog -Level INFO -Message "Running janitor ($mode): $resolved"

    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $resolved)
    if ($DoApply) { $argList += '-Apply' }

    try {
        & $psExe @argList 2>&1 | ForEach-Object { Write-Host $_ }
        $code = $LASTEXITCODE
        if ($null -ne $code -and $code -ne 0) {
            Write-JanitorLog -Level WARN -Message "Janitor exited with code $code ($mode); continuing."
        } else {
            Write-JanitorLog -Level INFO -Message "Janitor $mode completed."
        }
    } catch {
        Write-JanitorLog -Level WARN -Message "Janitor $mode failed: $_; continuing."
    }
}

# Always dry-run and log; optionally Apply for nightly/unattended paths.
Invoke-JanitorPass
if ($Apply) {
    Invoke-JanitorPass -DoApply
}
