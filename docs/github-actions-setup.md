# GitHub Actions: Staging Validator Integration

Automated KB-Sync staging validation on every push/PR to `main` branch.

## Workflow: `validate-staging.yml`

**Triggers:** Push or PR to `main` when staging snapshot files change.

**What it does:**
1. Checks out code
2. Runs `npm run wiki:validate-batch` with JSON report output
3. Parses results (files, errors, warnings, duration)
4. Posts PR comment with status badge and metrics
5. Fails workflow if errors detected
6. Uploads validation report as artifact
7. Sends Slack notification on failure (optional)

## Setup

### Required

No additional setup needed. Workflow runs automatically on push/PR.

### Optional: Slack Notifications

To get Slack alerts on validation failures:

1. **Create Slack Incoming Webhook:**
   - Go to your Slack workspace settings → Apps & integrations → Incoming Webhooks
   - Create new webhook → select channel (e.g., #kb-sync-alerts)
   - Copy webhook URL

2. **Add GitHub Secret:**
   - Go to repository Settings → Secrets and variables → Actions
   - New repository secret: `SLACK_WEBHOOK_URL`
   - Paste webhook URL
   - Save

Webhook will now send failure notifications automatically.

## Results

### PR Comments

On pull requests, validation posts a status comment:

```
## KB-Sync Staging Validation ✅

| Metric | Value |
|--------|-------|
| Status | **PASSED** |
| Files | 235 |
| Errors | 0 |
| Warnings | 2630 |
| Duration | 1.01s |
```

### Artifacts

Validation report stored for 30 days:
- Download from Actions → Run → Artifacts → `validation-report`
- JSON format: timestamp, mode, duration, summary, per-snapshot results

### CI Status

- ✅ **Green:** No errors detected (warnings OK)
- ❌ **Red:** Errors found; workflow fails and blocks merge

## Customization

### Change trigger paths

Edit `on.push.paths` and `on.pull_request.paths` to validate different directories.

### Adjust retention

Change `retention-days: 30` to keep artifacts longer/shorter.

### Modify PR comment

Edit `Comment on PR` step to customize message format.

### Disable Slack notifications

Remove `Send Slack notification` step or keep `SLACK_WEBHOOK_URL` secret unset.

## Debugging

If workflow fails unexpectedly:

1. Check **Actions** tab → click failed run
2. Expand **Run staging validation** step → see error output
3. Check **Parse validation results** step → verify JSON parsing
4. Look at **Artifacts** → download report for manual inspection

Common issues:
- **Missing report:** Validation script error; check logs
- **Parse failure:** JSON structure changed; update jq queries
- **Slack error:** Webhook URL invalid or network issue; check secret

## Metrics Collected

Per-run summary:
- **Files:** Total markdown files validated
- **Errors:** Files with critical issues (blocks merge)
- **Warnings:** Files with minor issues (informational)
- **Duration:** Total validation time (ms)

Per-snapshot breakdown:
- Target directory path
- File count
- Error/warning count

## Related

- [Validation Staging Docs](modules/wiki/validate-staging-docs.mjs)
- [Webhook Configuration](configs/webhooks.yaml)
- [Dashboard](modules/wiki/dashboard.html)
