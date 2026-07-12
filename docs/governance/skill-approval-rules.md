# Skill Approval & Installation Rules

**Effective Date**: 2026-07-11  
**Owner**: CIC Engineering  
**Status**: Active  
**Last Revised**: 2026-07-11 (clarified toolforge structure)

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

### Tier 0: Skills & Minor Features (Register in Toolforge)

No Tier 1 approval required. Register to toolforge:

- New skills (bash, TypeScript, python)
- New orchestration scripts
- New npm scripts or CLI commands
- Documentation and guides
- Observability/logging improvements
- Bug fixes and patches
- Single-module enhancements

**Validation**: Caveman review (code quality) + tests pass + docs complete

**Timeline**: Immediate after validation passes

---

## Skill Installation Workflow

### 1. Development (kb-sync Module)

Develop skill in kb-sync project:

- Create `modules/<domain>/<skill-name>.sh` (bash orchestrator)
- Follows module conventions (logging, error handling, config loading)
- Includes help/usage
- Test locally: `bash modules/<domain>/<skill-name>.sh --help`

### 2. Code Review & Tests (kb-sync)

- **Caveman Review** (`/caveman:caveman-review`): one-liner findings, no blockers required
- Test suite: if script complex, add tests
- Integration tests: test against actual config/staging

### 3. Documentation (kb-sync)

- Create `docs/skills/<skill-name>.md` (usage guide)
- Create `kb-sync/modules/<domain>/<skill-name>.md` (wiki entity for orchestration)
- Ensure schema compliance per `docs/targets/obsidian.md`

### 4. kb-sync Commit

Merge feature branch → main with full change log.

### 5. Toolforge Skill Wrapper

Create formal toolforge skill in `toolforge/skills/<skill-name>/`:

**Required files**:

- `skill.json` — metadata (inputs, outputs, permissions, error conditions)
- `src/index.ts` — TypeScript implementation (wraps bash or standalone)
- `tests/index.test.ts` — test suite
- `SKILL.md` — specification with YAML frontmatter (see below)
- `INTEGRATION_DIAGRAM.md` — workflow diagram
- `README.md` — quick reference
- `docs/README.md` — full usage guide

**SKILL.md Format** (YAML frontmatter required):

```markdown
---
name: skill-id
description: One-line description of what skill does
compatibility: |
  - Node.js 18+
  - TypeScript 5.0+
  - Other requirements
---

# Skill Name Specification

[Content...]
```

Frontmatter fields:
- `name`: skill ID (must match toolforge/skills directory name)
- `description`: one-line summary for skill registry
- `compatibility`: list of runtime/environment requirements

**Example structure**:

```bash
toolforge/skills/obsidian-ingest-wiki/
├── skill.json
├── src/index.ts
├── tests/index.test.ts
├── SKILL.md
├── INTEGRATION_DIAGRAM.md
├── README.md
└── docs/
    └── README.md
```

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

## Examples

### ✓ Tier 0 (Auto-Install)

- `obsidian:ingest-wiki` — validates staging, generates Claude prompt
- `kb:sync:obsidian` — stages raw sources to vault
- New linting rule
- Observability metric
- Documentation site update

### ✗ Tier 1 (Requires Approval)

- Rewrite auth middleware
- Add new database
- Break API contract
- Change approval process
- Multi-module refactor (>3 modules)

---

## Change Log

| Date | Change |
|------|--------|
| 2026-07-11 | Initial rule set: Tier 0 auto-install, Tier 1 for major features |

---

## Related Documents

- `CLAUDE.md` — Project instructions (cross-reference this doc)
- `docs/skills/` — Individual skill documentation
- Governance Package v1.0 — CIC-wide rules
