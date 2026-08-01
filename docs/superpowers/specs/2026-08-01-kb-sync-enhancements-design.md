# Design Specification: kb-sync Enhancements & Process Improvement Pipeline

**Date:** 2026-08-01  
**Status:** Approved  
**Author:** Antigravity & User  
**Target System:** `kb-sync` (c:/dev/kb-sync)  

---

## 1. Executive Summary

This document specifies three phased enhancements to `kb-sync` designed to automate documentation freshness, streamline human-in-the-loop wiki updates, and leverage telemetry data to continuously improve development processes.

- **Phase 1 (Knowledge Freshness & Drift Detection):** Detects when source code has evolved past the last wiki ingest timestamp or staging snapshot.
- **Phase 2 (Ingest Delta Summarization):** Computes structural diffs between consecutive staging passes and injects tailored delta prompts into operator workflows.
- **Phase 3 (Observability & Coverage Analytics):** Measures source-to-wiki coverage metrics, audits link rot, and feeds telemetry into engineering retrospectives and automated backlog management.

---

## 2. Architecture & File Structure

All new components operate as lightweight, fail-soft TypeScript/Node modules executed by `npx tsx` and wired into `core/run-all.sh`.

```
c:/dev/kb-sync/
├── core/
│   └── run-all.sh                        # Updated to invoke drift, delta, and coverage stages
├── modules/wiki/
│   ├── detect-drift.ts                   # Phase 1: Git vs Wiki Log timestamp & hash drift analyzer
│   ├── generate-delta-summary.ts         # Phase 2: Diffs staging snapshots & formats operator delta prompt
│   └── audit-coverage.ts                 # Phase 3: Validates cross-links, link rot & source-to-wiki coverage
├── tests/
│   ├── drift-detection.test.ts           # Verification tests for Phase 1
│   ├── delta-summary.test.ts             # Verification tests for Phase 2
│   └── coverage-audit.test.ts            # Verification tests for Phase 3
├── .drift-report.json                    # Telemetry report for drift state
├── .coverage-report.json                 # Telemetry report for coverage & link health
└── package.json                          # New npm scripts: kb:drift, kb:delta, kb:coverage
```

---

## 3. Data Contracts

### 3.1 `.drift-report.json`
```json
{
  "timestamp": "2026-08-01T14:50:00.000Z",
  "status": "DRIFT_DETECTED",
  "drifted_sources": [
    {
      "repo": "toolforge",
      "file": "src/api.ts",
      "last_code_commit": "2026-08-01T10:00:00Z",
      "last_wiki_sync": "2026-07-28T09:00:00Z",
      "status": "STALE_WIKI_PAGE",
      "wiki_page": "wiki/CIC/Toolforge API.md"
    }
  ],
  "summary": {
    "total_sources_checked": 171,
    "stale_pages_count": 1
  }
}
```

### 3.2 `.coverage-report.json`
```json
{
  "timestamp": "2026-08-01T14:50:00.000Z",
  "source_files_count": 171,
  "wiki_pages_count": 42,
  "unmapped_sources": ["services/new-service.ts"],
  "link_health": {
    "total_links": 84,
    "broken_links": [],
    "healthy_pct": 100.0
  },
  "coverage_score_pct": 92.5
}
```

---

## 4. Component Details

### 4.1 Phase 1: Knowledge Freshness & Drift Detection (`detect-drift.ts`)
1. Reads `configs/obsidian.yaml` `mapping_rules` to resolve mappings between source repository paths and wiki folders.
2. Extracts last wiki ingest timestamps from `wiki/Log.md` or `.sync-status.json`.
3. Runs `git log -1 --format="%aI"` against source repositories to compare source commit timestamps against wiki sync timestamps.
4. Computes SHA256 checksums of source files vs staged snapshots in `_kb-sync-staging/`.
5. Emits findings into `.drift-report.json` and logs clear terminal warnings during `core/run-all.sh`.

### 4.2 Phase 2: Ingest Delta Summarization (`generate-delta-summary.ts`)
1. Scans `_kb-sync-staging/<repo>/` for the current and previous timestamped staging snapshots (e.g. `20260731-120000` vs `20260801-140000`).
2. Computes file-level diffs (added, deleted, modified) and structural code diffs.
3. Formats an actionable **Delta Summary** block into the operator prompt printed at the end of `ingest-obsidian.sh`, guiding human/Claude synthesis to modified areas.

### 4.3 Phase 3: Observability & Coverage Analytics (`audit-coverage.ts`)
1. Measures source coverage score:
   $$\text{Coverage Score} = \left(\frac{\text{Mapped Source Files}}{\text{Total Tracked Source Files}}\right) \times 100$$
2. Scans all markdown links and wikilinks across `wiki/` and `docs/` to flag dead links or broken target anchors.
3. Outputs findings to `.coverage-report.json`.

---

## 5. Process Improvement Feedback Loop

1. **Retrospective & Backlog Integration**:
   - Telemetry from `.drift-report.json` and `.coverage-report.json` feeds into weekly retrospectives (`/retro`) and engineering health metrics.
   - Self-healing trigger: When **Coverage Score < 85%** or **Stale Wiki Pages > 5**, `kb-sync` automatically appends a documentation backlog task to `TODOS.md`.

2. **PR / CI Guard Rails**:
   - `npm run kb:drift --check-ci` can be executed in CI to alert developers when core code changes lack corresponding wiki updates.

3. **Accelerated Human Synthesis**:
   - Delta prompts reduce operator synthesis time by >50% during ingestion passes.

---

## 6. Verification Plan

Each phase includes automated TypeScript verification tests run via `npx tsx`:
- `tests/drift-detection.test.ts`: Verifies timestamp/hash drift detection on test fixtures.
- `tests/delta-summary.test.ts`: Verifies diff calculation between mock staging directories.
- `tests/coverage-audit.test.ts`: Verifies coverage score calculation and broken link detection.
