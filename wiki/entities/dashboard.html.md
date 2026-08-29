---
title: "WikiEntitiesDashboardHtml"
category: "wiki"
status: "active"
citations: ["modules/wiki/dashboard.html"]
sourceRepository: kb-sync
---

# WikiEntitiesDashboardHtml

## Summary
Browser dashboard for the KB-Sync validation report. It loads the repository-level `.validation-report.json` and presents validation counts and findings.

## Operational notes
- Serve the repository root so the dashboard can resolve `../../.validation-report.json`.
- Use `http://127.0.0.1:8080/dashboard.html` as the compatibility URL; it redirects to the module dashboard.

## Source Citations
- Source: `modules/wiki/dashboard.html`
