# Skill Approval & Installation Rules

**Effective Date**: 2026-07-11  
**Owner**: CIC Engineering  
**Status**: Active

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

### Tier 0: Minor Features & Skills (Auto-Install)

No Tier 1 approval required. Auto-install to toolforge library:

- New orchestration scripts/skills (bash, python)
- New npm scripts or CLI commands
- Documentation and guides
- Observability/logging improvements
- Bug fixes and patches
- Single-module enhancements

**Validation**: Caveman review (code quality) + author testing

**Timeline**: Immediate after code review

---

## Skill Installation Workflow

### 1. Development

Developer writes skill script (e.g., `modules/<domain>/<skill-name>.sh`):
- Follows module conventions (logging, error handling, config loading)
- Includes inline help/usage
- Tests locally: `bash modules/<domain>/<skill-name>.sh --help`

### 2. Code Review

**Caveman Review** (`/caveman:caveman-review`):
- One-liner findings format
- Terse, actionable comments
- No praise or filler
- Author fixes inline

**Approval**: If no blockers (bugs/risks), code is ready.

### 3. Documentation

Create skill doc: `docs/skills/<skill-name>.md`
- Purpose, inputs, outputs
- Usage examples
- Configuration
- Troubleshooting
- Related skills/workflows

Commit: Feature branch → main

### 4. npm Integration (Optional)

If skill runs via `npm run`, add to `package.json`:
```json
{
  "scripts": {
    "skill:name": "bash modules/domain/skill-name.sh"
  }
}
```

### 5. Validation & Testing

- ✓ Local test: runs without errors
- ✓ Caveman review: no blockers
- ✓ Docs complete: published to `docs/skills/`
- ✓ npm script works (if applicable)

### 6. Toolforge Auto-Install

Automatic on merge to main:
- Skill registered in toolforge library
- npm scripts available to all agents
- No manual deployment step

**Notification**: Slack #cic-dev with skill name, docs link, and usage

### 7. Agent Integration (Optional)

If agents need to call skill directly:
- Document in `docs/skills/<name>.md` under "Agent Integration"
- Add MCP server entry if needed
- Update agent integration guide

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
