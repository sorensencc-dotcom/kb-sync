# ==============================================================================
# AI Telemetry Extractor v1.1
# ==============================================================================
[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$Repo,

    [Parameter(Mandatory = $false)]
    [int]$Limit = 50,

    [Parameter(Mandatory = $false)]
    [string]$OutputPath,

    [Parameter(Mandatory = $false)]
    $FixturePayload
)

function Get-AiTelemetryCsvHeaders {
    return @(
        'pr_id',
        'repo',
        'author',
        'created_at',
        'merged_at',
        'outcome',
        'lines_changed',
        'lines_changed_filtered',
        'ai_assisted',
        'ai_authored_bucket',
        'human_reviewers',
        'human_review_minutes',
        'first_review_latency_minutes',
        'automated_findings_count',
        'rework_commits_count',
        'collection_status',
        'classification_reason',
        'telemetry_version',
        'query_timestamp'
    )
}

function Test-AiSignature {
    param(
        [string]$Title = '',
        [string]$Body = '',
        [array]$CommitMessages = @()
    )

    $coAuthPattern = '(?i)Co-authored-by:.*?(Claude|Cursor|Antigravity|Copilot|Devin|ChatGPT|Gemini|bot@)'
    $genByPattern  = '(?i)Generated-by:.*?(Claude|Cursor|Antigravity|AI|Agent)'

    # Check Title
    if ($Title -match $coAuthPattern) {
        return [pscustomobject]@{ IsAssisted = $true; Reason = "Signature match: $($Matches[0])" }
    }
    if ($Title -match $genByPattern) {
        return [pscustomobject]@{ IsAssisted = $true; Reason = "Signature match: $($Matches[0])" }
    }
    if ($Title -match '\[claude\]') {
        return [pscustomobject]@{ IsAssisted = $true; Reason = "Signature match: [claude]" }
    }
    if ($Title -match '\[cursor\]') {
        return [pscustomobject]@{ IsAssisted = $true; Reason = "Signature match: [cursor]" }
    }
    if ($Title -match '(?i)\bai:') {
        return [pscustomobject]@{ IsAssisted = $true; Reason = "Signature match: ai:" }
    }
    if ($Title -match '(?i)\bagent:') {
        return [pscustomobject]@{ IsAssisted = $true; Reason = "Signature match: agent:" }
    }

    # Check Body
    if ($Body -match $coAuthPattern) {
        return [pscustomobject]@{ IsAssisted = $true; Reason = "Signature match: $($Matches[0])" }
    }
    if ($Body -match $genByPattern) {
        return [pscustomobject]@{ IsAssisted = $true; Reason = "Signature match: $($Matches[0])" }
    }
    if ($Body -match '\[claude\]') {
        return [pscustomobject]@{ IsAssisted = $true; Reason = "Signature match: [claude]" }
    }
    if ($Body -match '\[cursor\]') {
        return [pscustomobject]@{ IsAssisted = $true; Reason = "Signature match: [cursor]" }
    }
    if ($Body -match '(?i)\bai:') {
        return [pscustomobject]@{ IsAssisted = $true; Reason = "Signature match: ai:" }
    }
    if ($Body -match '(?i)\bagent:') {
        return [pscustomobject]@{ IsAssisted = $true; Reason = "Signature match: agent:" }
    }

    # Check Commits
    if ($CommitMessages) {
        foreach ($msg in $CommitMessages) {
            if ($msg -match $coAuthPattern) {
                return [pscustomobject]@{ IsAssisted = $true; Reason = "Signature match in commit: $($Matches[0])" }
            }
            if ($msg -match $genByPattern) {
                return [pscustomobject]@{ IsAssisted = $true; Reason = "Signature match in commit: $($Matches[0])" }
            }
            if ($msg -match '\[claude\]') {
                return [pscustomobject]@{ IsAssisted = $true; Reason = "Signature match in commit: [claude]" }
            }
            if ($msg -match '\[cursor\]') {
                return [pscustomobject]@{ IsAssisted = $true; Reason = "Signature match in commit: [cursor]" }
            }
            if ($msg -match '(?i)\bai:') {
                return [pscustomobject]@{ IsAssisted = $true; Reason = "Signature match in commit: ai:" }
            }
            if ($msg -match '(?i)\bagent:') {
                return [pscustomobject]@{ IsAssisted = $true; Reason = "Signature match in commit: agent:" }
            }
        }
    }

    return [pscustomobject]@{
        IsAssisted = $false
        Reason     = "No AI signature detected"
    }
}

