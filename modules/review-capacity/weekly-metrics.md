# Review Capacity Baseline

Two-week rolling measurement of pull-request throughput and human review load.

## Metrics

- `merged_prs_week`: rows merged during ISO week
- `active_engineers_week`: distinct authors of merged rows during ISO week
- `prs_per_engineer`: `merged_prs_week / active_engineers_week`
- `review_hours_per_engineer`: sum of `human_review_minutes / 60 / active_engineers_week`
- `ai_pr_share`: AI-assisted merged rows / merged rows
- `rework_rate`: merged rows with `rework_commits_count > 0` / merged rows
- `median_first_review_latency`: median latency in minutes for merged rows

The review ceiling is established after two weeks from sustainable reviewed PRs per engineer per week. Keep generated reports beside the baseline and record the measurement window.

## Data contract

One row per PR. Timestamps use ISO 8601. `ai_authored_bucket` is one of `0`, `1-25`, `26-50`, `51-75`, or `76-100`. `outcome` is one of `merged`, `closed`, or `reverted`.

## Workflow

1. Run `scripts/extract-github-prs.ps1` for each measured repository.
2. Collect human review minutes and AI authorship fields in the CSV.
3. Run `scripts/compute-weekly-metrics.ps1` every Friday.
4. Commit the baseline and report together, excluding secrets and generated caches.
