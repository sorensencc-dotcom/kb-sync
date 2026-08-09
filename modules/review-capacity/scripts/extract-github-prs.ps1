[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string[]]$Repo = @(),

    [Parameter(Mandatory = $false)]
    [string]$OutputPath = (Join-Path $PSScriptRoot '..\review-capacity-baseline.csv'),

    [Parameter(Mandatory = $false)]
    [int]$Days = 14,

    [Parameter(Mandatory = $false)]
    [string]$DefaultOwner = "sorensencc-dotcom",

    [Parameter(Mandatory = $false)]
    [array]$FixturePrs = $null
)

$ErrorActionPreference = 'Stop'

# Save parameters before dot-sourcing to prevent param block variable shadowing
$boundOutputPath = $OutputPath
$boundRepo = $Repo

# Dot-source extract-ai-telemetry.ps1 for Schema v1.1 telemetry extraction & publication helpers
$telemetryScript = Join-Path $PSScriptRoot 'extract-ai-telemetry.ps1'
if ([System.IO.File]::Exists($telemetryScript)) {
    . $telemetryScript
} else {
    throw "Required telemetry extraction script not found at '$telemetryScript'"
}

if ($boundOutputPath) { $OutputPath = $boundOutputPath }
if ($boundRepo) { $Repo = $boundRepo }

function Normalize-BaselineRow {
    param([object]$Row)
    $obj = [ordered]@{}
    foreach ($h in (Get-AiTelemetryCsvHeaders)) {
        if ($null -ne $Row.PSObject.Properties[$h]) {
            $obj[$h] = $Row.$h
        } else {
            $obj[$h] = ''
        }
    }
    return [pscustomobject]$obj
}

# 14-day inclusive-lower / exclusive-upper UTC window boundaries
$nowUtc = [DateTime]::UtcNow
$windowEnd = $nowUtc
$windowStart = $nowUtc.AddDays(-$Days)

# Load existing baseline rows and populate known lookup table
$existing = if (-not [string]::IsNullOrWhiteSpace($OutputPath) -and [System.IO.File]::Exists($OutputPath)) { @(Import-Csv -LiteralPath $OutputPath) } else { @() }
$known = [ordered]@{}

foreach ($row in $existing) {
    if ($row.pr_id) {
        $known[$row.pr_id] = Normalize-BaselineRow -Row $row
    }
}

# Helper to process and enrich pull request objects into Schema v1.1 telemetry
function Process-PullRequests {
    param(
        [array]$PrList,
        [string]$RepoName
    )
    foreach ($pr in $PrList) {
        if ($pr -is [hashtable] -and $pr.ContainsKey('TriggerExtractionException') -and $pr['TriggerExtractionException']) {
            throw "Simulated extraction failure"
        }
        if ($pr -is [pscustomobject] -and $pr.TriggerExtractionException) {
            throw "Simulated extraction failure"
        }

        $createdAtStr = if ($pr.createdAt) { $pr.createdAt } elseif ($pr.created_at) { $pr.created_at } else { $null }
        if (-not $createdAtStr) { continue }

        $createdDt = [DateTimeOffset]::Parse($createdAtStr).UtcDateTime

        # Enforce 14-day window: inclusive lower bound, exclusive upper bound
        if ($createdDt -ge $windowStart -and $createdDt -lt $windowEnd) {
            $prRepo = if ($pr.repo) { $pr.repo } else { $RepoName }

            $prNode = if ($pr -is [pscustomobject]) { $pr | Select-Object * } else { [pscustomobject]$pr }
            if (-not $prNode.PSObject.Properties['repo']) {
                $prNode | Add-Member -NotePropertyName "repo" -NotePropertyValue $prRepo -Force
            }

            try {
                $telemetryRow = Get-TelemetryFromPullRequestPayload -PrNode $prNode
                $known[$telemetryRow.pr_id] = $telemetryRow
            } catch {
                Write-Warning "Failed telemetry extraction for PR $($prRepo): $_"
                $num = if ($pr.number) { $pr.number } else { "0" }
                $id = "$($prRepo)#$num"
                $known[$id] = [pscustomobject]@{
                    pr_id                        = $id
                    repo                         = $prRepo
                    author                       = if ($pr.author -and $pr.author.login) { $pr.author.login } elseif ($pr.author) { [string]$pr.author } else { "" }
                    created_at                   = $createdAtStr
                    merged_at                    = if ($pr.mergedAt) { $pr.mergedAt } else { "" }
                    outcome                      = if ($pr.mergedAt) { "merged" } elseif ($pr.closedAt) { "closed" } else { "open" }
                    lines_changed                = if ($pr.additions -or $pr.deletions) { [int]$pr.additions + [int]$pr.deletions } else { 0 }
                    lines_changed_filtered       = ""
                    ai_assisted                  = ""
                    ai_authored_bucket           = ""
                    human_reviewers              = ""
                    human_review_minutes         = ""
                    first_review_latency_minutes = ""
                    automated_findings_count     = ""
                    rework_commits_count         = ""
                    collection_status            = "error"
                    classification_reason        = "Extraction error: $_"
                    telemetry_version            = "v1.1"
                    query_timestamp              = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
                }
            }
        }
    }
}

# Fetch PRs from GitHub CLI or use fixture PRs if provided
if ($null -ne $FixturePrs) {
    Process-PullRequests -PrList $FixturePrs -RepoName "owner/repo"
} else {
    $jsonFields = "number,author,createdAt,mergedAt,closedAt,title,body,additions,deletions,files,reviews,comments,commits"
    foreach ($r in $Repo) {
        $fullRepo = if ($r -contains '/' -or $r.Contains('/')) { $r } else { "$DefaultOwner/$r" }
        try {
            $rawPrs = gh pr list --repo $fullRepo --state all --limit 500 --json $jsonFields | ConvertFrom-Json
            if ($rawPrs) {
                Process-PullRequests -PrList @($rawPrs) -RepoName $fullRepo
            }
        } catch {
            Write-Warning "Failed to fetch PRs for repository '$fullRepo': $_"
        }
    }
}

# Atomic publication helper writes to .tmp file first, then atomically replaces destination file
$sortedRows = @($known.Values) | Sort-Object pr_id
Publish-AiTelemetryCsv -OutputPath $OutputPath -Rows $sortedRows
