# Artifact Generator Module

**Purpose**: Generate interactive HTML reports from knowledge pack analysis  
**Module**: `modules/artifact-generator/`  
**Entry Point**: `bash modules/artifact-generator/generate.sh` or `npm run artifact:generate`  
**Status**: Operational

---

## Summary

Post-sync analysis tool that produces self-contained, browser-viewable HTML dashboards. Analyzes URL references, content structure, and link health across NotebookLM knowledge packs and Obsidian staging directories.

**Source**: `docs/modules/artifact-generator.md` (staging: `/vault/_kb-sync-staging/kb-sync/20260714-213355/`)

---

## Key Operations

### URL Extraction & Analysis
- Scans source files for HTTP(s) links
- Ranks URLs by frequency (impact scoring)
- Classifies by severity: High (≥10 refs), Medium (5-9 refs), Low (1-4 refs)
- Generates distribution chart (top 10 most-referenced)

### Report Generation
- Self-contained HTML (no external dependencies except Chart.js from CDN)
- Light/dark theme support (`prefers-color-scheme`)
- Interactive charts with hover data
- Sortable table (top 100 URLs)
- KPI cards: unique URL count, files analyzed, avg refs/file, max references

### Dual-Source Support
- **NotebookLM**: Analyzes `.nlm_pack/*.txt` files
- **Obsidian**: Analyzes `$OBSIDIAN_VAULT_ROOT/_kb-sync-staging/<repo>/<timestamp>/`
- Generates separate namespaced reports for coexistence

---

## NPM Scripts

```bash
npm run artifact:generate              # From NotebookLM knowledge pack
npm run artifact:generate:obsidian     # From Obsidian staging directory
npm run artifact:generate:all          # Both (sequential, fail-soft)
```

## Direct Invocation

```bash
bash modules/artifact-generator/generate.sh [config-file] [source]
bash modules/artifact-generator/generate.sh configs/artifact-generator.yaml notebooklm
bash modules/artifact-generator/generate.sh configs/artifact-generator.yaml obsidian
```

## Programmatic Usage (Node.js)

```bash
node modules/artifact-generator/generate-report.mjs \
  --source notebooklm \
  --config-file configs/artifact-generator.yaml
```

---

## Configuration

Configured in `configs/artifact-generator.yaml`:

| Setting | Default | Purpose |
|---------|---------|---------|
| `output_dir` | `_integration` | Report output location |
| `report_filename` | `kb-sync-interactive-report.html` | Base filename (source-namespaced) |
| `url_analysis_enabled` | `true` | Enable URL extraction and analysis |
| `max_urls_displayed` | `100` | Max URLs in report table |
| `severity.high` | `10` | Severity threshold (high) |
| `severity.medium` | `5` | Severity threshold (medium) |
| `link_validation.enabled` | `false` | Link validation (experimental) |

---

## Output

### File Locations

Reports are namespaced per source:
- `_integration/kb-sync-interactive-report-notebooklm.html`
- `_integration/kb-sync-interactive-report-obsidian.html`

### Report Features

- **KPI Cards**: Quick metrics (unique URLs, files, avg refs, max refs)
- **Reference Distribution Chart**: Bar chart of top 10 URLs
- **Link Reference Table**: Sortable table with URL, reference count, severity badge
- **Severity Badges**: Color-coded (red=high, orange=medium, green=low)
- **Recommendations**: Link maintenance checklist

---

## Performance

- **Typical Runtime**: 1-5 seconds (depends on pack size)
- **Memory**: O(n) where n = number of URLs extracted
- **I/O**: Single read pass over sources, single write of HTML

---

## Integration with Multi-Target Sync

When `npm run kb:sync:all` executes:

1. NotebookLM target runs → generates `.nlm_pack/repo_knowledge_pack.txt`
2. Obsidian target runs → stages files to vault
3. Post-sync (if all succeeded):
   - Artifact generated from NotebookLM pack
   - Artifact generated from Obsidian staging (separate report)
   - Both artifacts output to `_integration/`

If either sync fails, artifact generation is **skipped for that target** ([[Fail-Soft Orchestration]]).

---

## Error Handling

| Error | Cause | Resolution |
|-------|-------|-----------|
| Pack directory not found | Source not available | Run sync first |
| Node.js not available | Missing runtime | Install Node.js 18+ |
| Config file missing | Config path invalid | Falls back to hardcoded defaults |

---

## Related Links

- [[Three-Layer Vault Architecture]] — Vault organization and output dir
- [[Fail-Soft Orchestration]] — Multi-target execution strategy
- [[Pack-Based Knowledge Management]] — Knowledge pack structure
- Source: `docs/modules/artifact-generator.md`
