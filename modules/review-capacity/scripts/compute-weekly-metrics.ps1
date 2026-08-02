param(
    [string]$CsvPath = (Join-Path $PSScriptRoot '..\review-capacity-baseline.csv'),
    [datetime]$WeekStart = ((Get-Date).Date.AddDays(-1 * [int](Get-Date).DayOfWeek + 1).AddDays(-7))
)

$rows = @(Import-Csv -LiteralPath $CsvPath | Where-Object {
    $_.outcome -eq 'merged' -and [datetime]$_.merged_at -ge $WeekStart -and [datetime]$_.merged_at -lt $WeekStart.AddDays(7)
})
if ($rows.Count -eq 0) { Write-Output "No merged PRs for week $($WeekStart.ToString('yyyy-MM-dd'))."; exit 0 }

$engineers = @($rows | Select-Object -ExpandProperty author -Unique).Count
$reviewMinutes = ($rows | ForEach-Object { [double]$_.human_review_minutes } | Measure-Object -Sum).Sum
$aiRows = @($rows | Where-Object { $_.ai_assisted -eq 'yes' }).Count
$reworkRows = @($rows | Where-Object { [int]$_.rework_commits_count -gt 0 }).Count
$latencies = @($rows | ForEach-Object { [double]$_.first_review_latency_minutes } | Sort-Object)
$median = $latencies[[math]::Floor(($latencies.Count - 1) / 2)]

[pscustomobject]@{
    week_start = $WeekStart.ToString('yyyy-MM-dd')
    merged_prs_week = $rows.Count
    active_engineers_week = $engineers
    prs_per_engineer = [math]::Round($rows.Count / $engineers, 2)
    review_hours_per_engineer = [math]::Round($reviewMinutes / 60 / $engineers, 2)
    ai_pr_share = [math]::Round($aiRows / $rows.Count, 3)
    rework_rate = [math]::Round($reworkRows / $rows.Count, 3)
    median_first_review_latency_minutes = $median
} | ConvertTo-Json
