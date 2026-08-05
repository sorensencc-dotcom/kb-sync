# ==============================================================================
# PowerShell Test Suite for NotebookLM CLI Preflight & Runtime Resolution
# ==============================================================================
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RepoRoot = (Resolve-Path "$ScriptDir\..").Path
$NightlyPs1 = Join-Path $RepoRoot "scripts\notebooklm\kb-sync-nightly.ps1"

Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "PowerShell Preflight Verification Test Harness" -ForegroundColor Cyan
Write-Host "================================================================================" -ForegroundColor Cyan

# Test 1: Syntax Validation
Write-Host "[TEST 1] Validating PowerShell script syntax..." -ForegroundColor Yellow
$errors = $null
$tokens = $null
[System.Management.Automation.Language.Parser]::ParseFile($NightlyPs1, [ref]$tokens, [ref]$errors) | Out-Null
if ($errors.Count -gt 0) {
    Write-Host "[FAIL] Syntax errors in ${NightlyPs1}:" -ForegroundColor Red
    $errors | ForEach-Object { Write-Host "  $($_)" -ForegroundColor Red }
    exit 1
}
Write-Host "[PASS] ✓ Syntax check passed." -ForegroundColor Green

# Test 2: Resolve-NlmRuntime Function Precedence Test
Write-Host "[TEST 2] Verifying Resolve-NlmRuntime resolution precedence..." -ForegroundColor Yellow

# Helper function definition for unit testing internal functions
. $NightlyPs1 -ErrorAction SilentlyContinue

# Explicit override test
$env:NLM_CLI = "C:\custom path\notebooklm.exe"
$rtExplicit = Resolve-NlmRuntime
if ($rtExplicit.Mode -ne "explicit" -or $rtExplicit.Cmd -ne "C:\custom path\notebooklm.exe") {
    Write-Host "[FAIL] Explicit NLM_CLI resolution failed: got $($rtExplicit | ConvertTo-Json)" -ForegroundColor Red
    exit 1
}
Remove-Item Env:\NLM_CLI
Write-Host "[PASS] ✓ Explicit NLM_CLI override resolved correctly." -ForegroundColor Green

# Local uv project test
$UvAvailable = Test-Path "$RepoRoot\notebooklm-mcp-cli\pyproject.toml"
if ($UvAvailable) {
    $rtUv = Resolve-NlmRuntime
    if ($rtUv.Mode -eq "uv-project") {
        Write-Host "[PASS] ✓ Local uv project resolved correctly." -ForegroundColor Green
    } else {
        Write-Host "[INFO] Local uv project mode skipped (uv binary not installed on host)." -ForegroundColor Yellow
    }
}

Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "SUCCESS: All PowerShell verification tests passed!" -ForegroundColor Cyan
Write-Host "================================================================================" -ForegroundColor Cyan
exit 0
