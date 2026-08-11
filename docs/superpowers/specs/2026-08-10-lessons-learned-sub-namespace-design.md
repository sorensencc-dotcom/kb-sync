# Lessons Learned Sub-Namespace Design (Revised Contract)

**Date:** 2026-08-10  
**Status:** Under Revision (Contract Amendment v2)  
**Target Repository:** `kb-sync` (`c:/dev/kb-sync`)

---

## 1. Overview & Architectural Principles

This design specification establishes a canonical `lessons` sub-namespace inside the `kb-sync` Obsidian vault. The sub-namespace captures failed auto-repair runs, integration hurdles, and contract violations so error signatures and remediation steps are persisted for downstream AI agent retrieval.

### Architectural Choice: Hybrid Deterministic Creation + Background LLM Enrichment
1. **Immediate Interception (Deterministic):** When `runGatedClimbRepair()` exhausts repair attempts, it retains the quarantine bundle in `_quarantine/<run_id>/` and synchronously writes a structured lesson document to `wiki/lessons/unallowed-diff-<run_id>-<fingerprint>.md`.
2. **Zero-Latency Execution:** The initial lesson creation is fast, offline, and deterministic, avoiding Git hook timeouts.
3. **Background Enrichment (LLM Pass):** Subsequent background synthesis runs (`synthesize-wiki.ts`) discover notes tagged `needs-enrichment`, request structured JSON root-cause and prevention fields from the synthesis provider, validate outputs, and atomically update the note while stripping `needs-enrichment`.

---

## 2. Canonical Path & Mapping Model

To avoid path ambiguity across disk, vault, and link validators, a single canonical mapping model is enforced:

| Layer | Value / Format | Example |
|---|---|---|
| **Vault Root (`vault_root`)** | `C:/dev/kb-sync` (from `configs/obsidian.yaml`) | `C:/dev/kb-sync` |
| **Wiki Directory (`wiki_dir`)** | `wiki` (from `configs/obsidian.yaml`) | `C:/dev/kb-sync/wiki` |
| **Disk Storage Path** | `<vault_root>/<wiki_dir>/lessons/<FileName>.md` | `C:/dev/kb-sync/wiki/lessons/unallowed-diff-run1-a1b2.md` |
| **Vault-Relative Path** | `lessons/<FileName>.md` (relative to `wiki_dir`) | `lessons/unallowed-diff-run1-a1b2.md` |
| **Absolute Vault Identifier** | `kb-sync/lessons/<FileName>.md` | `kb-sync/lessons/unallowed-diff-run1-a1b2.md` |
| **Wiki Link Format** | `[[kb-sync/lessons/<FileNameWithoutExt>]]` | `[[kb-sync/lessons/unallowed-diff-run1-a1b2]]` |

### Configuration Updates (`configs/obsidian.yaml`)
Add `lessons_dir` to reserved wiki configuration keys:
```yaml
wiki_dir: "wiki"
lessons_dir: "lessons"
index_filename: "Index.md"
log_filename: "Log.md"
```

---

## 3. Machine-Checkable Page Template & Contract Validation

### 3.1 Template Specification (`modules/wiki/templates/lesson.md`)
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
Describe the exact solution implemented. Focus on programmatic fixes for agent reuse.

#### 4. Source Citations
* **Staged Snapshot:** `_kb-sync-staging/kb-sync/<timestamp>/path/to/failed-file`
* **Diagnostic Reference:** [[kb-sync/wiki/concepts/deterministic-sync-pipeline]]
```

### 3.2 Machine-Checkable Schema Contract
`validate-contract.mjs` and `normalized-diff-guard.mjs` will enforce strict structural validation for `category: "lessons"`:
- **Required Frontmatter:** `title` (string), `category` ("lessons"), `status` ("active" | "archived" | "beta"), `tags` (array containing `"failure-pattern"`).
- **Required Headings:**
  - `#### 1. Context & Symptom`
  - `#### 2. Root Cause Analysis`
  - `#### 3. Resolution & Prevention`
  - `#### 4. Source Citations`
- **Link Escaping & Boundaries:** All bracketed links inside body text must begin with `kb-sync/` or `wiki/` (e.g. `[[kb-sync/wiki/Path]]`).

### 3.3 Contract Code Enumerations
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
   Add `"lessons"` to `ALLOWED_CATEGORIES` and `"lessons/"`, `"kb-sync/lessons/"` to `ALLOWED_BOUNDARIES`:
   ```typescript
   const ALLOWED_CATEGORIES = new Set([
     "daemons", "utilities", "sync-tools", "adapters", "mcp-servers", "scaffolds", "prototypes", "wiki", "lessons"
   ]);
   const ALLOWED_BOUNDARIES = ["kb-sync/", "entities/", "concepts/", "utilities/", "daemons/", "scripts/", "tests/", "lessons/", "kb-sync/lessons/"];
   ```
