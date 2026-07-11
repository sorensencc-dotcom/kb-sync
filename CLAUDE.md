# kb-sync Project Instructions

**Project**: CIC Knowledge Base Sync Pipeline  
**Owner**: Chris Sorensen  
**Last Updated**: 2026-07-11

---

## Overview

kb-sync orchestrates multi-target knowledge base synchronization:
- **NotebookLM**: Automated ingest of CIC & Rewrite Labs documentation
- **Obsidian Vault**: Three-layer wiki architecture (raw sources, synthesized wiki, schema)
- **Observability**: Audit trails, manifest verification, deterministic pipelines

Implements Karpathy LLM-wiki pattern: human-in-the-loop synthesis with full audit trail.

---

## Key Principles

### 1. Immutable Staging

Raw sources staged to `_kb-sync-staging/<repo>/<timestamp>/`. Never edited. Preserves historical versions for retroactive citation.

### 2. LLM-Maintained Wiki (Human-in-Loop)

Wiki synthesis is manual, not automated. Claude or human operators follow 8-phase workflow (Ingest → Lint → Update → Cross-Ref → Lint → Log → Review → Commit). Each phase gates the next.

### 3. Three-Layer Vault Architecture

- **Layer 1 (Raw Sources)**: Immutable staging, audit trail
- **Layer 2 (Wiki)**: LLM-synthesized, human-curated entity/concept pages
- **Layer 3 (Schema)**: obsidian.md + lint-rules.md + operator-workflow.md

### 4. Deterministic Pipelines

Orchestration scripts (bash) are sequence-based, fail-soft (multi-target execution continues despite individual failures).

### 5. Fail-Soft Orchestration

Pipeline proceeds even if one target fails. Later targets may succeed. Each target has independent logging.

---

## Governance

### Skill Approval & Installation

**Tier 0 (Auto-Install)**: Skills, scripts, docs, observability
- No Tier 1 approval needed
- Auto-install to toolforge on merge to main
- Requires: caveman review (no blockers) + tests pass + docs complete

**Tier 1 (Requires Approval)**: Architecture changes, security gates, breaking changes
- System-level changes only
- Requires Tier 1 sign-off before merge
- 2–5 business days

**Reference**: `docs/governance/skill-approval-rules.md`

---

## Workflow

### Stage Raw Sources

```bash
npm run kb:sync:obsidian
# Creates: vault/_kb-sync-staging/kb-sync/<YYYYMMDD-HHMMSS>/
```

### Validate Staging

```bash
npm run wiki:ingest:obsidian:validate
# Checks: manifest exists, file count, no corruption
```

### Generate Claude Code Prompt

```bash
npm run wiki:ingest:obsidian:prompt
# Output: 8-phase workflow prompt ready for Claude Code session
```

### Run 8-Phase Synthesis

Claude Code session (manual):
1. Ingest — identify entities/concepts
2. Lint — check for structural issues
3. Update — create/modify pages
4. Cross-Ref — bidirectional links
5. Lint — re-verify
6. Log — audit trail entry
7. Review — operator approval
8. Commit — git commit with summary

### Review & Commit

Human (or Claude) approves changes and commits to git.

---

## Directory Structure

```
kb-sync/
├── modules/
│   ├── obsidian/          # Obsidian vault integration
│   │   ├── ingest-obsidian.sh  # Stages raw sources
│   │   ├── ingest-wiki.sh      # Validates staging, generates prompt
│   │   └── README.md
│   ├── notebooklm/        # NotebookLM integration
│   ├── wiki/              # Wiki synthesis (generic pack→wiki)
│   └── artifact-generator/
├── core/                  # Pipeline orchestration
├── configs/
│   ├── obsidian.yaml      # Vault config (root, staging, domains)
│   └── global.yaml
├── docs/
│   ├── targets/
│   │   └── obsidian.md    # Three-layer vault schema (canonical)
│   ├── skills/
│   │   └── obsidian-ingest-wiki.md  # Skill documentation
│   └── governance/
│       └── skill-approval-rules.md
├── obsidian/
│   └── vault/             # Obsidian vault root (local)
├── tests/
└── package.json
```

---

## Skills

### obsidian:ingest-wiki

Validates staged Obsidian sources and generates Claude Code prompt.

```bash
npm run wiki:ingest:obsidian:validate    # Check readiness
npm run wiki:ingest:obsidian:prompt      # Generate prompt
```

**Status**: Tier 0 (auto-install)  
**Docs**: `docs/skills/obsidian-ingest-wiki.md`

---

## Configuration

### obsidian.yaml

```yaml
vault_root: C:\dev\kb-sync\obsidian\vault
staging_dir: _kb-sync-staging
wiki_dir: wiki
mapping_rules:
  kb-sync: kb-sync
  notebooklm: notebooklm
  obsidian: obsidian
```

Override via env:
```bash
export OBSIDIAN_VAULT_ROOT="/path/to/vault"
```

---

## Testing

```bash
npm run test:obsidian      # Obsidian sync verification
npm run test:notebooklm    # NotebookLM sync verification
npm run test:all           # All tests
```

---

## Debugging

### Script Logging

All scripts output to stderr with color coding:
- `[INFO]` (green): normal operations
- `[WARN]` (yellow): non-blocking issues
- `[ERROR]` (red): blockers, exit 1

### Manifest Verification

Check staged file count:
```bash
wc -l vault/_kb-sync-staging/kb-sync/20260711-174821/FILES.manifest.txt
```

### Config Loading

Verify config values:
```bash
grep -E "^vault_root|staging_dir|wiki_dir" configs/obsidian.yaml
```

---

## Deployment

### Toolforge Auto-Install

Skills merge to main → auto-register in toolforge library.

**Notification**: Slack #cic-dev with skill name + docs link + usage

---

## Rules & Constraints

1. **Raw sources immutable**: Never edit `_kb-sync-staging/`. Only new stagings allowed.
2. **Wiki append-only**: Add/update pages; preserve history in Log.md.
3. **Manifest audit trail**: `FILES.manifest.txt` proves what was staged when.
4. **Deterministic paths**: All paths absolute; no env-var dependencies (except OBSIDIAN_VAULT_ROOT).
5. **Fail-soft orchestration**: One target failing doesn't block others.
6. **Human-in-loop synthesis**: No auto-updates to wiki content.

---

## Contacts & Channels

**Slack**: #cic-dev  
**Notifications**: Skill installations, deployment alerts, issues  
**Owner**: Chris Sorensen (sorensencc@gmail.com)

---

## Related Documents

- `docs/targets/obsidian.md` — Full three-layer vault specification
- `docs/governance/skill-approval-rules.md` — Approval & installation process
- `docs/skills/obsidian-ingest-wiki.md` — Skill usage & integration
- `modules/wiki/operator-workflow.md` — 8-phase synthesis workflow details
- `modules/wiki/schema.md` — Entity/concept/index/log page templates
