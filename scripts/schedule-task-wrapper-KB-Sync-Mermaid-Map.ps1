# ==============================================================================
# KB Sync Mermaid Topology Map Scheduled Task Wrapper
# Renders system topology Mermaid chart into wiki/Index.md from active DAG
# ==============================================================================
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RepoRoot = (Resolve-Path "$ScriptDir\..").Path

function Write-LogInfo($Message) {
    Write-Host "[KB-MERMAID-MAP] [INFO] $Message" -ForegroundColor Green
}

function Write-LogError($Message) {
    Write-Host "[KB-MERMAID-MAP] [ERROR] $Message" -ForegroundColor Red
}

Set-Location $RepoRoot
Write-LogInfo "Starting KB Sync Mermaid Topology Map Generator..."

# Execute map generation
npm run wiki:generate-map
if ($LASTEXITCODE -ne 0) {
    Write-LogError "wiki:generate-map failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}

Write-LogInfo "Mermaid Topology Map generation completed successfully!"
exit 0
