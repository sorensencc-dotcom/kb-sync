---
title: "authentication"
category: "wiki"
status: "active"
---

# NotebookLM Sync Pipeline: Authentication

This document details the configuration and security guidelines for authenticating the sync pipeline with Google NotebookLM.

## Required Variables

Authentication requires three environment variables configured in a local, git-ignored `.env` file in the project root:

```ini
# Target Notebook ID (extracted from NotebookLM URL)
NOTEBOOK_ID="your-notebook-id-here"

# Authentication Token or Cookies (Required for unofficial API wrappers)
NOTEBOOKLM_COOKIE="session=..."
# OR
NOTEBOOKLM_TOKEN="nlm_api_token_..."
```

## Extracting Credentials
Because NotebookLM does not have an official public API, unofficial CLI tools (`notebooklm-py` / `notebooklm-mcp`) communicate by mimicking browser sessions.
To retrieve the `NOTEBOOKLM_COOKIE`:
1. Log in to `notebooklm.google.com` in your browser.
2. Open Browser Developer Tools (F12) -> Application/Storage tab -> Cookies.
3. Locate the session cookies (e.g. `__Secure-3PAPISID`, `__Secure-3PSID`, or corresponding session identifiers).
4. Copy the complete cookie string and paste it as `NOTEBOOKLM_COOKIE` in your local `.env` file.

## Vault Integration & Security
Under Rewrite Labs security guidelines:
- **Zero-Commit**: Never commit credentials to Git history. The `.env` file is git-ignored by default.
- **Vault Sourcing**: In CI/CD, the credentials are populated dynamically from the Vault service.
- **Rotation**: Cookies usually expire after 30 days or upon manual logout. If you encounter authentication boundaries (exit code 1), refresh the cookie string using the extraction steps above.

## See Also
- [Error Boundaries](./error-boundaries.md)
