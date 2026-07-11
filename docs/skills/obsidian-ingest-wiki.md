# Skill: obsidian:ingest-wiki

**Purpose**: Validate staged Obsidian raw sources and generate a Claude Code prompt for 8-phase wiki semantic synthesis.

**Category**: Wiki Integration  
**Status**: Active  
**Integration**: `modules/obsidian/ingest-wiki.sh`

---

## Overview

The `obsidian:ingest-wiki` skill orchestrates the Karpathy LLM-wiki pattern for Obsidian vault integration. It:

1. **Validates** staged raw sources against manifest (checks for completeness, no corruption)
2. **Generates** a ready-to-copy prompt for Claude Code with paths substituted
3. **Orchestrates** the 8-phase semantic ingest workflow (Ingest → Lint → Update → Cross-Ref → Lint → Log → Review → Commit)

The skill itself does not modify wiki content — that's Claude's job in an interactive session. The skill ensures staging is ready and provides context.

---

## Usage

### Via npm Scripts

```bash
# Validate latest staging, show readiness status
npm run wiki:ingest:obsidian:validate

# Generate Claude Code prompt with paths substituted
npm run wiki:ingest:obsidian:prompt
```

### Via Direct Bash Invocation

```bash
cd /path/to/kb-sync

# Validate (default action)
bash modules/obsidian/ingest-wiki.sh validate

# Generate prompt for copy-paste into Claude Code
bash modules/obsidian/ingest-wiki.sh prompt

# Validate specific staging directory
bash modules/obsidian/ingest-wiki.sh prompt /path/to/staging
```

---

## Workflow

### 1. Stage Raw Sources

```bash
# Calls ingest-obsidian.sh, creates timestamped staging
npm run kb:sync:obsidian
```

Output: Raw sources in `vault/_kb-sync-staging/kb-sync/<YYYYMMDD-HHMMSS>/` with manifest.

### 2. Validate Staging

```bash
npm run wiki:ingest:obsidian:validate
```

Checks:
- Staging directory exists
- Manifest file present (`FILES.manifest.txt`)
- File count matches manifest
- No data corruption detected

**Exit 0** if valid, **Exit 1** if invalid (cannot proceed to synthesis).

### 3. Generate Claude Code Prompt

```bash
npm run wiki:ingest:obsidian:prompt
```

Outputs:
```
=== OBSIDIAN WIKI INGEST PROMPT ===

You are about to ingest staged raw sources into the Obsidian wiki using an 8-phase workflow.

**Staging Path:** /path/to/vault/_kb-sync-staging/kb-sync/20260711-174821
**Vault Root:** /path/to/vault
**Schema Document:** docs/targets/obsidian.md

**Workflow Phases:**
1. **Ingest** — Identify new entities and concepts from staged sources
2. **Lint** — Verify current wiki for structural/semantic issues
3. **Update** — Create/modify entity and concept pages
4. **Cross-Ref** — Establish bidirectional links
5. **Lint** — Re-verify after updates
6. **Log** — Record session in Log.md
7. **Review** — Spot-check for accuracy
8. **Commit** — Git commit with change summary

...
```

### 4. Run Claude Code Session

Copy the prompt from step 3 into Claude Code with:
- Staging path resolved to absolute paths (done by skill)
- Schema doc (`docs/targets/obsidian.md`) for reference
- Vault path for context

Claude executes the 8-phase workflow, creating/updating wiki pages, cross-references, and log entries.

### 5. Review and Commit

Claude or you approve changes and commits to git with full change summary.

---

## Actions

### `validate` (default)

**Purpose**: Pre-flight check before synthesis.

**Returns**:
- Exit 0: Staging valid, ready for synthesis
- Exit 1: Staging invalid, synthesis blocked

**Checks**:
1. Staging directory exists
2. Manifest file exists
3. File count > 0
4. Manifest is readable

**Output**:
```
[WIKI-INGEST] [INFO] Manifest validated: 43 files in staging.
[WIKI-INGEST] [INFO] Validation complete. Staging ready for wiki ingest.
```

### `prompt`

**Purpose**: Generate Claude Code prompt with resolved paths.

**Returns**: Exit 0 after printing prompt

**Includes**:
- Resolved staging path (auto-discovered if not provided)
- Resolved vault root
- 8-phase workflow steps
- Schema reference pointer
- Constraints and expectations

**Output**: Markdown-formatted prompt ready to paste into Claude Code.

### `log-entry` (future)

**Purpose**: Append session result to Log.md after synthesis completes.

**Planned for**: Post-synthesis cleanup (called by wrapper script after Claude finishes).

---

## Configuration

Reads from `configs/obsidian.yaml`:

```yaml
vault_root: C:\dev\kb-sync\obsidian\vault
staging_dir: _kb-sync-staging
wiki_dir: wiki
mapping_rules:
  kb-sync: kb-sync
  notebooklm: notebooklm
  obsidian: obsidian
```

