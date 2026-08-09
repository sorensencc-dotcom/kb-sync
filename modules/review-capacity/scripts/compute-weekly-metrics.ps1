param(
    [string]$CsvPath = (Join-Path $PSScriptRoot '..\review-capacity-baseline.csv'),
    [datetime]$WeekStart = ((Get-Date).Date.AddDays(-1 * [int](Get-Date).DayOfWeek + 1).AddDays(-7)),
    [int]$SustainablePrsPerEngineer = 3
)

$rows = @(
    if (Test-Path -LiteralPath $CsvPath) {
        Import-Csv -LiteralPath $CsvPath | Where-Object {
            $_.outcome -eq 'merged' -and
            -not [string]::IsNullOrWhiteSpace($_.merged_at) -and
            [datetime]$_.merged_at -ge $WeekStart -and
            [datetime]$_.merged_at -lt $WeekStart.AddDays(7)
        }
    }
)

$activeAuthors = @($rows | Where-Object { -not [string]::IsNullOrWhiteSpace($_.author) } | Select-Object -ExpandProperty author -Unique)
$engineers = $activeAuthors.Count

$validReviewMinutes = @(
    $rows | Where-Object {
        -not [string]::IsNullOrWhiteSpace($_.human_review_minutes) -and
        [double]::TryParse($_.human_review_minutes, [ref][double]0)
    } | ForEach-Object { [double]$_.human_review_minutes }
)
$reviewMinutes = ($validReviewMinutes | Measure-Object -Sum).Sum
if ($null -eq $reviewMinutes) { $reviewMinutes = 0 }

$aiRows = @($rows | Where-Object { $_.ai_assisted -eq 'yes' }).Count

$reworkRows = @(
    $rows | Where-Object {
        -not [string]::IsNullOrWhiteSpace($_.rework_commits_count) -and
        [int]::TryParse($_.rework_commits_count, [ref][int]0) -and
        [int]$_.rework_commits_count -gt 0
    }
).Count

$latencies = @(
    $rows | Where-Object {
        -not [string]::IsNullOrWhiteSpace($_.first_review_latency_minutes) -and
        [double]::TryParse($_.first_review_latency_minutes, [ref][double]0)
    } | ForEach-Object { [double]$_.first_review_latency_minutes } | Sort-Object
)
$median = if ($latencies.Count -gt 0) { [double]$latencies[[math]::Floor(($latencies.Count - 1) / 2)] } else { 0 }
$reviewCeiling = $engineers * $SustainablePrsPerEngineer

$okCount = @($rows | Where-Object { $_.collection_status -eq 'ok' -or [string]::IsNullOrWhiteSpace($_.collection_status) }).Count
$degradedCount = @($rows | Where-Object { $_.collection_status -eq 'degraded' }).Count
$errorCount = @($rows | Where-Object { $_.collection_status -eq 'error' }).Count

[pscustomobject]@{
    week_start                          = $WeekStart.ToString('yyyy-MM-dd')
    merged_prs_week                     = $rows.Count
    active_engineers_week               = $engineers
    sustainable_prs_per_engineer        = $SustainablePrsPerEngineer
    review_ceiling                      = $reviewCeiling
    is_saturated                        = ($rows.Count -gt $reviewCeiling)
    prs_per_engineer                    = if ($engineers -gt 0) { [math]::Round($rows.Count / $engineers, 2) } else { 0 }
    review_hours_per_engineer           = if ($engineers -gt 0) { [math]::Round($reviewMinutes / 60 / $engineers, 2) } else { 0 }
    ai_pr_share                         = if ($rows.Count -gt 0) { [math]::Round($aiRows / $rows.Count, 3) } else { 0 }
    rework_rate                         = if ($rows.Count -gt 0) { [math]::Round($reworkRows / $rows.Count, 3) } else { 0 }
    median_first_review_latency_minutes = $median
    telemetry_collection_ok             = $okCount
    telemetry_collection_degraded       = $degradedCount
    telemetry_collection_error          = $errorCount
} | ConvertTo-Json

