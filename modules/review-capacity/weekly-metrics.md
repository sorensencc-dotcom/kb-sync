# Review Capacity Baseline & Weekly Loop Protocol

Two-week rolling measurement of pull-request throughput, human review load, and capacity saturation powered by Schema v1.1 AI Telemetry.

## Tracked Repositories

- `kb-sync` (`sorensencc-dotcom/kb-sync` @ `main`)
- `cic-ingestion` (`sorensencc-dotcom/cic-ingestion` @ `master`)
- `charlie-deep-research` (`sorensencc-dotcom/charlie-deep-research` @ `main`)

---

## Weekly Loop Protocol

### 1. Collect PR Metadata

Run the extraction script for measured repositories:

```powershell
.\modules\review-capacity\scripts\extract-github-prs.ps1 -Repo "sorensencc-dotcom/kb-sync", "sorensencc-dotcom/cic-ingestion" -Days 14
```

This extracts pull requests within a 14-day window and populates enriched Schema v1.1 telemetry in `review-capacity-baseline.csv`.

### 2. Schema v1.1 Telemetry Fields

Each PR entry in `review-capacity-baseline.csv` contains the following Schema v1.1 contract fields:

- `pr_id`: Repository-scoped PR identifier (e.g., `sorensencc-dotcom/kb-sync#42`).
- `repo`: Full repository slug (`owner/repo`).
- `author`: GitHub login of the PR author.
- `created_at`: ISO 8601 UTC creation timestamp.
- `merged_at`: ISO 8601 UTC merge timestamp (empty if open/closed).
- `outcome`: State of the PR (`merged`, `closed`, `open`).
- `lines_changed`: Total raw lines added + deleted.
- `lines_changed_filtered`: Filtered lines changed excluding lockfiles, generated code, and distribution artifacts.
- `ai_assisted`: `yes` if AI signature is detected in title, body, or commits; `no` otherwise.
- `ai_authored_bucket`: Authorship bucket (`0`, `1-25`, `26-50`, `51-75`, `76-100`, `101+`).
- `human_reviewers`: Comma-separated list of unique human reviewer logins (bot accounts filtered out).
- `human_review_minutes`: Estimated or manually supplied human review time in minutes.
- `first_review_latency_minutes`: Latency in minutes from creation to first submitted human review (empty/null if unreviewed).
- `automated_findings_count`: Count of bot and static analysis review comments.
- `rework_commits_count`: Count of commits pushed strictly after the first human review timestamp.
- `collection_status`: Telemetry collection status (`ok`, `degraded`, `error`).
- `classification_reason`: Diagnostic explanation for AI signature matching or extraction status.
- `telemetry_version`: Telemetry schema version (`v1.1`).
- `query_timestamp`: ISO 8601 UTC execution timestamp of extraction query.

---

### 3. Compute Weekly Report

Execute the metrics calculation script every Friday:

```powershell
.\modules\review-capacity\scripts\compute-weekly-metrics.ps1 -WeekStart 2026-08-03 -SustainablePrsPerEngineer 3
```

**Output Metrics:**

- `merged_prs_week`: Count of merged PRs during the specified week.
- `active_engineers_week`: Distinct authors of merged PRs.
- `prs_per_engineer`: `merged_prs_week / active_engineers_week` (0 if 0 active engineers).
- `review_hours_per_engineer`: `sum(human_review_minutes) / 60 / active_engineers_week` (0 if 0 active engineers).
- `ai_pr_share`: Proportion of merged PRs with `ai_assisted: yes`.
- `rework_rate`: Proportion of merged PRs with `rework_commits_count > 0`.
- `median_first_review_latency_minutes`: Median latency calculated strictly from non-null `first_review_latency_minutes` rows.
- `telemetry_collection_ok`: Count of merged rows with `collection_status: ok`.
- `telemetry_collection_degraded`: Count of merged rows with `collection_status: degraded`.
- `telemetry_collection_error`: Count of merged rows with `collection_status: error`.

---

### 4. Compare Against the Review Ceiling

Calculate review capacity ceiling:

$$\text{review\_ceiling} = \text{active\_engineers} \times \text{sustainable\_prs\_per\_engineer}$$

**Saturation Criteria:**
If merged PR volume exceeds the review ceiling while review latency or rework rate rises, human review capacity is saturated (`is_saturated: true`).

---

## Data Contract & Null Semantics

- Timestamps follow ISO 8601 UTC format (`YYYY-MM-DDTHH:MM:SSZ`).
- Empty string (`""`) or `$null` represents uncollected or non-applicable numeric data.
- **Null Semantics:** Metric calculations ignore null/empty fields rather than coercing null to zero. Latency medians and review hour totals strictly aggregate rows with populated numeric values.

## Proxy Metric Limitations & Disclaimers

> [!NOTE]
> **Proxy Metric Disclaimers:**
> - **AI Authorship Bucket (`ai_authored_bucket`):** Estimated from filtered lines changed (`lines_changed_filtered`) when AI signatures are detected in title, body, or commit messages. It provides a proxy estimate of AI contribution volume rather than line-by-line attribution.
> - **Estimated Review Minutes (`human_review_minutes`):** Heuristically calculated as $\text{Min}(120, \text{Max}(5, \text{Round}(\text{lines\_changed\_filtered} / 30)) + \text{human\_comments} \times 3)$. It serves as an automated baseline estimate of review effort unless manually overridden.

## Telemetry Collection Statuses

- `ok`: Telemetry successfully extracted from GitHub API and baseline merged.
- `degraded`: Telemetry extracted with partial data missing or unparseable fields.
- `error`: Failed extraction due to rate limits, network errors, or malformed GraphQL responses.

## Line Exclusion Rules (`lines_changed_filtered`)

Filtered line counts exclude lockfiles, distribution bundles, vendor libraries, and minified files:
- Lockfiles: `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Gemfile.lock`, `Cargo.lock`, `go.sum`
- Minified assets & build outputs: `*.min.js`, `*.min.css`, `dist/*`, `build/*`, `out/*`, `public/vendor/*`

## Operational Commands

- **Extract Telemetry:** `powershell.exe -ExecutionPolicy Bypass -File modules/review-capacity/scripts/extract-github-prs.ps1 -Repo "sorensencc-dotcom/kb-sync"`
- **Compute Weekly Metrics:** `powershell.exe -ExecutionPolicy Bypass -File modules/review-capacity/scripts/compute-weekly-metrics.ps1 -WeekStart 2026-08-03`
- **Execute Unit Test Suite:** `powershell.exe -NoProfile -ExecutionPolicy Bypass -File modules/review-capacity/tests/test-ai-telemetry.ps1`

