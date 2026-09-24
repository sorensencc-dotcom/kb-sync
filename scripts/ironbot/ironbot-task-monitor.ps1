[CmdletBinding()]
param([switch]$DryRun)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
$AuditDir = Join-Path $RepoRoot 'docs\audit\ironbot'
$Namespaces = @('\KB-SYNC\', '\CIC\', '\TRM\', '\CastIronCharlie\')
$Findings = @()
$HealedCount = 0
$ReplayedCount = 0

function Write-IronLog($Msg) { Write-Host "[IronBot] $Msg" }

foreach ($ns in $Namespaces) {
    $tasks = Get-ScheduledTask -TaskPath $ns -ErrorAction SilentlyContinue
    foreach ($task in $tasks) {
        $info = $task | Get-ScheduledTaskInfo
        if ($info.LastTaskResult -ne 0) {
            Write-IronLog "FAILED: $($task.TaskName) (exit $($info.LastTaskResult))"

            if (-not $DryRun) {
                $result = node "$RepoRoot\scripts\ironbot\ironbot-playbooks.mjs" `
                    --task $task.TaskName --exitCode $info.LastTaskResult
                $payload = $result | ConvertFrom-Json

                if ($payload.healed) {
                    $HealedCount++
                    Start-ScheduledTask -TaskName $task.TaskName -TaskPath $ns
                    Write-IronLog "Reran: $($task.TaskName)"

                    # Replay downstream
                    $downstream = node "$RepoRoot\scripts\ironbot\ironbot-playbooks.mjs" `
                        --downstream $task.TaskName | ConvertFrom-Json
                    foreach ($dep in $downstream) {
                        $depDef = (node "$RepoRoot\scripts\ironbot\ironbot-playbooks.mjs" --dag | ConvertFrom-Json).tasks.$dep
                        Start-ScheduledTask -TaskName $dep -TaskPath $depDef.task_path
                        $ReplayedCount++
                        Write-IronLog "Replayed downstream: $dep"
                    }
                }
            }

            $Findings += @{ task = $task.TaskName; exitCode = $info.LastTaskResult }
        }
    }
}

New-Item -ItemType Directory -Force -Path $AuditDir | Out-Null
$ts = (Get-Date -Format 'yyyy-MM-dd-HHmmss')
$report = @{
    timestamp = (Get-Date -Format 'o')
    healedCount = $HealedCount
    replayedCount = $ReplayedCount
    findings = $Findings
    dryRun = $DryRun.IsPresent
}
$report | ConvertTo-Json -Depth 5 | Out-File "$AuditDir\$ts.json" -Encoding utf8
Write-IronLog "Audit written: $AuditDir\$ts.json"

$WebhookUrl = $env:WEBHOOK_URL
if ($WebhookUrl -and $HealedCount -gt 0) {
    $body = @{ text = "[IronBot] Healed $HealedCount task(s), replayed $ReplayedCount downstream. Findings: $($Findings.Count)" } | ConvertTo-Json
    Invoke-RestMethod -Uri $WebhookUrl -Method Post -Body $body -ContentType 'application/json' -ErrorAction SilentlyContinue
}
