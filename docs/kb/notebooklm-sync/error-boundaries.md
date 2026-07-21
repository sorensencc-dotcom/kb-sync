---
title: "error boundaries"
category: "wiki"
status: "active"
---

# NotebookLM Sync Pipeline: Error Boundaries

This document defines handling rules and troubleshooting guides for potential failures in the synchronization loop.

## Failure Scenarios & Mitigations

### 1. Missing Environment Credentials
- **Symptom**: Script exits with code `1` and prints `[NLM-INGEST] [ERROR] Missing environment credentials.`
- **Reason**: `NOTEBOOKLM_COOKIE` or `NOTEBOOKLM_TOKEN` is unset in `.env`, or the `.env` file is missing.
- **Handling**: Create or update the `.env` file in the project root with the correct credentials. Ensure the variables are exported correctly.

### 2. Missing Notebook ID
- **Symptom**: Script exits with code `1` and prints `[NLM-INGEST] [ERROR] NOTEBOOK_ID environment variable is missing.`
- **Reason**: `NOTEBOOK_ID` is not exported.
- **Handling**: Obtain the target Notebook ID from the NotebookLM URL (e.g. `https://notebooklm.google.com/notebook/<id>`) and set `NOTEBOOK_ID` in `.env`.

### 3. CLI Binary Not Found
- **Symptom**: Script logs `Skipping programmatic purge/upload: CLI tool 'notebooklm-mcp' not installed.`
- **Reason**: The MCP CLI binary is not present in the current user's shell `PATH`.
- **Handling**: 
  - Install the CLI tool.
  - Or manually upload the compiled `.nlm_pack/repo_knowledge_pack.txt` file directly using the NotebookLM Web UI.

### 4. pyragify Failures
- **Symptom**: Script logs `pyragify failed... Falling back to manual git flattener.`
- **Reason**: `uv` is not installed, the pyragify config is missing, or Python dependencies are broken.
- **Handling**: The script automatically falls back to a fast `git grep`-based flattener to compile the pack file, ensuring the sync does not block. Check your local python environment if you want to restore pyragify.

### 5. API Rate Limits / Network Timeout
- **Symptom**: CLI command fails with network socket error or `429 Too Many Requests`.
- **Reason**: Google API rate limits or local connection drops.
- **Handling**: The post-commit hook redirects output to `.nlm_pack/sync-background.log`. Review this file for details. Trigger a manual sync via `npm run kb:sync` once connectivity returns or rate limit windows reset.

## See Also
- [Operator Rules](./operator-rules.md)
- [Authentication Config](./authentication.md)
