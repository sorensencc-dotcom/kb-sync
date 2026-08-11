# Lessons Learned Sub-Namespace Design

**Date:** 2026-08-10  
**Status:** Approved  
**Target Repository:** `kb-sync` (`c:/dev/kb-sync`)

---

## 1. Overview & Objectives

This design introduces a first-class `lessons` sub-namespace into the Obsidian vault architecture within the `kb-sync` repository. The sub-namespace systematically captures failed auto-repair runs, integration hurdles, and contract violations so that error patterns and programmatic remediation steps are persisted across future AI agent sessions and compiled into `repo_knowledge_pack.txt`.

### Key Architectural Choice: Approach 3 (Hybrid Deterministic Creation + Background LLM Enrichment)
- **Immediate Failure Interception:** When `gated-climb-repair.mjs` exhausts auto-repair attempts, it retains the raw artifact bundle in `_quarantine/<run_id>/` and synchronously writes a structured lesson document to `wiki/lessons/unallowed-diff-<run_id>.md`.
- **Zero-Latency Execution:** The initial lesson creation is fast and deterministic, preventing 90-second timeout violations in Git pre-commit or pre-push hooks.
- **Background LLM Enrichment:** Subsequent scheduled synthesis runs (`synthesize-wiki.ts`) detect lessons marked with `tags: ["needs-enrichment"]`, generate natural language root-cause analysis and programmatic fixes using the synthesis provider, and strip the `needs-enrichment` tag upon completion.

---

## 2. Vault Configuration & Folder Mapping

### 2.1 Configuration Update (`configs/obsidian.yaml`)
Append a mapping rule to map source paths under `lessons/` to the `lessons` folder:
```yaml
mapping_rules:
  - prefix: "lessons/"
    folder: "lessons"
```

### 2.2 Directory Layout
- **Disk Path:** `c:/dev/kb-sync/wiki/lessons/`
- **Vault Root Relative Path:** `wiki/lessons/`
- **Vault-Absolute Link Format:** Internal links inside lesson files must use vault-absolute links, e.g. `[[kb-sync/lessons/unallowed-diff-<run_id>]]` or `[[kb-sync/wiki/PathToEntity]]`.

---

## 3. Page Template & Contract Validation

### 3.1 Page Template (`modules/wiki/templates/lesson.md`)
```markdown
---
title: "[Short, Descriptive Title of the Error or Correction]"
category: "lessons"
status: "active"
tags: ["failure-pattern", "remediation", "pipeline", "needs-enrichment"]
---

### [Short, Descriptive Title of the Error or Correction]

#### 1. Context & Symptom
* **Target Subsystem / File:** [[kb-sync/wiki/PathToEntity]]
* **Error Signature / Output:** `[Insert exact terminal log or crash traceback]`
* **First Identified:** [YYYY-MM-DD] via Log entry [[kb-sync/wiki/Log]]

#### 2. Root Cause Analysis
Explain *why* the failure occurred. Connect the symptom to physical or logical constraints.

#### 3. Resolution & Prevention
Describe the exact solution implemented. Focus on programmatic fixes so future synthesis passes or agents can reuse the fix without repeating design steps.

#### 4. Source Citations
* **Staged Snapshot:** `_kb-sync-staging/kb-sync/<timestamp>/path/to/failed-file`
* **Diagnostic Reference:** [[kb-sync/wiki/concepts/deterministic-sync-pipeline]]
```

### 3.2 Category & Boundary Contract Updates
The `lessons` category and `lessons/` path boundary must be added across all vault contract modules:

1. **`modules/wiki/validate-contract.mjs`**:
   Add `"lessons"` to `ALLOWED_CATEGORIES`:
   ```javascript
   const ALLOWED_CATEGORIES = new Set([
     "daemons", "utilities", "sync-tools", "adapters", "mcp-servers", "scaffolds", "prototypes", "wiki", "lessons"
   ]);
   ```