Can override via environment:
```bash
export OBSIDIAN_VAULT_ROOT="/path/to/vault"
npm run wiki:ingest:obsidian:prompt
```

---

## Auto-Discovery

If no staging path provided, script finds the latest by:

1. Scanning `vault/_kb-sync-staging/<repo>/` directory
2. Finding all timestamped subdirs (format: `YYYYMMDD-HHMMSS`)
3. Sorting by timestamp descending
4. Using most recent

This ensures you don't have to manually track staging paths across sessions.

---

## Schema Reference

All wiki synthesis must follow the schema in `docs/targets/obsidian.md`:

- **Entity pages**: Single concrete system/module/feature
- **Concept pages**: Cross-cutting patterns or architectural concepts
- **Index.md**: Per-domain catalog of entities and concepts
- **Log.md**: Append-only operation log

The prompt generated by this skill includes a reminder to read `docs/targets/obsidian.md` before starting synthesis.

---

## Constraints & Best Practices

1. **Raw sources are immutable**: Do not edit files in `_kb-sync-staging/`. The skill will not modify them.
2. **Preserve existing wiki**: Append new content; update existing pages; do not delete or overwrite without review.
3. **Link to staged sources**: Every entity/concept page should cite its raw source(s) by absolute path to `_kb-sync-staging/`.
4. **Manifest is audit trail**: The `FILES.manifest.txt` in each staging proves what sources were available at ingest time.
5. **Log.md is immutable audit trail**: Append entries with timestamp and what changed; never edit or delete old entries.

---

## Integration with Pipeline

```
npm run kb:sync:obsidian
        ↓
Stages raw sources (43 files in example)
        ↓
npm run wiki:ingest:obsidian:validate
        ↓
Manifest validated ✓
        ↓
npm run wiki:ingest:obsidian:prompt
        ↓
Prints Claude Code prompt
        ↓
Claude Code session (phases 1-8)
        ↓
Creates/updates wiki pages, Index.md, Log.md
        ↓
git commit (manual)
        ↓
Wiki updated, staged sources locked for audit trail
```

---

## Troubleshooting

### "No staged sources found"

**Cause**: `vault/_kb-sync-staging/` is empty or doesn't exist.

**Fix**: Run `npm run kb:sync:obsidian` first.

### "Manifest not found"

**Cause**: Staging directory exists but `FILES.manifest.txt` is missing (corrupted staging).

**Fix**: Re-run `npm run kb:sync:obsidian` to re-stage.

### "Staging directory does not exist: [path]"

**Cause**: Path provided or env var `OBSIDIAN_VAULT_ROOT` points to non-existent location.

**Fix**: Verify `OBSIDIAN_VAULT_ROOT` in env or `configs/obsidian.yaml`, run from correct repo root.

---

## Examples

### Example 1: Standard workflow

```bash
# Stage new sources
npm run kb:sync:obsidian

# Validate readiness
npm run wiki:ingest:obsidian:validate

# Get Claude Code prompt
npm run wiki:ingest:obsidian:prompt

# [Copy prompt into Claude Code, run session, create wiki pages, commit]
```

### Example 2: Validate without prompt generation

```bash
bash modules/obsidian/ingest-wiki.sh validate
# Exit 0 if ready, Exit 1 if not
```

### Example 3: Generate prompt for specific staging (not latest)

```bash
bash modules/obsidian/ingest-wiki.sh prompt \
  C:/dev/kb-sync/obsidian/vault/_kb-sync-staging/kb-sync/20260711-174821
```

---

## Related Skills & Workflows

- **`ingest-obsidian.sh`**: Stages raw sources (prerequisite for this skill)
- **`docs/targets/obsidian.md`**: Full schema and ingest workflow specification
- **`modules/wiki/operator-workflow.md`**: 8-phase detailed instructions
- **`modules/wiki/schema.md`**: Entity/concept/index/log page templates
- **`modules/wiki/lint-rules.md`**: Quality checks for wiki consistency

---

## FAQ

**Q: Can I manually edit the staged sources?**  
A: No. The staging layer is immutable. Edit the wiki (layer 2) instead, and cite the original source.

**Q: What if the origin repo updates?**  
A: Run `npm run kb:sync:obsidian` again. A new timestamped staging will be created; old ones remain for historical citation.

**Q: Can I skip the `validate` step?**  
A: You can, but it's recommended. Validation catches data corruption before synthesis wastes effort.

**Q: Who writes the wiki — me or Claude?**  
A: Both. Claude runs the synthesis in an interactive session; you review and approve before commit.

**Q: How do I track changes across ingest runs?**  
A: The `Log.md` file (layer 3) maintains an append-only audit trail with timestamps, staged sources, and what changed.
