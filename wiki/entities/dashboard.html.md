---
title: "WikiEntitiesDashboardHtml"
category: "wiki"
status: "active"
citations: ["modules/wiki/dashboard.html"]
sourceRepository: kb-sync
sourceFile: modules/wiki/dashboard.html
sha256: 83bc31ecde69aaaefedee8225a9cc094ed1b7969cd9cab84bedd929311e18d2a
lastCommit: 2026-09-05T03:15:27Z
---

# WikiEntitiesDashboardHtml

## Overview
Synthesized entity documentation for `modules/wiki/dashboard.html` in **kb-sync**.

- **File Path:** `modules/wiki/dashboard.html`
- **Lines of Code:** 937
- **Last Modified:** `2026-09-05T03:15:27Z`
- **SHA-256:** `83bc31ecde69aaaefedee8225a9cc094ed1b7969cd9cab84bedd929311e18d2a`

## Summary
Browser dashboard for the KB-Sync validation report. It loads the repository-level `.validation-report.json` and presents validation counts and findings.

## Operational notes
- Serve the repository root so the dashboard can resolve `../../.validation-report.json`.
- Use `http://127.0.0.1:8080/dashboard.html` as the compatibility URL; it redirects to the module dashboard.

## Source Citations
- Source: `modules/wiki/dashboard.html`
- Repository: `kb-sync`
