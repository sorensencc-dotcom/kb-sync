# Archive Cleanup: Staging Snapshots

Automated cleanup of old staging validation snapshots to manage disk space.

## Policy

**Retention:** Keep snapshots that meet EITHER condition:
- Modified within last 7 days, OR
- Among the 5 most recent snapshots

**Logic:** Preserve recent + frequent syncs; delete old unused archives.

## Usage

### Preview (no deletions)

```bash
npm run wiki:cleanup-archives:dry-run
```

Shows snapshots eligible for deletion without modifying disk.

### Execute cleanup

```bash
npm run wiki:cleanup-archives
```

Deletes old snapshots per retention policy. Reports count deleted.

### Verbose output

```bash
npm run wiki:cleanup-archives:verbose
```

Lists all snapshots with age, then runs cleanup.

## Options

Add flags to any npm script:

- `--dry-run` — preview what will be deleted (no changes)
- `--verbose` — list all snapshots before cleanup
- `--quiet` — suppress all output (exit code only)

Example:
```bash
node modules/wiki/cleanup-staging-archives.mjs --verbose --dry-run
```

## Configuration

Edit `modules/wiki/cleanup-staging-archives.mjs`:

```javascript
const CONFIG = {
  retention_days: 7,        // Keep last 7 days
  keep_min_snapshots: 5,    // Always keep 5 most recent
  staging_root: 'obsidian/vault/_kb-sync-staging/kb-sync'
};
```

Or override via environment variable:
```bash
STAGING_ROOT=/path/to/staging npm run wiki:cleanup-archives
```

## Scheduling (Optional)

### GitHub Actions (nightly)

Add to `.github/workflows/cleanup.yml`:

```yaml
name: Nightly Archive Cleanup

on:
  schedule:
    - cron: '0 2 * * *'  # 2 AM UTC daily

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run wiki:cleanup-archives
```

### Local cron (Linux/macOS)

```bash
# Edit crontab
crontab -e

# Add line (run at 2 AM daily):
0 2 * * * cd /path/to/kb-sync && npm run wiki:cleanup-archives
```

### Windows Task Scheduler

1. Open Task Scheduler
2. Create Basic Task → "KB-Sync Cleanup"
3. Trigger: Daily at 2 AM
4. Action: Run program
   - Program: `node`
   - Arguments: `modules/wiki/cleanup-staging-archives.mjs`
   - Start in: `C:\path\to\kb-sync`

## Examples

### Dry-run on today's snapshots (no old ones)

```
[CLEANUP] Found 25 snapshot(s)
[CLEANUP] No snapshots to delete (all within retention policy).
```

Result: Nothing deleted.

### With old snapshots to delete

```
[CLEANUP] Candidates for deletion: 3
  — 20260701-125530 (12d old)
  — 20260630-184022 (13d old)
  — 20260628-092145 (15d old)

[CLEANUP] Deleting 3 snapshot(s)...
  ✓ Deleted: 20260701-125530
  ✓ Deleted: 20260630-184022
  ✓ Deleted: 20260628-092145

[CLEANUP] Complete. Deleted 3/3 snapshot(s).
[CLEANUP] Remaining: 22 snapshot(s).
```

## Exit Codes

- `0` — Success (cleanup completed or nothing to delete)
- `1` — Failure (one or more deletions failed, or fatal error)

## Storage Savings

Each staging snapshot varies in size, but typical range:
- Small sync: 500 KB
- Medium sync: 2–5 MB
- Large sync: 10+ MB

Example: 25 snapshots at 2 MB each = 50 MB. Cleaning 5 old ones = 10 MB freed.

## Safety

- **Preserves recent:** 7-day window ensures no accidental loss
- **Min snapshots:** Keeps at least 5 recent for debugging
- **Dry-run available:** Preview before executing
- **Verbose logging:** Track exactly what gets deleted
- **Atomic ops:** Uses `fs.rm()` with recursive+force for clean deletion

No snapshots are deleted unless explicitly running without `--dry-run`.

## Related

- [Dashboard](modules/wiki/dashboard.html)
- [Validation Script](modules/wiki/validate-staging-docs.mjs)
- [GitHub Actions Setup](docs/github-actions-setup.md)