4. **`modules/wiki/toolforge-kbsync-contract.json`**:
   Update `category` property schema documentation to explicitly include `"lessons"`.

---

## 4. Failure Interception Contract (`gated-climb-repair.mjs`)

### 4.1 Lesson Creation Authorization & Paths
`runGatedClimbRepair(options)` receives an explicit `vaultRoot` parameter (defaulting to `configs/obsidian.yaml` `vault_root`).
When auto-repair retries are exhausted (`attempts >= maxAttempts`):
1. **Quarantine Write:** Preserve raw bundle in `_quarantine/<run_id>/` (retention policy: 30 days).
2. **Fingerprint Calculation:** Compute `fingerprint = md5(targetFile + errorTrace).slice(0, 8)`.
3. **Identity & File Name:** Construct file name `unallowed-diff-<run_id>-<fingerprint>.md`.
4. **Idempotency Check:** If `wiki/lessons/unallowed-diff-<run_id>-<fingerprint>.md` already exists, skip duplicate creation or append timestamp.
5. **Deterministic Write:** Write the structured lesson file to `<vaultRoot>/wiki/lessons/unallowed-diff-<run_id>-<fingerprint>.md`.

---

## 5. Background LLM Enrichment Engine & Trust Boundary (`synthesize-wiki.ts`)

### 5.1 Enrichment Workflow & Schema
`synthesize-wiki.ts` implements a dedicated `--enrich-lessons` phase:
1. **Scan:** Search `wiki/lessons/` for files with frontmatter `tags` containing `"needs-enrichment"`.
2. **Provider Input:** Extract Section 1 (Context & Symptom) error signatures and Section 4 quarantine references.
3. **Structured Response Schema:** Demand JSON response matching schema:
   ```json
   {
     "type": "object",
     "required": ["rootCause", "prevention"],
     "properties": {
       "rootCause": { "type": "string" },
       "prevention": { "type": "string" }
     }
   }
   ```

### 5.2 Trust Boundary & Validation Guard
To prevent LLM hallucinations or corrupt writes:
- **Immutable Preservations:** Section 1 (Context & Symptom) and Section 4 (Source Citations) must remain byte-for-byte identical.
- **Fail-Soft Behavior:** If the provider fails, times out, or returns malformed JSON, log a warning, leave `needs-enrichment` intact, and abort changes for that file.
- **Atomic Transaction Write:** Draft enriched lesson content into `.transact-<sessionId>/wiki/lessons/`.
- **Contract & Diff Validation:** Pass enriched document through `validate-contract.mjs`.
- **Tag Removal:** Remove `"needs-enrichment"` tag **only after** schema validation passes cleanly in the transaction workspace.

---

## 6. Knowledge Pack Producer Contract

- **Producer Location:** `scripts/schedule-task-wrapper-KB-Sync-Consolidate-Pack.ps1` and `.nlm_pack` consolidation pipeline.
- **Contract Rule:** Update consolidation scripts to include `wiki/lessons/*.md` files into `.nlm_pack/repo_knowledge_pack.txt` under `--- START FILE: wiki/lessons/<file> ---` headers.

---

## 7. Comprehensive Test Matrix

| Test Suite | File | Verified Behavior |
|---|---|---|
| **Contract Schema** | `tests/schema-validation.test.ts` | Validates `category: "lessons"`, boundaries, and frontmatter constraints |
| **Failure Interception** | `tests/gated-climb-repair-lessons.test.mjs` | Verifies `gated-climb-repair` writes quarantine + deterministic lesson file on retry exhaustion |
| **Idempotency & Fingerprint** | `tests/gated-climb-repair-lessons.test.mjs` | Verifies rerun with duplicate run ID + fingerprint does not overwrite or crash |
| **Enrichment Parser** | `tests/synthesize-lessons-enrichment.test.ts` | Verifies structured JSON response, Section 2 & 3 replacement, and `needs-enrichment` removal |
| **Fail-Soft Provider** | `tests/synthesize-lessons-enrichment.test.ts` | Verifies malformed provider JSON leaves original file untouched with `needs-enrichment` |
| **Path Traversal Guard** | `tests/path-traversal-containment.test.ts` | Ensures lesson file writes cannot escape `wiki/lessons/` |
| **Knowledge Pack Pipeline** | `tests/consolidate-pack-lessons.test.ps1` | Asserts `wiki/lessons/*.md` files appear in compiled `.nlm_pack/repo_knowledge_pack.txt` |
