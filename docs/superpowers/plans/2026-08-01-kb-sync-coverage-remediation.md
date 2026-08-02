# kb-sync Coverage & Link Health Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Increase `kb-sync` Source-to-Wiki Coverage Score from 48.57% to >90% and Link Health from 75.76% to >95% by creating missing concept/entity wiki pages, updating obsidian mapping rules, and repairing broken cross-references.

**Architecture:** Create missing wiki pages in `wiki/concepts/` and `wiki/entities/`, update `configs/obsidian.yaml` and `wiki/Index.md`, and repair broken relative links in `docs/`.

## Global Constraints

- **Coverage Floor:** Target coverage score >90%.
- **Link Health Floor:** Target link health score >95%.
- **Verification:** Run `npm run kb:coverage` and `npx tsx tests/coverage-audit.test.ts` to verify score increases.

---

### Task 1: Create Missing Wiki Concept & Entity Pages

**Files:**
- Create: `wiki/concepts/deterministic-sync-pipeline.md`
- Create: `wiki/concepts/raw-source-staging.md`
- Create: `wiki/concepts/manifest-mode.md`
- Create: `wiki/entities/chunk.sh.md`
- Create: `wiki/entities/rollback.sh.md`
- Create: `wiki/entities/validate.sh.md`
- Create: `wiki/entities/path-normalizer.mjs.md`
- Create: `wiki/entities/detect-drift.ts.md`
- Create: `wiki/entities/generate-delta-summary.ts.md`
- Create: `wiki/entities/audit-coverage.ts.md`
- Modify: `wiki/Index.md`

- [ ] **Step 1: Write missing concept pages**

Create concept docs in `wiki/concepts/` adhering to the Karpathy LLM-wiki schema.

- [ ] **Step 2: Write missing entity pages**

Create entity docs in `wiki/entities/` for core scripts and new TS telemetry modules.

- [ ] **Step 3: Update `wiki/Index.md`**

Register all new entity and concept pages in `wiki/Index.md`.

- [ ] **Step 4: Commit**

```bash
git add wiki/
git commit -m "docs(wiki): add missing core concept and entity pages to wiki"
```

---

### Task 2: Update Mapping Rules & Fix Broken Cross-References

**Files:**
- Modify: `configs/obsidian.yaml`
- Modify: `docs/SESSION_WRAP_UP_2026-07-26.md`
- Modify: `docs/targets/obsidian.md`

- [ ] **Step 1: Update `configs/obsidian.yaml` mapping rules**

Add rules mapping `core/`, `scripts/`, `modules/wiki/`, `modules/artifact-generator/` to corresponding wiki directories.

- [ ] **Step 2: Repair broken links in `docs/SESSION_WRAP_UP_2026-07-26.md` and `docs/targets/obsidian.md`**

Correct stale paths and anchor links.

- [ ] **Step 3: Run coverage audit & verify score >90%**

Run: `npm run kb:coverage`
Expected: Coverage score >90%, Link Health >95%.

- [ ] **Step 4: Commit & Push**

```bash
git add configs/obsidian.yaml docs/
git commit -m "docs(coverage): update mapping rules and fix broken cross-references"
git push origin main
```