2. **`modules/wiki/normalized-diff-guard.mjs`**:
   Add `"lessons"` to `ALLOWED_CATEGORIES`:
   ```javascript
   export const ALLOWED_CATEGORIES = new Set([
     "daemons", "utilities", "sync-tools", "adapters", "mcp-servers", "scaffolds", "prototypes", "wiki",
     "manifest", "spec", "readme", "pipeline", "lessons"
   ]);
   ```
3. **`modules/obsidian/synthesize-wiki.ts`**:
   Add `"lessons"` to `ALLOWED_CATEGORIES` and `"lessons/"` / `"kb-sync/lessons/"` to `ALLOWED_BOUNDARIES`:
   ```typescript
   const ALLOWED_CATEGORIES = new Set([
     "daemons", "utilities", "sync-tools", "adapters", "mcp-servers", "scaffolds", "prototypes", "wiki", "lessons"
   ]);
   const ALLOWED_BOUNDARIES = ["kb-sync/", "entities/", "concepts/", "utilities/", "daemons/", "scripts/", "tests/", "lessons/", "kb-sync/lessons/"];
   ```
4. **`modules/wiki/toolforge-kbsync-contract.json`**:
   Update contract schema descriptions to list `"lessons"` as a recognized frontmatter category.

---

## 4. Auto-Repair Interception & Background Enrichment

### 4.1 Failure Interception (`modules/wiki/gated-climb-repair.mjs`)
When `runGatedClimbRepair()` exhausts all repair passes (`attempts >= maxAttempts`):
1. **Retain Quarantine Bundle:** Write full raw diagnostic logs, diffs, and manifests to `_quarantine/<run_id>/`.
2. **Generate Deterministic Lesson File:** Write `wiki/lessons/unallowed-diff-<run_id>.md` using `generateLessonFromFailure()`:
   - Frontmatter set to:
     - `title`: `"Unallowed Diff Failure - Run <run_id>"`
     - `category`: `"lessons"`
     - `status`: `"active"`
     - `tags`: `["failure-pattern", "remediation", "pipeline", "needs-enrichment"]`
   - Section 1 (Context & Symptom) populated with target file, exact traceback, and run timestamp.
   - Section 2 (Root Cause Analysis) pre-populated with initial error logs.
   - Section 4 (Source Citations) links to `_quarantine/<run_id>/`.

### 4.2 Background LLM Enrichment Engine (`modules/obsidian/synthesize-wiki.ts`)
During scheduled background synthesis runs:
1. **Scan:** Parse files in `wiki/lessons/` using `parseDocument()` to identify notes containing `tags: ["needs-enrichment"]`.
2. **LLM Enrichment:** Construct prompt with Section 1 diagnostic logs and unallowed diffs; request synthesis provider to populate:
   - Section 2 (Root Cause Analysis): Natural language explanation connecting symptoms to logical constraints.
   - Section 3 (Resolution & Prevention): Actionable programmatic guidance to prevent recurrence.
3. **Tag Cleanup:** Rewrite document frontmatter atomically, removing `"needs-enrichment"` from `tags`.

---

## 5. Compactor & Knowledge Pack Integration

- **Knowledge Pack Generation:** Ingested files under `wiki/lessons/` are automatically flattened into `repo_knowledge_pack.txt` during staging runs.
- **Compactor Policy:** `wiki/lessons/` pages operate under a `Full` preservation policy in `configs/obsidian.yaml` (never outline-skeletonized) so diagnostic traces remain fully intact for AI retrieval.

---

## 6. Verification Plan

### 6.1 Automated Tests
- Run `npm run gov:validate-contract` or `node modules/wiki/validate-contract.mjs` to confirm `category: "lessons"` notes pass validation cleanly.
- Execute unit/integration tests for `gated-climb-repair.mjs` to verify failure interception creates `wiki/lessons/unallowed-diff-<run_id>.md` while retaining `_quarantine/<run_id>/`.
- Run typescript compilation (`npx tsc --noEmit`) to verify `synthesize-wiki.ts` type-checks cleanly.

### 6.2 Manual Verification
- Trigger a simulated repair failure in `gated-climb-repair.mjs` and verify deterministic lesson note creation.
- Perform a dry run of `synthesize-wiki.ts` to verify background enrichment scans and updates `"needs-enrichment"` tagged lesson notes.
