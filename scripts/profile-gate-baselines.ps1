<#
.SYNOPSIS
    Empirical Performance Profiler for Tier 3 Iron Gates.
.DESCRIPTION
    Runs 10 baseline iterations of the validation scripts to establish 
    statistically sound pre-commit latency boundaries, replacing arbitrary WAGs.
#>

$ErrorActionPreference = 'Stop'
$Iterations = 10
$ReportPath = Join-Path $PWD ".performance-baselines.json"

# Targets matching your active core orchestration and validation scripts
$Targets = @(
    @{ Name = "Flatten Pack"; Command = "bash core/flatten.sh --help" },
    @{ Name = "Validate Pack Integrity"; Command = "bash core/validate.sh --help" },
    @{ Name = "Validate Contract"; Command = "node modules/wiki/validate-contract.mjs" }
)

$Platform = if ($IsWindows -ne $null) { if ($IsWindows) { "win32" } else { "posix" } } else { if ($env:OS -match "Windows") { "win32" } else { "posix" } }

$Results = @{
    timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    platform = $Platform
    baselines = @{}
}

Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host " Profiling Tier 3 Iron Gates ($Iterations iterations per target)" -ForegroundColor Cyan
Write-Host "================================================================================`n" -ForegroundColor Cyan

foreach ($Target in $Targets) {
    Write-Host "Profiling: $($Target.Name)..." -ForegroundColor Yellow
    $Timings = @()

    for ($i = 1; $i -le $Iterations; $i++) {
        $Time = Measure-Command {
            # Suppress standard output/errors to prevent terminal noise during profiling
            $null = cmd.exe /c "$($Target.Command) >nul 2>&1"
        }
        $Timings += $Time.TotalMilliseconds
    }

    # Statistical calculations
    $Sorted = $Timings | Sort-Object
    $Median = $Sorted[[int]($Iterations / 2)]
    
    $P95Index = [math]::Floor($Iterations * 0.95)
    if ($P95Index -eq $Iterations) { $P95Index-- }
    $P95 = $Sorted[$P95Index]
    
    # Establish the fail-safe boundary at 1.5x the median to account for environmental noise
    $Threshold15x = [math]::Round($Median * 1.5)

    $Results.baselines[$Target.Name] = @{
        iterations = $Iterations
        median_ms = [math]::Round($Median)
        p95_ms = [math]::Round($P95)
        recommended_gate_ms = $Threshold15x
    }

    Write-Host "  -> Median: $([math]::Round($Median))ms | P95: $([math]::Round($P95))ms"
    Write-Host "  -> Safe Pre-Commit Gate (1.5x): ${Threshold15x}ms`n" -ForegroundColor Green
}

# Export to JSON telemetry report
$Results | ConvertTo-Json -Depth 4 | Out-File -FilePath $ReportPath -Encoding utf8
Write-Host "[SUCCESS] Baseline profiles exported to $ReportPath" -ForegroundColor Cyan
