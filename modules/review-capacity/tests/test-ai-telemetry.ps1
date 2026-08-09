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
    @{ lines = 101; expectedBucket = "101+" }
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
            telemetry_version = "v1.1"
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
