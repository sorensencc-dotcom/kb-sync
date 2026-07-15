# Skill Approval & Installation Rules

**Effective Date**: 2026-07-11  
**Owner**: CIC Engineering  
**Status**: Active  
**Last Revised**: 2026-07-14 (added to wiki)

---

## Summary

Governance framework for kb-sync module development, skill creation, and toolforge registration. Establishes approval tiers (Tier 0 auto-install, Tier 1 requires review) and workflow for skill development from local module to distributed toolforge skill.

**Source**: `docs/governance/skill-approval-rules.md`

---

## Approval Tiers

### Tier 1: Major Features (Requires Approval)

Tier 1 sign-off required for:

- System architecture changes (new integration points, breaking API changes)
- Security gates or policy enforcement (authentication, authorization, compliance)
- Multi-module refactors affecting >3 modules
- New external dependencies or third-party integrations
- Changes to governance/approval processes themselves

**Approval Path**: Tier 1 review → decision log → merge  
**Timeline**: 2–5 business days

### Tier 0: Skills & Minor Features

No Tier 1 approval required for:

- New kb-sync modules (bash scripts in `modules/<domain>/`)
- New npm scripts or CLI commands
- New toolforge skills (if external distribution needed)
- Documentation and guides
- Observability/logging improvements
- Bug fixes and patches
- Single-module enhancements

**Validation**: Caveman review + tests pass + docs complete  
**Timeline**: Immediate after validation passes

---

## KB-Sync Module vs Toolforge Skill

### KB-Sync Module (Internal Tool)

Located in `modules/<domain>/<name>.sh`:

- Used by kb-sync project internally
- Invoked via `npm run <script-name>` (defined in kb-sync/package.json)
- No toolforge registration needed
- Discoverable only within kb-sync project
- Example: `modules/obsidian/ingest-wiki.sh` → `npm run wiki:ingest:obsidian:validate`

### Toolforge Skill (Distributed)

Registered in `manifest.json` (auto-installed to toolforge library):

- Used by external projects/systems via toolforge library
- Invoked by toolforge/Cowork platform
- Requires skill.json + src/ + tests/ + docs/ + manifest entry
- Discoverable in toolforge skill registry
- Example: `kb-sync-nightly` → auto-distributed to toolforge library on merge

### Decision Tree

**Is this skill for external consumption (other projects, Cowork, etc.)?**
- YES → Toolforge skill (needs wrapper)
- NO → KB-sync module only (no wrapper needed)

**Is this skill critical for automation infrastructure?**
- YES → Consider toolforge registration (e.g., kb-sync-nightly for observability)
- NO → Keep as kb-sync module

---

## Skill Installation Workflow

### 1. Development (kb-sync Module)

Develop skill in kb-sync project:
- Create `modules/<domain>/<skill-name>.sh` (bash orchestrator)
- Follows module conventions (logging, error handling, config loading)
- Includes help/usage
- Test locally: `bash modules/<domain>/<skill-name>.sh --help`

### 2. Code Review & Tests (kb-sync)

- **Caveman Review**: one-liner findings, no blockers required
- Test suite: if script complex, add tests
- Integration tests: test against actual config/staging

### 3. Documentation (kb-sync)

- Create `docs/skills/<skill-name>.md` (usage guide)
- Create `kb-sync/modules/<domain>/<skill-name>.md` (wiki entity for orchestration)
- Ensure schema compliance per [[Three-Layer Vault Architecture]]

### 4. kb-sync Commit

Merge feature branch → main with full change log.

### 5. Toolforge Skill Wrapper

Create formal toolforge skill in `toolforge/skills/<skill-name>/`:

**Required files**:
- `skill.json` — metadata (inputs, outputs, permissions, error conditions)
- `src/index.ts` — TypeScript implementation (wraps bash or standalone)
- `tests/index.test.ts` — test suite
- `SKILL.md` — specification with YAML frontmatter
- `INTEGRATION_DIAGRAM.md` — workflow diagram
- `README.md` — quick reference
- `docs/README.md` — full usage guide

### 6. Validation & Registration

- Run tests: `npm test`
- Lint: `npm run lint` (if configured)
- Verify skill.json syntax
- Check manifest.json for entry (should auto-register on merge)

### 7. Toolforge Commit

Commit skill to `toolforge/skills/<name>/` → main

**Automatic on merge**:
- Skill discovered and registered in toolforge library
- Available to Cowork (agent platform)
- Documented in manifest.json

### 8. Slack Notification

Post to #cic-dev:
- Skill name, version, status
- kb-sync source reference
- Toolforge registration link
- Quick usage example

---

## Skill Checklist

Before marking ready for toolforge:

- [ ] Script written and tested locally
- [ ] Caveman review passed (or fixes applied)
- [ ] Documentation in `docs/skills/<name>.md`
- [ ] npm scripts added (if applicable)
- [ ] Committed to main branch
- [ ] Validation tests pass
- [ ] Slack #cic-dev notified

---

## Related Links

- [[Semantic Ingest Workflow]] — Eight-phase synthesis workflow
- [[Three-Layer Vault Architecture]] — Vault organization
- Source: `docs/governance/skill-approval-rules.md` (staging: `/vault/_kb-sync-staging/kb-sync/20260714-213355/`)
