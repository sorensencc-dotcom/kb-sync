# ==============================================================================
# Unit Test Suite for AI Telemetry Extractor v1.1
# ==============================================================================
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ExtractorScript = Join-Path $ScriptDir "..\scripts\extract-ai-telemetry.ps1"

Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "AI Telemetry Extractor v1.1 Unit Test Suite" -ForegroundColor Cyan
Write-Host "================================================================================" -ForegroundColor Cyan

# Preflight check: Ensure target script exists
if (-not (Test-Path -LiteralPath $ExtractorScript)) {
    Write-Host "[FAIL] Target script extract-ai-telemetry.ps1 not found at path: '$ExtractorScript'" -ForegroundColor Red
    exit 1
}

# Dot-source the target script to access internal telemetry functions
. $ExtractorScript

$script:testCount = 0
$script:failCount = 0

function Assert-Equal {
    param(
        $Actual,
        $Expected,
        [string]$Message
    )
    $script:testCount++
    if ($Actual -eq $Expected) {
        Write-Host "  [PASS] $Message" -ForegroundColor Green
    } else {
        $script:failCount++
        Write-Host "  [FAIL] $Message (Expected: '$Expected', Got: '$Actual')" -ForegroundColor Red
    }
}

function Assert-Null {
    param(
        $Actual,
        [string]$Message
    )
    $script:testCount++
    if ($null -eq $Actual -or $Actual -eq '') {
        Write-Host "  [PASS] $Message" -ForegroundColor Green
    } else {
        $script:failCount++
        Write-Host "  [FAIL] $Message (Expected: null/empty, Got: '$Actual')" -ForegroundColor Red
    }
}

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message
    )
    $script:testCount++
    if ($Condition) {
        Write-Host "  [PASS] $Message" -ForegroundColor Green
    } else {
        $script:failCount++
        Write-Host "  [FAIL] $Message" -ForegroundColor Red
    }
}

