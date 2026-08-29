[CmdletBinding()]
param(
    [string]$RepoRoot = 'C:\dev\kb-sync',
    [int]$Port = 8080,
    [int]$WaitSeconds = 15
)

$ErrorActionPreference = 'Stop'
$DashboardUrl = "http://127.0.0.1:$Port/dashboard.html"
$Npx = (Get-Command npx.cmd -ErrorAction Stop).Source

function Test-Dashboard {
    try {
        $response = Invoke-WebRequest -Uri $DashboardUrl -UseBasicParsing -TimeoutSec 3
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

if (Test-Dashboard) {
    Write-Output "Dashboard already healthy: $DashboardUrl"
    exit 0
}

Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)"
        if ($process.CommandLine -like '*http-server*') {
            Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }

Start-Process -FilePath $Npx `
    -ArgumentList @('http-server', '.', '-p', $Port, '-o', 'modules/wiki/dashboard.html', '-c-1') `
    -WorkingDirectory $RepoRoot `
    -WindowStyle Hidden

$deadline = (Get-Date).AddSeconds($WaitSeconds)
do {
    Start-Sleep -Milliseconds 500
    if (Test-Dashboard) {
        Write-Output "Dashboard started and healthy: $DashboardUrl"
        exit 0
    }
} while ((Get-Date) -lt $deadline)

throw "Dashboard did not become healthy within $WaitSeconds seconds: $DashboardUrl"
