# Review Capacity Baseline & Weekly Loop Protocol

Two-week rolling measurement of pull-request throughput, human review load, and capacity saturation.

## Tracked Repositories

- `kb-sync` (`sorensencc-dotcom/kb-sync` @ `main`)
- `cic-ingestion` (`owner/cic-ingestion` @ `master`)
- `charlie-deep-research` (`owner/charlie-deep-research` @ `main`)

---

## Weekly Loop Protocol

### 1. Collect PR Metadata

Run the extraction script for measured repositories:

```powershell
.\modules\review-capacity\scripts\extract-github-prs.ps1 -Repo "owner/cic-ingestion", "sorensencc-dotcom/kb-sync"
```

This populates recent PR IDs, authors, timestamps, merge state, and changed lines in `review-capacity-baseline.csv`.

### 2. Complete Human Fields

For each extracted PR in `review-capacity-baseline.csv`, fill in:

- `human_reviewers`: comma-separated list of human reviewer logins
- `human_review_minutes`: total human review time in minutes
- `first_review_latency_minutes`: latency from creation to first human review/action
- `ai_assisted`: `yes` or `no`
- `ai_authored_bucket`: `0`, `1-25`, `26-50`, `51-75`, or `76-100`
- `automated_findings_count`: number of static analysis/bot findings
- `rework_commits_count`: number of commits pushed post-review

*Note:* New PRs carry these fields through the repository PR template.

### 3. Compute Weekly Report

Execute the metrics calculation script every Friday:

```powershell
.\modules\review-capacity\scripts\compute-weekly-metrics.ps1 -WeekStart 2026-07-27 -SustainablePrsPerEngineer 3
```

**Output Metrics:**

- `merged_prs_week`: merged PR count during the week
- `active_engineers_week`: distinct authors of merged PRs
- `prs_per_engineer`: `merged_prs_week / active_engineers_week`
- `review_hours_per_engineer`: sum of `human_review_minutes / 60 / active_engineers_week`
- `ai_pr_share`: AI-assisted merged rows / total merged rows
- `rework_rate`: merged rows with `rework_commits_count > 0` / total merged rows
- `median_first_review_latency_minutes`: median first-review latency in minutes

---

### 4. Compare Against the Review Ceiling

Calculate review capacity ceiling:

$$\text{review\_ceiling} = \text{active\_engineers} \times \text{sustainable\_prs\_per\_engineer}$$

**Example:**
$$4\text{ engineers} \times 3\text{ reviewed PRs/week} = 12\text{ PR/week ceiling}$$

**Saturation Criteria:**
If merged/generated PR volume stays above the review ceiling while review latency or rework rate rises, human review capacity is saturated (`is_saturated: true`).

---

## Data Contract

One row per PR. Timestamps use ISO 8601 UTC format. `ai_authored_bucket` is one of `0`, `1-25`, `26-50`, `51-75`, or `76-100`. `outcome` is one of `merged`, `closed`, or `reverted`.

## Current Limitations & Automation Roadmap

- **Current Limitation:** The extractor auto-populates GitHub metadata. Reviewer identity, review minutes, AI authorship, automated findings, and rework require manual entry during the baseline phase.
- **Automation Roadmap:** The first two weeks establish the baseline; after that, manual fields are target candidates for automated telemetry hooks.