# ------------------------------------------------------------------------------
# Test 1: Exact Schema v1.1 CSV Header Validation
# ------------------------------------------------------------------------------
Write-Host "`n[TEST 1] Schema v1.1 CSV Header Validation..." -ForegroundColor Yellow
$expectedHeaders = @(
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
$actualHeaders = Get-AiTelemetryCsvHeaders
Assert-Equal -Actual ($actualHeaders -join ',') -Expected ($expectedHeaders -join ',') -Message "CSV header matches Schema v1.1 exact column list and order"

# ------------------------------------------------------------------------------
# Test 2: AI Signature Matching
# ------------------------------------------------------------------------------
Write-Host "`n[TEST 2] AI Signature Matching..." -ForegroundColor Yellow
$signatureFixtures = @(
    @{ title = "feat: user auth"; body = "Co-authored-by: Claude"; commits = @(); expectedAssisted = "yes"; expectedReason = "Signature match: Co-authored-by: Claude" },
    @{ title = "fix: crash"; body = "Generated-by: Antigravity"; commits = @(); expectedAssisted = "yes"; expectedReason = "Signature match: Generated-by: Antigravity" },
    @{ title = "[claude] refactor api"; body = ""; commits = @(); expectedAssisted = "yes"; expectedReason = "Signature match: [claude]" },
    @{ title = "ai: optimize query"; body = ""; commits = @(); expectedAssisted = "yes"; expectedReason = "Signature match: ai:" },
    @{ title = "regular pr"; body = ""; commits = @("Co-authored-by: Claude <claude@anthropic.com>"); expectedAssisted = "yes"; expectedReason = "Signature match in commit: Co-authored-by: Claude" },
    @{ title = "manual edit"; body = "fixed bug"; commits = @("refactor service"); expectedAssisted = "no"; expectedReason = "No AI signature detected" }
)

foreach ($fix in $signatureFixtures) {
    $result = Test-AiSignature -Title $fix.title -Body $fix.body -CommitMessages $fix.commits
    Assert-Equal -Actual $result.IsAssisted -Expected ($fix.expectedAssisted -eq "yes") -Message "Signature check for '$($fix.title)' (Assisted: $($fix.expectedAssisted))"
}

# ------------------------------------------------------------------------------
# Test 3: Normalized Path Filtering
# ------------------------------------------------------------------------------
Write-Host "`n[TEST 3] Normalized Path Filtering..." -ForegroundColor Yellow
$filesFixture = @(
    @{ path = "src/components/Header.tsx"; additions = 15; deletions = 5 },   # 20 lines (included)
    @{ path = "package-lock.json"; additions = 300; deletions = 100 },       # 400 lines (excluded)
    @{ path = "yarn.lock"; additions = 50; deletions = 10 },                 # 60 lines (excluded)
    @{ path = "dist/bundle.js"; additions = 100; deletions = 0 },            # 100 lines (excluded)
    @{ path = "public/vendor.min.js"; additions = 50; deletions = 0 }        # 50 lines (excluded)
)
$filteredLines = Get-FilteredLinesChanged -Files $filesFixture
Assert-Equal -Actual $filteredLines -Expected 20 -Message "Lines changed filtered excludes lockfiles, dist, and minified JS"

# ------------------------------------------------------------------------------
# Test 4: Bucket Boundaries and Zero-Line Behavior
# ------------------------------------------------------------------------------
Write-Host "`n[TEST 4] Bucket Boundaries and Zero-Line Behavior..." -ForegroundColor Yellow
$bucketFixtures = @(
    @{ lines = 0; expectedBucket = "0" },
    @{ lines = 1; expectedBucket = "1-25" },
    @{ lines = 25; expectedBucket = "1-25" },
    @{ lines = 26; expectedBucket = "26-50" },
    @{ lines = 50; expectedBucket = "26-50" },
    @{ lines = 51; expectedBucket = "51-75" },
    @{ lines = 75; expectedBucket = "51-75" },
    @{ lines = 76; expectedBucket = "76-100" },
    @{ lines = 100; expectedBucket = "76-100" },
    @{ lines = 101; expectedBucket = "76-100" }
)

foreach ($b in $bucketFixtures) {
    $bucket = Get-AiAuthoredBucket -LinesChangedFiltered $b.lines
    Assert-Equal -Actual $bucket -Expected $b.expectedBucket -Message "Bucket for $($b.lines) filtered lines is '$($b.expectedBucket)'"
}

# Zero-line behavior check: 0 lines filtered -> bucket "0" and ai_assisted = "no" (if no signature)
$zeroLinePr = @{
    title = "chore: bump lockfile"
    body = ""
    files = @( @{ path = "package-lock.json"; additions = 10; deletions = 5 } )
    commits = @()
}
$zeroTelemetry = Get-TelemetryFromPullRequestPayload -PrNode $zeroLinePr
Assert-Equal -Actual $zeroTelemetry.lines_changed_filtered -Expected 0 -Message "Zero-line PR filtered lines count is 0"
Assert-Equal -Actual $zeroTelemetry.ai_authored_bucket -Expected "0" -Message "Zero-line PR bucket is '0'"
Assert-Equal -Actual $zeroTelemetry.ai_assisted -Expected "no" -Message "Zero-line PR with no signatures has ai_assisted = 'no'"

# ------------------------------------------------------------------------------
# Test 5: Human/Bot Reviewer Deduplication
# ------------------------------------------------------------------------------
Write-Host "`n[TEST 5] Human/Bot Reviewer Deduplication..." -ForegroundColor Yellow
$reviewsFixture = @(
    @{ author = @{ login = "alice"; __typename = "User" }; submittedAt = "2026-08-08T10:00:00Z" },
    @{ author = @{ login = "github-actions[bot]"; __typename = "Bot" }; submittedAt = "2026-08-08T09:00:00Z" },
    @{ author = @{ login = "bob"; __typename = "User" }; submittedAt = "2026-08-08T11:00:00Z" },
    @{ author = @{ login = "alice"; __typename = "User" }; submittedAt = "2026-08-08T12:00:00Z" },
    @{ author = @{ login = "dependabot[bot]"; __typename = "User" }; submittedAt = "2026-08-08T08:00:00Z" }
)
$humanReviewers = Get-HumanReviewers -Reviews $reviewsFixture
Assert-Equal -Actual ($humanReviewers -join ',') -Expected "alice,bob" -Message "Human reviewers correctly deduplicated and bot accounts filtered out"

# ------------------------------------------------------------------------------
# Test 6: Earliest Submitted Human Review & Missing-Review Null Handling
# ------------------------------------------------------------------------------
Write-Host "`n[TEST 6] Earliest Submitted Human Review & Missing-Review Null Handling..." -ForegroundColor Yellow
$createdAt = "2026-08-08T08:00:00Z"

# Case A: Reviews present
$reviewStats = Get-ReviewTimestamps -CreatedAt $createdAt -Reviews $reviewsFixture
Assert-Equal -Actual $reviewStats.FirstHumanReviewAt -Expected "2026-08-08T10:00:00Z" -Message "Earliest human review timestamp identified correctly"
Assert-Equal -Actual $reviewStats.FirstReviewLatencyMinutes -Expected 120 -Message "First review latency computed as 120 minutes"

# Case B: No human reviews present
$botOnlyReviews = @(
    @{ author = @{ login = "codecov[bot]"; __typename = "Bot" }; submittedAt = "2026-08-08T09:00:00Z" }
)
$noReviewStats = Get-ReviewTimestamps -CreatedAt $createdAt -Reviews $botOnlyReviews
Assert-Null -Actual $noReviewStats.FirstHumanReviewAt -Message "Missing human review results in null FirstHumanReviewAt"
Assert-Null -Actual $noReviewStats.FirstReviewLatencyMinutes -Message "Missing human review results in null FirstReviewLatencyMinutes"

# ------------------------------------------------------------------------------
# Test 7: Rework Commits Count
# ------------------------------------------------------------------------------
Write-Host "`n[TEST 7] Rework Commits Count..." -ForegroundColor Yellow
$commitsFixture = @(
    @{ committedDate = "2026-08-08T07:30:00Z"; message = "Initial commit" },
    @{ committedDate = "2026-08-08T09:30:00Z"; message = "Address pre-review" }, # before review at 10:00
    @{ committedDate = "2026-08-08T10:30:00Z"; message = "Fix review comments" }, # rework 1
    @{ committedDate = "2026-08-08T11:45:00Z"; message = "Additional refactor" }   # rework 2
)
$firstReviewAt = "2026-08-08T10:00:00Z"
$reworkCount = Get-ReworkCommitsCount -Commits $commitsFixture -FirstHumanReviewAt $firstReviewAt
Assert-Equal -Actual $reworkCount -Expected 2 -Message "Accurately counts commits strictly after first human review timestamp"

$reworkNoReview = Get-ReworkCommitsCount -Commits $commitsFixture -FirstHumanReviewAt $null
Assert-Equal -Actual $reworkNoReview -Expected 0 -Message "Rework commits count is 0 when no human review exists"

# ------------------------------------------------------------------------------
# Test 8: Review Minutes Estimation Formula
# ------------------------------------------------------------------------------
Write-Host "`n[TEST 8] Review Minutes Estimation Formula..." -ForegroundColor Yellow
# Formula: Min(120, Max(5, Round(lines_changed_filtered / 30)) + human_comments * 3)

# Small PR, 0 comments: Max(5, Round(10/30=0)) + 0 = 5
$m1 = Get-EstimatedReviewMinutes -LinesChangedFiltered 10 -HumanComments 0
Assert-Equal -Actual $m1 -Expected 5 -Message "Formula lower bound is 5 minutes for small PR"

# Medium PR (150 lines), 3 comments: Max(5, Round(150/30=5)) + 3*3=9 -> 14
$m2 = Get-EstimatedReviewMinutes -LinesChangedFiltered 150 -HumanComments 3
Assert-Equal -Actual $m2 -Expected 14 -Message "Formula calculates 14 minutes for 150 lines and 3 comments"

# Large PR (3000 lines), 50 comments: Min(120, 100 + 150 = 250) -> 120
$m3 = Get-EstimatedReviewMinutes -LinesChangedFiltered 3000 -HumanComments 50
Assert-Equal -Actual $m3 -Expected 120 -Message "Formula upper bound capped at 120 minutes"

# ------------------------------------------------------------------------------
# Test 9: Malformed GraphQL Response & Query Failure Handling
# ------------------------------------------------------------------------------
Write-Host "`n[TEST 9] Malformed GraphQL Response & Query Failure Handling..." -ForegroundColor Yellow
$malformedResponseJson = '{ "errors": [ { "message": "GraphQL query rate limit exceeded" } ] }'
$errorResult = Parse-GraphQLTelemetryPayload -JsonPayload $malformedResponseJson
Assert-Equal -Actual $errorResult.collection_status -Expected "error" -Message "Collection status is 'error' on GraphQL response errors"
Assert-True -Condition ($errorResult.classification_reason -like "*GraphQL query rate limit exceeded*") -Message "Error classification_reason captures error details"

# ------------------------------------------------------------------------------
# Test 10: Atomic Publication Safety Assertion
# ------------------------------------------------------------------------------
Write-Host "`n[TEST 10] Atomic Publication Safety Assertion..." -ForegroundColor Yellow
$tempTargetCsv = Join-Path $env:TEMP "test_telemetry_publish_$([guid]::NewGuid().ToString('N')).csv"
try {
    $rowsToPublish = @(
        [pscustomobject]@{
            pr_id = "owner/repo#1"
            repo = "owner/repo"
            author = "alice"
            created_at = "2026-08-08T00:00:00Z"
            merged_at = "2026-08-08T01:00:00Z"
            outcome = "merged"
            lines_changed = 100
            lines_changed_filtered = 20
            ai_assisted = "yes"
            ai_authored_bucket = "1-25"
            human_reviewers = "bob"
            human_review_minutes = 10
            first_review_latency_minutes = 30
            automated_findings_count = 0
            rework_commits_count = 1
            collection_status = "success"
            classification_reason = "Signature match: [claude]"
            telemetry_version = "1.0"
            query_timestamp = "2026-08-08T02:00:00Z"
        }
    )
    Publish-AiTelemetryCsv -OutputPath $tempTargetCsv -Rows $rowsToPublish
    Assert-True -Condition (Test-Path -LiteralPath $tempTargetCsv) -Message "Target CSV file published successfully"
    $imported = Import-Csv -LiteralPath $tempTargetCsv
    Assert-Equal -Actual $imported.pr_id -Expected "owner/repo#1" -Message "Published CSV content verified"
} finally {
    if (Test-Path -LiteralPath $tempTargetCsv) { Remove-Item -LiteralPath $tempTargetCsv -Force }
}

# ------------------------------------------------------------------------------
# Test 11: Integration — Baseline Merging & 14-day Window Boundaries
# ------------------------------------------------------------------------------
Write-Host "`n[TEST 11] Baseline Merging & 14-Day Window Boundaries..." -ForegroundColor Yellow
$ExtractGithubPrsScript = Join-Path $ScriptDir "..\scripts\extract-github-prs.ps1"
Assert-True -Condition (Test-Path -LiteralPath $ExtractGithubPrsScript) -Message "Target script extract-github-prs.ps1 exists"

$testMergeCsv = Join-Path $env:TEMP "test_telemetry_merge_$([guid]::NewGuid().ToString('N')).csv"
try {
    # Existing baseline row outside 14-day window (created 30 days ago)
    $oldOutsideRow = [pscustomobject]@{
        pr_id = "owner/repo#10"
        repo = "owner/repo"
        author = "dev1"
        created_at = "2026-06-01T00:00:00Z"
        merged_at = "2026-06-01T01:00:00Z"
        outcome = "merged"
        lines_changed = "100"
        lines_changed_filtered = "100"
        ai_assisted = "no"
        ai_authored_bucket = "76-100"
        human_reviewers = "rev1"
        human_review_minutes = "15"
        first_review_latency_minutes = "30"
        automated_findings_count = "0"
        rework_commits_count = "0"
        collection_status = "ok"
        classification_reason = "No AI signature detected"
        telemetry_version = "1.0"
        query_timestamp = "2026-06-01T02:00:00Z"
    }

    # Existing baseline row inside 14-day window (created 5 days ago, old values)
    $insideOldDate = (Get-Date).ToUniversalTime().AddDays(-5).ToString('yyyy-MM-ddTHH:mm:ssZ')
    $oldInsideRow = [pscustomobject]@{
        pr_id = "owner/repo#20"
        repo = "owner/repo"
        author = "dev2"
        created_at = $insideOldDate
        merged_at = ""
        outcome = "open"
        lines_changed = "50"
        lines_changed_filtered = ""
        ai_assisted = "no"
        ai_authored_bucket = ""
        human_reviewers = ""
        human_review_minutes = ""
        first_review_latency_minutes = ""
        automated_findings_count = ""
        rework_commits_count = ""
        collection_status = "ok"
        classification_reason = ""
        telemetry_version = "1.0"
        query_timestamp = "2026-08-01T00:00:00Z"
    }

    Publish-AiTelemetryCsv -OutputPath $testMergeCsv -Rows @($oldOutsideRow, $oldInsideRow)

    # Fixtures to extract: PR #20 (updated inside window) and PR #30 (new inside window)
    $insideNewDate = (Get-Date).ToUniversalTime().AddDays(-2).ToString('yyyy-MM-ddTHH:mm:ssZ')
    $fixturePrs = @(
        @{
            repo = "owner/repo"
            number = 20
            author = @{ login = "dev2"; __typename = "User" }
            createdAt = $insideOldDate
            mergedAt = $null
            closedAt = $null
            title = "feat: add feature [claude]"
            body = ""
            additions = 20
            deletions = 5
            files = @( @{ path = "src/app.ts"; additions = 20; deletions = 5 } )
            reviews = @()
            comments = @()
            commits = @()
        },
        @{
            repo = "owner/repo"
            number = 30
            author = @{ login = "dev3"; __typename = "User" }
            createdAt = $insideNewDate
            mergedAt = $null
            closedAt = $null
            title = "fix: manual fix"
            body = ""
            additions = 10
            deletions = 2
            files = @( @{ path = "src/fix.ts"; additions = 10; deletions = 2 } )
            reviews = @()
            comments = @()
            commits = @()
        }
    )

    # Run extract-github-prs.ps1 with fixture PRs
    & $ExtractGithubPrsScript -OutputPath $testMergeCsv -FixturePrs $fixturePrs

    $mergedContent = @(Import-Csv -LiteralPath $testMergeCsv)
    Assert-Equal -Actual $mergedContent.Count -Expected 3 -Message "Merged CSV contains 3 rows (1 retained outside window, 1 updated inside window, 1 new inside window)"

    $row10 = $mergedContent | Where-Object { $_.pr_id -eq "owner/repo#10" }
    Assert-True -Condition ($null -ne $row10) -Message "Existing row outside 14-day window retained"
    Assert-Equal -Actual $row10.ai_assisted -Expected "no" -Message "Retained row properties preserved"

    $row20 = $mergedContent | Where-Object { $_.pr_id -eq "owner/repo#20" }
    Assert-True -Condition ($null -ne $row20) -Message "Existing row inside 14-day window updated"
    Assert-Equal -Actual $row20.ai_assisted -Expected "yes" -Message "Updated row has enriched Schema v1.1 telemetry (ai_assisted=yes)"
    Assert-Equal -Actual $row20.lines_changed_filtered -Expected "25" -Message "Updated row has lines_changed_filtered populated"

    $row30 = $mergedContent | Where-Object { $_.pr_id -eq "owner/repo#30" }
    Assert-True -Condition ($null -ne $row30) -Message "New PR inside 14-day window added"
    Assert-Equal -Actual $row30.ai_assisted -Expected "no" -Message "New PR telemetry populated correctly"
} finally {
    if (Test-Path -LiteralPath $testMergeCsv) { Remove-Item -LiteralPath $testMergeCsv -Force }
}

# ------------------------------------------------------------------------------
# Test 12: Atomic Publication Failure & Cleanup Safety Assertion
# ------------------------------------------------------------------------------
Write-Host "`n[TEST 12] Atomic Publication Failure & Cleanup Safety Assertion..." -ForegroundColor Yellow
$testAtomicCsv = Join-Path $env:TEMP "test_telemetry_atomic_$([guid]::NewGuid().ToString('N')).csv"
try {
    $initialRow = [pscustomobject]@{
        pr_id = "owner/repo#999"
        repo = "owner/repo"
        author = "baseline_user"
        created_at = "2026-06-01T00:00:00Z"
        merged_at = ""
        outcome = "open"
        lines_changed = "10"
        lines_changed_filtered = "10"
        ai_assisted = "no"
        ai_authored_bucket = "1-25"
        human_reviewers = ""
        human_review_minutes = ""
        first_review_latency_minutes = ""
        automated_findings_count = "0"
        rework_commits_count = "0"
        collection_status = "ok"
        classification_reason = "Original baseline"
        telemetry_version = "1.0"
        query_timestamp = "2026-06-01T00:00:00Z"
    }
    Publish-AiTelemetryCsv -OutputPath $testAtomicCsv -Rows @($initialRow)

    # Attempt running extraction with fixture that triggers enrichment error
    $failingFixturePrs = @(
        @{
            TriggerExtractionException = $true
        }
    )

    $failed = $false
    try {
        & $ExtractGithubPrsScript -OutputPath $testAtomicCsv -FixturePrs $failingFixturePrs
    } catch {
        $failed = $true
    }

    Assert-True -Condition $failed -Message "Extraction failure raised an exception as expected"

    # Verify target CSV remains intact
    $currentContent = @(Import-Csv -LiteralPath $testAtomicCsv)
    Assert-Equal -Actual $currentContent.Count -Expected 1 -Message "Existing target CSV remains intact after extraction failure"
    Assert-Equal -Actual $currentContent[0].pr_id -Expected "owner/repo#999" -Message "Existing target CSV content uncorrupted"

    # Verify no temporary files remain
    $parentDir = Split-Path -Parent $testAtomicCsv
    $leftoverTmp = Get-ChildItem -Path $parentDir -Filter "$([System.IO.Path]::GetFileName($testAtomicCsv)).tmp.*" -ErrorAction SilentlyContinue
    Assert-Equal -Actual ($leftoverTmp.Count) -Expected 0 -Message "No leftover temporary files remaining after failure"

} finally {
    if (Test-Path -LiteralPath $testAtomicCsv) { Remove-Item -LiteralPath $testAtomicCsv -Force }
}

# ------------------------------------------------------------------------------
# Test 13: Weekly Metrics - Empty Week (0 merged PRs)
# ------------------------------------------------------------------------------
Write-Host "`n[TEST 13] Weekly Metrics - Empty Week (0 merged PRs)..." -ForegroundColor Yellow
$ComputeMetricsScript = Join-Path $ScriptDir "..\scripts\compute-weekly-metrics.ps1"
Assert-True -Condition (Test-Path -LiteralPath $ComputeMetricsScript) -Message "compute-weekly-metrics.ps1 script exists"

$emptyCsv = Join-Path $env:TEMP "test_metrics_empty_$([guid]::NewGuid().ToString('N')).csv"
try {
    $emptyRow = [pscustomobject]@{
        pr_id = "owner/repo#100"
        repo = "owner/repo"
        author = "dev"
        created_at = "2026-01-01T00:00:00Z"
        merged_at = "2026-01-01T01:00:00Z"
        outcome = "merged"
        lines_changed = "10"
        lines_changed_filtered = "10"
        ai_assisted = "no"
        ai_authored_bucket = "1-25"
        human_reviewers = ""
        human_review_minutes = ""
        first_review_latency_minutes = ""
        automated_findings_count = ""
        rework_commits_count = ""
        collection_status = "ok"
        classification_reason = ""
        telemetry_version = "1.0"
        query_timestamp = "2026-01-01T00:00:00Z"
    }
    Publish-AiTelemetryCsv -OutputPath $emptyCsv -Rows @($emptyRow)

    $rawJson = & $ComputeMetricsScript -CsvPath $emptyCsv -WeekStart (Get-Date "2026-08-03")
    $metrics = $rawJson | ConvertFrom-Json

    Assert-Equal -Actual $metrics.merged_prs_week -Expected 0 -Message "Empty week merged_prs_week is 0"
    Assert-Equal -Actual $metrics.active_engineers_week -Expected 0 -Message "Empty week active_engineers_week is 0"
    Assert-Equal -Actual $metrics.prs_per_engineer -Expected 0 -Message "Empty week prs_per_engineer is 0 (no divide-by-zero)"
    Assert-Equal -Actual $metrics.review_hours_per_engineer -Expected 0 -Message "Empty week review_hours_per_engineer is 0 (no divide-by-zero)"
    Assert-Equal -Actual $metrics.ai_pr_share -Expected 0 -Message "Empty week ai_pr_share is 0 (no divide-by-zero)"
    Assert-Equal -Actual $metrics.rework_rate -Expected 0 -Message "Empty week rework_rate is 0 (no divide-by-zero)"
    Assert-Equal -Actual $metrics.median_first_review_latency_minutes -Expected 0 -Message "Empty week median latency is 0"
    Assert-Equal -Actual $metrics.telemetry_collection_ok -Expected 0 -Message "Empty week telemetry_collection_ok is 0"
} finally {
    if (Test-Path -LiteralPath $emptyCsv) { Remove-Item -LiteralPath $emptyCsv -Force }
}

# ------------------------------------------------------------------------------
# Test 14: Weekly Metrics - All-Null Review Fields
# ------------------------------------------------------------------------------
Write-Host "`n[TEST 14] Weekly Metrics - All-Null Review Fields..." -ForegroundColor Yellow
$nullFieldsCsv = Join-Path $env:TEMP "test_metrics_null_$([guid]::NewGuid().ToString('N')).csv"
try {
    $nullRow = [pscustomobject]@{
        pr_id = "owner/repo#1"
        repo = "owner/repo"
        author = "dev1"
        created_at = "2026-08-03T10:00:00Z"
        merged_at = "2026-08-04T10:00:00Z"
        outcome = "merged"
        lines_changed = "100"
        lines_changed_filtered = "80"
        ai_assisted = "yes"
        ai_authored_bucket = "76-100"
        human_reviewers = ""
        human_review_minutes = ""
        first_review_latency_minutes = ""
        automated_findings_count = ""
        rework_commits_count = ""
        collection_status = "ok"
        classification_reason = ""
        telemetry_version = "1.0"
        query_timestamp = "2026-08-04T11:00:00Z"
    }
    Publish-AiTelemetryCsv -OutputPath $nullFieldsCsv -Rows @($nullRow)

    $rawJson = & $ComputeMetricsScript -CsvPath $nullFieldsCsv -WeekStart (Get-Date "2026-08-03")
    $metrics = $rawJson | ConvertFrom-Json

    Assert-Equal -Actual $metrics.merged_prs_week -Expected 1 -Message "Merged PR count is 1"
    Assert-Equal -Actual $metrics.active_engineers_week -Expected 1 -Message "Active engineers count is 1"
    Assert-Equal -Actual $metrics.review_hours_per_engineer -Expected 0 -Message "Review hours per engineer is 0 when review_minutes is empty"
    Assert-Equal -Actual $metrics.median_first_review_latency_minutes -Expected 0 -Message "Median latency is 0 when latency field is empty"
    Assert-Equal -Actual $metrics.rework_rate -Expected 0 -Message "Rework rate is 0 when rework field is empty"
    Assert-Equal -Actual $metrics.ai_pr_share -Expected 1 -Message "AI PR share is 1.0 for 1 AI-assisted PR"
} finally {
    if (Test-Path -LiteralPath $nullFieldsCsv) { Remove-Item -LiteralPath $nullFieldsCsv -Force }
}

# ------------------------------------------------------------------------------
# Test 15: Weekly Metrics - Mixed Telemetry Collection Status Rows (ok, degraded, error)
# ------------------------------------------------------------------------------
Write-Host "`n[TEST 15] Weekly Metrics - Mixed Telemetry Collection Status Rows..." -ForegroundColor Yellow
$mixedCsv = Join-Path $env:TEMP "test_metrics_mixed_$([guid]::NewGuid().ToString('N')).csv"
try {
    $rows = @(
        [pscustomobject]@{
            pr_id = "owner/repo#1"; repo = "owner/repo"; author = "dev1"
            created_at = "2026-08-03T10:00:00Z"; merged_at = "2026-08-04T10:00:00Z"; outcome = "merged"
            lines_changed = "10"; lines_changed_filtered = "10"; ai_assisted = "no"; ai_authored_bucket = "1-25"
            human_reviewers = "rev1"; human_review_minutes = "30"; first_review_latency_minutes = "60"
            automated_findings_count = "0"; rework_commits_count = "0"
            collection_status = "ok"; classification_reason = ""; telemetry_version = "v1.1"; query_timestamp = "2026-08-04T11:00:00Z"
        },
        [pscustomobject]@{
            pr_id = "owner/repo#2"; repo = "owner/repo"; author = "dev2"
            created_at = "2026-08-03T11:00:00Z"; merged_at = "2026-08-04T11:00:00Z"; outcome = "merged"
            lines_changed = "50"; lines_changed_filtered = "40"; ai_assisted = "yes"; ai_authored_bucket = "26-50"
            human_reviewers = "rev1"; human_review_minutes = "15"; first_review_latency_minutes = "120"
            automated_findings_count = "1"; rework_commits_count = "1"
            collection_status = "degraded"; classification_reason = "Missing reviewer payload"; telemetry_version = "v1.1"; query_timestamp = "2026-08-04T12:00:00Z"
        },
        [pscustomobject]@{
            pr_id = "owner/repo#3"; repo = "owner/repo"; author = "dev3"
            created_at = "2026-08-03T12:00:00Z"; merged_at = "2026-08-04T12:00:00Z"; outcome = "merged"
            lines_changed = "100"; lines_changed_filtered = ""; ai_assisted = ""; ai_authored_bucket = ""
            human_reviewers = ""; human_review_minutes = ""; first_review_latency_minutes = ""
            automated_findings_count = ""; rework_commits_count = ""
            collection_status = "error"; classification_reason = "GraphQL failure"; telemetry_version = "v1.1"; query_timestamp = "2026-08-04T13:00:00Z"
        }
    )
    Publish-AiTelemetryCsv -OutputPath $mixedCsv -Rows $rows

    $rawJson = & $ComputeMetricsScript -CsvPath $mixedCsv -WeekStart (Get-Date "2026-08-03")
    $metrics = $rawJson | ConvertFrom-Json

    Assert-Equal -Actual $metrics.merged_prs_week -Expected 3 -Message "Merged PR count is 3"
    Assert-Equal -Actual $metrics.telemetry_collection_ok -Expected 1 -Message "telemetry_collection_ok count is 1"
    Assert-Equal -Actual $metrics.telemetry_collection_degraded -Expected 1 -Message "telemetry_collection_degraded count is 1"
    Assert-Equal -Actual $metrics.telemetry_collection_error -Expected 1 -Message "telemetry_collection_error count is 1"
} finally {
    if (Test-Path -LiteralPath $mixedCsv) { Remove-Item -LiteralPath $mixedCsv -Force }
}

# ------------------------------------------------------------------------------
# Test 16: Weekly Metrics - Populated Week with Valid Schema v1.1 Metrics JSON
# ------------------------------------------------------------------------------
Write-Host "`n[TEST 16] Weekly Metrics - Populated Week Schema v1.1 JSON Output..." -ForegroundColor Yellow
$populatedCsv = Join-Path $env:TEMP "test_metrics_populated_$([guid]::NewGuid().ToString('N')).csv"
try {
    $rows = @(
        [pscustomobject]@{
            pr_id = "owner/repo#10"; repo = "owner/repo"; author = "dev1"
            created_at = "2026-08-03T10:00:00Z"; merged_at = "2026-08-04T10:00:00Z"; outcome = "merged"
            lines_changed = "100"; lines_changed_filtered = "50"; ai_assisted = "yes"; ai_authored_bucket = "26-50"
            human_reviewers = "rev1"; human_review_minutes = "60"; first_review_latency_minutes = "30"
            automated_findings_count = "0"; rework_commits_count = "2"
            collection_status = "ok"; classification_reason = "Signature match"; telemetry_version = "v1.1"; query_timestamp = "2026-08-04T11:00:00Z"
        },
        [pscustomobject]@{
            pr_id = "owner/repo#11"; repo = "owner/repo"; author = "dev2"
            created_at = "2026-08-03T11:00:00Z"; merged_at = "2026-08-05T11:00:00Z"; outcome = "merged"
            lines_changed = "200"; lines_changed_filtered = "150"; ai_assisted = "no"; ai_authored_bucket = "0"
            human_reviewers = "rev2"; human_review_minutes = "120"; first_review_latency_minutes = "90"
            automated_findings_count = "1"; rework_commits_count = "0"
            collection_status = "ok"; classification_reason = "No AI signature"; telemetry_version = "1.0"; query_timestamp = "2026-08-05T12:00:00Z"
        }
    )
    Publish-AiTelemetryCsv -OutputPath $populatedCsv -Rows $rows

    $rawJson = & $ComputeMetricsScript -CsvPath $populatedCsv -WeekStart (Get-Date "2026-08-03") -SustainablePrsPerEngineer 3
    $metrics = $rawJson | ConvertFrom-Json

    Assert-Equal -Actual $metrics.week_start -Expected "2026-08-03" -Message "week_start is 2026-08-03"
    Assert-Equal -Actual $metrics.merged_prs_week -Expected 2 -Message "merged_prs_week is 2"
    Assert-Equal -Actual $metrics.active_engineers_week -Expected 2 -Message "active_engineers_week is 2"
    Assert-Equal -Actual $metrics.sustainable_prs_per_engineer -Expected 3 -Message "sustainable_prs_per_engineer is 3"
    Assert-Equal -Actual $metrics.review_ceiling -Expected 6 -Message "review_ceiling is 6"
    Assert-Equal -Actual $metrics.is_saturated -Expected $false -Message "is_saturated is false"
    Assert-Equal -Actual $metrics.prs_per_engineer -Expected 1.0 -Message "prs_per_engineer is 1.0"
    Assert-Equal -Actual $metrics.review_hours_per_engineer -Expected 1.5 -Message "review_hours_per_engineer is 1.5 (180 min / 60 / 2)"
    Assert-Equal -Actual $metrics.ai_pr_share -Expected 0.5 -Message "ai_pr_share is 0.5"
    Assert-Equal -Actual $metrics.rework_rate -Expected 0.5 -Message "rework_rate is 0.5"
    Assert-Equal -Actual $metrics.median_first_review_latency_minutes -Expected 30 -Message "median_first_review_latency_minutes is 30"
    Assert-Equal -Actual $metrics.telemetry_collection_ok -Expected 2 -Message "telemetry_collection_ok is 2"
    Assert-Equal -Actual $metrics.telemetry_collection_degraded -Expected 0 -Message "telemetry_collection_degraded is 0"
    Assert-Equal -Actual $metrics.telemetry_collection_error -Expected 0 -Message "telemetry_collection_error is 0"
} finally {
    if (Test-Path -LiteralPath $populatedCsv) { Remove-Item -LiteralPath $populatedCsv -Force }
}

# ------------------------------------------------------------------------------
# Summary Report
# ------------------------------------------------------------------------------
Write-Host "`n================================================================================" -ForegroundColor Cyan
if ($script:failCount -eq 0) {
    Write-Host "SUCCESS: All $script:testCount AI telemetry tests passed!" -ForegroundColor Green
    Write-Host "================================================================================" -ForegroundColor Cyan
    exit 0
} else {
    Write-Host "FAILURE: $script:failCount of $script:testCount tests failed." -ForegroundColor Red
    Write-Host "================================================================================" -ForegroundColor Cyan
    exit 1
}


