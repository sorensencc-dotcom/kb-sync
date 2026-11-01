[CmdletBinding()]
param(
    [string]$RepoRoot = 'C:\dev\kb-sync',
    [int]$Port = 8080,
    [int]$WaitSeconds = 15
)

$ErrorActionPreference = 'Stop'
$DashboardUrl = "http://127.0.0.1:$Port/modules/wiki/dashboard.html"
$ApiUrl = "http://127.0.0.1:$Port/api/reporting/weekly-retro"
$MeridianUrl = "http://127.0.0.1:$Port/api/reporting/meridian"
$Node = if (Get-Command node.exe -ErrorAction SilentlyContinue) {
    (Get-Command node.exe).Source
} elseif (Test-Path 'C:\Program Files\nodejs\node.exe') {
    'C:\Program Files\nodejs\node.exe'
} else {
    'node'
}
$ServerScript = Join-Path $RepoRoot 'server.mjs'

function Test-Dashboard {
    try {
        $c1 = & curl.exe -s -o NUL -w "%{http_code}" -m 3 $DashboardUrl
        if ($c1 -ne '200') { return $false }
        $c2 = & curl.exe -s -o NUL -w "%{http_code}" -m 3 $ApiUrl
        if ($c2 -ne '200') { return $false }
        $c3 = & curl.exe -s -o NUL -w "%{http_code}" -m 3 $MeridianUrl
        return ($c3 -eq '200')
    } catch {
        return $false
    }
}

$RestartFlag = 'C:\dev\.restart-dashboard'
if (Test-Path $RestartFlag) {
    Remove-Item -Path $RestartFlag -Force -ErrorAction SilentlyContinue
    Write-Output "Forcing restart due to $RestartFlag"
} elseif (Test-Dashboard) {
    Write-Output "Dashboard already healthy: $DashboardUrl"
    exit 0
}

& netstat.exe -ano | ForEach-Object {
    if ($_ -match "TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)") {
        $procId = $matches[1]
        try {
            $prevEap = $ErrorActionPreference
            $ErrorActionPreference = 'SilentlyContinue'
            & taskkill.exe /f /pid $procId 2>&1 | Out-Null
            $ErrorActionPreference = $prevEap
        } catch {}
    }
}

Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object {
        try {
            $prevEap = $ErrorActionPreference
            $ErrorActionPreference = 'SilentlyContinue'
            & taskkill.exe /f /pid $_.OwningProcess 2>&1 | Out-Null
            Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
            $ErrorActionPreference = $prevEap
        } catch {}
    }

if (-not (Test-Path -LiteralPath $ServerScript -PathType Leaf)) {
    throw "Dashboard server script not found: $ServerScript"
}

$StdOutLog = 'C:\dev\.dashboard-server.log'
$StdErrLog = 'C:\dev\.dashboard-server-err.log'

Start-Process -FilePath $Node `
    -ArgumentList @($ServerScript) `
    -WorkingDirectory $RepoRoot `
    -RedirectStandardOutput $StdOutLog `
    -RedirectStandardError $StdErrLog `
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
