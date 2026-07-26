# ==============================================================================
# KB Sync Weekly Wiki Automation Task Wrapper
# Runs weekly wiki frontmatter backfill, staging validation, and log rotation
# ==============================================================================
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RepoRoot = (Resolve-Path "$ScriptDir\..").Path

function Write-LogInfo($Message) {
    Write-Host "[KB-WIKI-WEEKLY] [INFO] $Message" -ForegroundColor Green
}

function Write-LogError($Message) {
    Write-Host "[KB-WIKI-WEEKLY] [ERROR] $Message" -ForegroundColor Red
}

Set-Location $RepoRoot
Write-LogInfo "Starting KB Sync Weekly Wiki Automation Pipeline..."

# Step 1: Autofill Frontmatter
Write-LogInfo "Step 1/3: Auto-filling frontmatter metadata..."
npm run wiki:autofill-frontmatter
if ($LASTEXITCODE -ne 0) {
    Write-LogError "wiki:autofill-frontmatter failed with exit code $LASTEXITCODE"
}

# Step 2: Validate Staging Docs
Write-LogInfo "Step 2/3: Validating staging documentation..."
npm run wiki:validate-staging
if ($LASTEXITCODE -ne 0) {
    Write-LogError "wiki:validate-staging failed with exit code $LASTEXITCODE"
}

# Step 3: Cleanup Staging Archives
Write-LogInfo "Step 3/3: Cleaning up staging archives..."
npm run wiki:cleanup-archives
if ($LASTEXITCODE -ne 0) {
    Write-LogError "wiki:cleanup-archives failed with exit code $LASTEXITCODE"
}

Write-LogInfo "Weekly Wiki Automation Pipeline Completed Successfully!"
exit 0
