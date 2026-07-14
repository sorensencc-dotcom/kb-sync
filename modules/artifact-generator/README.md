# Artifact Generator Module

Generates interactive HTML reports from knowledge pack analysis post-sync.

## Quick Start

```bash
# After NotebookLM sync
npm run artifact:generate

# After Obsidian sync
npm run artifact:generate:obsidian

# From multi-target sync (automatic)
npm run kb:sync:all
```

## Output

Per source, so both coexist:

- `_integration/kb-sync-interactive-report-notebooklm.html`
- `_integration/kb-sync-interactive-report-obsidian.html`

## Files

- **generate-report.mjs** — Node.js script that analyzes source files and generates HTML
- **generate.sh** — Bash wrapper orchestrating the generator
- **README.md** — This file

## Configuration

See `configs/artifact-generator.yaml`

## Documentation

Full guide: `docs/modules/artifact-generator.md`
