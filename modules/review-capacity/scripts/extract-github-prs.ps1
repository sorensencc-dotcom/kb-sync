param(
    [Parameter(Mandatory)] [string[]]$Repo,
    [string]$OutputPath = (Join-Path $PSScriptRoot '..\review-capacity-baseline.csv'),
    [int]$Days = 14,
    [string]$DefaultOwner = "sorensencc-dotcom"
)

$since = (Get-Date).ToUniversalTime().AddDays(-$Days).ToString('o')
$existing = if (Test-Path -LiteralPath $OutputPath) { @(Import-Csv -LiteralPath $OutputPath) } else { @() }
$known = @{}; $existing | ForEach-Object { $known[$_.pr_id] = $_ }

foreach ($r in $Repo) {
    $fullRepo = if ($r -contains '/' -or $r.Contains('/')) { $r } else { "$DefaultOwner/$r" }
    try {
        $prs = gh pr list --repo $fullRepo --state all --limit 500 --json number,author,createdAt,mergedAt,additions,deletions,reviewDecision,merged | ConvertFrom-Json
        foreach ($pr in $prs | Where-Object { $_.createdAt -ge $since }) {
            $id = "$fullRepo#$($pr.number)"
            if (-not $known.ContainsKey($id)) {
                $known[$id] = [pscustomobject]@{
                    pr_id = $id
                    repo = $fullRepo
                    author = $pr.author.login
                    created_at = $pr.createdAt
                    merged_at = $pr.mergedAt
                    human_reviewers = ''
                    human_review_minutes = ''
                    first_review_latency_minutes = ''
                    lines_changed = ([int]$pr.additions + [int]$pr.deletions)
                    ai_assisted = ''
                    ai_authored_bucket = ''
                    automated_findings_count = ''
                    rework_commits_count = ''
                    outcome = ($(if ($pr.merged) { 'merged' } else { 'closed' }))
                }
            }
        }
    } catch {
        Write-Warning "Failed to fetch PRs for repository '$fullRepo': $_"
    }
}

$known.Values | Sort-Object pr_id | Export-Csv -LiteralPath $OutputPath -NoTypeInformation
