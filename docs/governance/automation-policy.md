# Automation Policy: Workspace Timeout & Retry Configuration

**Owner:** Tier 1 (Chris)  
**Effective:** 2026-07-22  
**Review Cadence:** Quarterly  

## Timeout Thresholds

All scheduled automation tasks use the following timeout policy, stored in `configs/global.yaml`:

- **Primary timeout:** 90 seconds (increased from default 30-45s to accommodate workspace latency)
- **Retry strategy:** Exponential backoff with 3 attempts
  - Retry 1: +5 second delay (`5000ms`)
  - Retry 2: +15 second delay (`15000ms`)
  - Retry 3: +30 second delay (`30000ms`)

## Configuration Structure

The canonical system policy is defined in `configs/global.yaml`:

```yaml
automation:
  bash_workspace:
    timeout_ms: 90000
    retry_attempts: 3
    retry_backoff_ms: [5000, 15000, 30000]
    skip_on_failure: false
    alert_on_failure: true
    alert_recipients:
      - "sorensencc@gmail.com"
```

## Environment Overrides

Module scripts and orchestrators respect runtime environment overrides if provided:
- `WORKSPACE_TIMEOUT_MS` (overrides default 90000ms)
- `WORKSPACE_RETRY_ATTEMPTS` (overrides default 3 attempts)

## When to Adjust

- If workspace timeouts persist: increase to 120s (`120000ms`)
- If successful without timeout: document performance metrics and consider reduction
- All changes require Tier 1 approval and documented amendment