function Get-FilteredLinesChanged {
    param(
        [array]$Files = @()
    )

    if (-not $Files) { return 0 }

    $lockfiles = @('package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'go.sum', 'Cargo.lock')
    $totalFiltered = 0

    foreach ($f in $Files) {
        $path = ''
        if ($f.path) { $path = $f.path }
        elseif ($f -is [hashtable] -and $f.ContainsKey('path')) { $path = $f['path'] }

        $add = 0
        if ($null -ne $f.additions) { $add = [int]$f.additions }
        $del = 0
        if ($null -ne $f.deletions) { $del = [int]$f.deletions }

        if ([string]::IsNullOrWhiteSpace($path)) { continue }

        $normPath = $path -replace '\\', '/'
        $leaf = Split-Path $normPath -Leaf

        # Exclude lockfiles
        if ($lockfiles -contains $leaf.ToLower()) { continue }

        # Exclude minified and map files
        if ($leaf -like '*.map' -or $leaf -like '*.min.js' -or $leaf -like '*.min.css') { continue }

        # Exclude dist/ or build/ directories
        if ($normPath -match '^(dist|build)/' -or $normPath -match '/(dist|build)/') { continue }

        $totalFiltered += ($add + $del)
    }

    return [int]$totalFiltered
}

function Get-AiAuthoredBucket {
    param(
        [int]$LinesChangedFiltered
    )

    if ($LinesChangedFiltered -le 0) { return "0" }
    elseif ($LinesChangedFiltered -le 25) { return "1-25" }
    elseif ($LinesChangedFiltered -le 50) { return "26-50" }
    elseif ($LinesChangedFiltered -le 75) { return "51-75" }
    elseif ($LinesChangedFiltered -le 100) { return "76-100" }
    else { return "101+" }
}

function Test-IsBotUser {
    param(
        [string]$Login,
        [string]$TypeName
    )

    if ([string]::IsNullOrWhiteSpace($Login)) { return $false }
    if ($TypeName -eq 'Bot') { return $true }
    if ($Login -match '(?i)\[bot\]') { return $true }
    return $false
}

function Get-HumanReviewers {
    param(
        [array]$Reviews = @()
    )

    if (-not $Reviews) { return @() }

    $humans = [System.Collections.Generic.List[string]]::new()

    foreach ($r in $Reviews) {
        $login = $null
        $typeName = $null

        if ($r.author) {
            $login = $r.author.login
            $typeName = $r.author.__typename
        }

        if ([string]::IsNullOrWhiteSpace($login)) { continue }

        # Filter bot accounts
        if (Test-IsBotUser -Login $login -TypeName $typeName) { continue }

        if (-not $humans.Contains($login)) {
            $humans.Add($login)
        }
    }

    return $humans.ToArray()
}

function Get-ReviewTimestamps {
    param(
        [string]$CreatedAt,
        [array]$Reviews = @()
    )

    if (-not $Reviews) {
        return [pscustomobject]@{
            FirstHumanReviewAt           = $null
            FirstReviewLatencyMinutes    = $null
        }
    }

    $humanReviews = @()
    foreach ($r in $Reviews) {
        $login = if ($r.author) { $r.author.login } else { '' }
        $typeName = if ($r.author) { $r.author.__typename } else { '' }

        if ([string]::IsNullOrWhiteSpace($login)) { continue }
        if (Test-IsBotUser -Login $login -TypeName $typeName) { continue }
        if ($r.submittedAt) {
            $humanReviews += $r
        }
    }

    if ($humanReviews.Count -eq 0) {
        return [pscustomobject]@{
            FirstHumanReviewAt           = $null
            FirstReviewLatencyMinutes    = $null
        }
    }

    # Find earliest submittedAt timestamp
    $earliestReview = $humanReviews | Sort-Object { [DateTimeOffset]::Parse($_.submittedAt) } | Select-Object -First 1
    $firstReviewAtStr = $earliestReview.submittedAt

    $createdDt = [DateTimeOffset]::Parse($CreatedAt)
    $firstReviewDt = [DateTimeOffset]::Parse($firstReviewAtStr)

    $latencyMinutes = [int][Math]::Round(($firstReviewDt - $createdDt).TotalMinutes)

    return [pscustomobject]@{
        FirstHumanReviewAt           = $firstReviewAtStr
        FirstReviewLatencyMinutes    = $latencyMinutes
    }
}

function Get-ReworkCommitsCount {
    param(
        [array]$Commits = @(),
        [string]$FirstHumanReviewAt
    )

    if (-not $FirstHumanReviewAt -or [string]::IsNullOrWhiteSpace($FirstHumanReviewAt)) {
        return 0
    }

    if (-not $Commits) { return 0 }

    $firstReviewDt = [DateTimeOffset]::Parse($FirstHumanReviewAt)
    $reworkCount = 0

    foreach ($c in $Commits) {
        $commitDateStr = if ($c.committedDate) { $c.committedDate } elseif ($c.commit -and $c.commit.committer) { $c.commit.committer.date } else { $null }
        if (-not $commitDateStr) { continue }

        $commitDt = [DateTimeOffset]::Parse($commitDateStr)
        if ($commitDt -gt $firstReviewDt) {
            $reworkCount++
        }
    }

    return [int]$reworkCount
}

function Get-EstimatedReviewMinutes {
    param(
        [int]$LinesChangedFiltered,
        [int]$HumanComments = 0
    )

    $base = [Math]::Round($LinesChangedFiltered / 30, [MidpointRounding]::AwayFromZero)
    $cappedBase = [Math]::Max(5, $base)
    $estimated = $cappedBase + ($HumanComments * 3)
    $finalMinutes = [Math]::Min(120, $estimated)

    return [int]$finalMinutes
}

function Get-TelemetryFromPullRequestPayload {
    param(
        [object]$PrNode
    )

    if ($PrNode -and $PrNode.TriggerExtractionException) {
        throw "Simulated telemetry extraction exception"
    }

    $prId = if ($PrNode.pr_id) { $PrNode.pr_id } elseif ($PrNode.repo -and $PrNode.number) { "$($PrNode.repo)#$($PrNode.number)" } else { "" }
    $repo = if ($PrNode.repo) { $PrNode.repo } else { "" }
    $author = if ($PrNode.author -is [hashtable] -or $PrNode.author -is [pscustomobject]) { $PrNode.author.login } else { [string]$PrNode.author }
    $createdAt = if ($PrNode.createdAt) { $PrNode.createdAt } elseif ($PrNode.created_at) { $PrNode.created_at } else { "" }
    $mergedAt = if ($PrNode.mergedAt) { $PrNode.mergedAt } elseif ($PrNode.merged_at) { $PrNode.merged_at } else { $null }

    $outcome = if ($mergedAt) { "merged" } elseif ($PrNode.closedAt -or $PrNode.closed_at) { "closed" } else { "open" }

    # Files & Lines
    $files = if ($PrNode.files) { $PrNode.files } else { @() }
    $linesTotal = 0
    foreach ($f in $files) {
        $add = if ($null -ne $f.additions) { [int]$f.additions } else { 0 }
        $del = if ($null -ne $f.deletions) { [int]$f.deletions } else { 0 }
        $linesTotal += ($add + $del)
    }
    if ($linesTotal -eq 0 -and $PrNode.lines_changed) { $linesTotal = [int]$PrNode.lines_changed }

    $filteredLines = Get-FilteredLinesChanged -Files $files

    # AI Signature
    $title = if ($PrNode.title) { $PrNode.title } else { "" }
    $body = if ($PrNode.body) { $PrNode.body } else { "" }
    $commits = if ($PrNode.commits) { $PrNode.commits } else { @() }
    $commitMsgs = @()
    foreach ($c in $commits) {
        if ($c -is [string]) { $commitMsgs += $c }
        elseif ($c.message) { $commitMsgs += $c.message }
        elseif ($c.commit -and $c.commit.message) { $commitMsgs += $c.commit.message }
        elseif ($c.messageHeadline -or $c.messageBody) {
            $msg = @($c.messageHeadline, $c.messageBody) -join "`n"
            $commitMsgs += $msg
        }
    }

    $sigResult = Test-AiSignature -Title $title -Body $body -CommitMessages $commitMsgs

    $aiAssisted = if ($sigResult.IsAssisted) { "yes" } else { "no" }
    $aiBucket = Get-AiAuthoredBucket -LinesChangedFiltered $filteredLines

    # Reviews
    $reviews = if ($PrNode.reviews) { $PrNode.reviews } else { @() }
    $humanReviewerList = Get-HumanReviewers -Reviews $reviews
    $humanReviewersStr = $humanReviewerList -join ','

    $reviewStats = Get-ReviewTimestamps -CreatedAt $createdAt -Reviews $reviews

    # Comments count for review minutes
    $comments = if ($PrNode.comments) { $PrNode.comments } else { @() }
    $humanCommentsCount = 0
    foreach ($cm in $comments) {
        $cmLogin = if ($cm.author) { $cm.author.login } else { '' }
        $cmType = if ($cm.author) { $cm.author.__typename } else { '' }
        if ($cmLogin -and -not (Test-IsBotUser -Login $cmLogin -TypeName $cmType)) {
            $humanCommentsCount++
        }
    }

    $humanReviewMinutes = if ($null -ne $reviewStats.FirstHumanReviewAt) {
        Get-EstimatedReviewMinutes -LinesChangedFiltered $filteredLines -HumanComments $humanCommentsCount
    } else {
        $null
    }

    # Rework commits
    $reworkCount = Get-ReworkCommitsCount -Commits $commits -FirstHumanReviewAt $reviewStats.FirstHumanReviewAt

    # Automated findings count (bot comments/reviews)
    $botFindingsCount = 0
    foreach ($r in $reviews) {
        $rLogin = if ($r.author) { $r.author.login } else { '' }
        $rType = if ($r.author) { $r.author.__typename } else { '' }
        if (Test-IsBotUser -Login $rLogin -TypeName $rType) { $botFindingsCount++ }
    }
    foreach ($cm in $comments) {
        $cmLogin = if ($cm.author) { $cm.author.login } else { '' }
        $cmType = if ($cm.author) { $cm.author.__typename } else { '' }
        if (Test-IsBotUser -Login $cmLogin -TypeName $cmType) { $botFindingsCount++ }
    }

    return [pscustomobject]@{
        pr_id                        = $prId
        repo                         = $repo
        author                       = $author
        created_at                   = $createdAt
        merged_at                    = $mergedAt
        outcome                      = $outcome
        lines_changed                = $linesTotal
        lines_changed_filtered       = $filteredLines
        ai_assisted                  = $aiAssisted
        ai_authored_bucket           = $aiBucket
        human_reviewers              = $humanReviewersStr
        human_review_minutes         = $humanReviewMinutes
        first_review_latency_minutes = $reviewStats.FirstReviewLatencyMinutes
        automated_findings_count     = $botFindingsCount
        rework_commits_count         = $reworkCount
        collection_status            = "ok"
        classification_reason        = $sigResult.Reason
        telemetry_version            = "v1.1"
        query_timestamp              = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
    }
}

function Parse-GraphQLTelemetryPayload {
    param(
        [string]$JsonPayload
    )

    try {
        $parsed = $JsonPayload | ConvertFrom-Json
    } catch {
        return [pscustomobject]@{
            collection_status     = "error"
            classification_reason = "JSON parse error: $_"
        }
    }

    if ($parsed.errors) {
        $errMsgs = ($parsed.errors | ForEach-Object { $_.message }) -join '; '
        return [pscustomobject]@{
            collection_status     = "error"
            classification_reason = "GraphQL query error: $errMsgs"
        }
    }

    if ($parsed.data -and $parsed.data.repository -and $parsed.data.repository.pullRequests -and $parsed.data.repository.pullRequests.nodes) {
        $telemetryRows = @()
        foreach ($node in $parsed.data.repository.pullRequests.nodes) {
            $telemetryRows += Get-TelemetryFromPullRequestPayload -PrNode $node
        }
        return $telemetryRows
    }

    return [pscustomobject]@{
        collection_status     = "ok"
        classification_reason = "Payload parsed successfully"
    }
}

function Publish-AiTelemetryCsv {
    param(
        [string]$OutputPath,
        [array]$Rows
    )

    if ([string]::IsNullOrWhiteSpace($OutputPath)) {
        throw "OutputPath parameter cannot be null or empty"
    }

    $parentDir = [System.IO.Path]::GetDirectoryName($OutputPath)
    if (-not [string]::IsNullOrWhiteSpace($parentDir) -and -not [System.IO.Directory]::Exists($parentDir)) {
        [System.IO.Directory]::CreateDirectory($parentDir) | Out-Null
    }

    $tempFile = "$OutputPath.tmp.$([guid]::NewGuid().ToString('N'))"

    try {
        $Rows | Export-Csv -LiteralPath $tempFile -NoTypeInformation -Encoding UTF8
        Move-Item -LiteralPath $tempFile -Destination $OutputPath -Force
    } finally {
        if ([System.IO.File]::Exists($tempFile)) {
            Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
        }
    }
}

# Main Script Execution (if executed directly or with parameters)
if ($PSBoundParameters.ContainsKey('FixturePayload')) {
    $rows = @()
    if ($FixturePayload -is [string]) {
        $rows = Parse-GraphQLTelemetryPayload -JsonPayload $FixturePayload
    } elseif ($FixturePayload -is [array]) {
        foreach ($node in $FixturePayload) {
            $rows += Get-TelemetryFromPullRequestPayload -PrNode $node
        }
    } else {
        $rows += Get-TelemetryFromPullRequestPayload -PrNode $FixturePayload
    }

    if ($OutputPath) {
        Publish-AiTelemetryCsv -OutputPath $OutputPath -Rows $rows
    } else {
        $rows
    }
}
