---
title: "operator rules"
category: "wiki"
status: "active"
---

# NotebookLM Sync Pipeline: Operator Rules

This document defines the rules, triggers, and prerequisites for operators managing the NotebookLM synchronization loop.

## Ingestion Triggers

### 1. Explicit Manual Sync
Operators should run the sync command manually when:
- Deploying major architectural changes or refactoring significant parts of the codebase.
- Re-aligning external MCP clients (Cursor/Claude) that are outputting stale or outdated code suggestions.
- Commencing a new development phase.

Run command:
```bash
npm run kb:sync
```

### 2. Optional Git Post-Commit Hook
Developers can opt-in to background sync on local commits by executing:
```bash
npm run kb:sync:setup-hook
```
This automatically installs the post-commit hook into `.git/hooks/post-commit` and makes it executable. The hook runs asynchronously in the background only if files matching the target extensions are modified, avoiding blocking developer commits.

### 3. CI/CD & Nightly Evals
On the main integration branch, CI should trigger `npm run kb:sync` upon successful builds. The nightly edge-node evaluation runner also executes this script to ensure all agents are grounded with fresh context every morning.

### 4. Rollback Strategy
If a sync operations corrupts the NotebookLM state or introduces bad citations, operators can restore the last known working backup by executing:
```bash
npm run kb:sync:rollback
```
This un-caches the local backup files (`.bak.txt`), purges the current notebook sources, and uploads the backup files.

## Prerequisites

Before executing the pipeline, the operator must verify:
- **CLI Presence**: `notebooklm-mcp` must be installed and executable in the environment.
- **Environment Variables**: A local, git-ignored `.env` file containing valid `NOTEBOOK_ID` and credentials must be present in the repository root.

## See Also
- [Error Boundaries](./error-boundaries.md)
- [Authentication Config](./authentication.md)
