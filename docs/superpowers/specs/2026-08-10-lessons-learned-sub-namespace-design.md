# Lessons Learned Sub-Namespace Design (Sealed Contract v3)

**Date:** 2026-08-10  
**Status:** Approved for Implementation (Contract v3 Sealed)  
**Target Repository:** `kb-sync` (`c:/dev/kb-sync`)

---

## 1. Overview & Architectural Principles

This design specification establishes a canonical `lessons` sub-namespace inside the `kb-sync` Obsidian vault. The sub-namespace captures failed auto-repair runs, integration hurdles, and contract violations so error signatures and remediation steps are persisted for downstream AI agent retrieval.

### Architectural Choice: Hybrid Deterministic Creation + Background LLM Enrichment
1. **Immediate Interception (Deterministic):** When `runGatedClimbRepair()` exhausts repair attempts, it retains the quarantine bundle in `_quarantine/<run_id>/` and synchronously writes a structured lesson document to `<vault_root>/<wiki_dir>/<lessons_dir>/unallowed-diff-<run_id>-<fingerprint>.md`.
2. **Zero-Latency Execution:** The initial lesson creation is fast, offline, and deterministic, avoiding Git hook timeouts.
3. **Background Enrichment (LLM Pass):** Subsequent background synthesis runs (`synthesize-wiki.ts`) discover notes tagged `needs-enrichment`, request structured JSON root-cause and prevention fields from the synthesis provider, validate outputs, and atomically update the note while stripping `needs-enrichment`.

---

## 2. Single Canonical Vault Path Resolver & Configuration Integration

### 2.1 Configuration Integration (`configs/obsidian.yaml`)
`configs/obsidian.yaml` defines the root directory parameters. All code modules (`validate-contract.mjs`, `normalized-diff-guard.mjs`, `synthesize-wiki.ts`, `gated-climb-repair.mjs`) dynamically load these parameters via a shared helper:

```yaml
vault_root: "C:/dev/kb-sync"
wiki_dir: "wiki"
lessons_dir: "lessons"
index_filename: "Index.md"
log_filename: "Log.md"
```

### 2.2 Canonical Path Resolver
To eliminate path ambiguity across disk, vault, and link validators, a single canonical resolver function `resolveCanonicalVaultPath(inputPath)` is defined in `modules/wiki/validate-contract.mjs`:

```javascript
export function resolveCanonicalVaultPath(inputPath, config = { vault_root: "C:/dev/kb-sync", wiki_dir: "wiki", lessons_dir: "lessons" }) {
  // Strip leading vault_root, wiki_dir, or kb-sync/ prefixes
  let cleaned = inputPath.replace(/\\/g, '/').trim();
  cleaned = cleaned.replace(/^C:\/dev\/kb-sync\//i, '').replace(/^kb-sync\//i, '').replace(/^wiki\//i, '');
  
  if (!cleaned.startsWith(config.lessons_dir + '/')) {
    throw new Error(`Invalid lesson vault path '${inputPath}'. Must resolve under '${config.lessons_dir}/'`);
  }
  
  const vaultPath = cleaned; // e.g. "lessons/unallowed-diff-run1-a1b2c3d4.md"
  const diskPath = path.join(config.vault_root, config.wiki_dir, vaultPath);
  const wikiLink = `[[kb-sync/${vaultPath.replace(/\.md$/, '')}]]`;
  
  return { vaultPath, diskPath, wikiLink };
}
```

| Layer | Canonical Value | Example |
|---|---|---|
| **Vault Path (`vaultPath`)** | `lessons/<FileName>.md` | `lessons/unallowed-diff-run1-a1b2c3d4.md` |
| **Disk Storage Path (`diskPath`)** | `<vault_root>/<wiki_dir>/lessons/<FileName>.md` | `C:/dev/kb-sync/wiki/lessons/unallowed-diff-run1-a1b2c3d4.md` |
| **Wiki Link Format (`wikiLink`)** | `[[kb-sync/lessons/<FileNameWithoutExt>]]` | `[[kb-sync/lessons/unallowed-diff-run1-a1b2c3d4]]` |
| **Entity Link Format** | `[[kb-sync/wiki/<PathToEntity>]]` | `[[kb-sync/wiki/PathToEntity]]` |

Both `[[kb-sync/lessons/...]]` and `[[kb-sync/wiki/...]]` format styles share the required `kb-sync/` vault prefix, satisfying link integrity checks.

---

## 3. Machine-Checkable Contract & Schema Ownership

### 3.1 Schema Ownership (`modules/wiki/validate-contract.mjs`)
The `validateLessonSchema(content, filePath)` function is centrally exported by `modules/wiki/validate-contract.mjs` and re-used by `normalized-diff-guard.mjs` and `synthesize-wiki.ts`:

```javascript
export function validateLessonSchema(content, filePath) {
  const errors = [];
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return ["Missing required YAML frontmatter"];

  const frontmatter = jsYaml.load(fmMatch[1]);
  if (frontmatter.category !== "lessons") errors.push(`Category must be 'lessons', got '${frontmatter.category}'`);
  if (!frontmatter.title || typeof frontmatter.title !== 'string') errors.push("Missing valid frontmatter 'title'");
  if (!Array.isArray(frontmatter.tags) || !frontmatter.tags.includes("failure-pattern")) errors.push("Frontmatter 'tags' must contain 'failure-pattern'");

  const requiredHeadings = [
    "#### 1. Context & Symptom",
    "#### 2. Root Cause Analysis",
    "#### 3. Resolution & Prevention",
    "#### 4. Source Citations"
  ];
  for (const heading of requiredHeadings) {
    if (!content.includes(heading)) errors.push(`Missing required heading '${heading}'`);
  }

  return errors;
}
```

### 3.2 Category & Boundary Contract Updates
1. **`modules/wiki/validate-contract.mjs`**: Add `"lessons"` to `ALLOWED_CATEGORIES`.
2. **`modules/wiki/normalized-diff-guard.mjs`**: Add `"lessons"` to `ALLOWED_CATEGORIES`.
3. **`modules/obsidian/synthesize-wiki.ts`**: Add `"lessons"` to `ALLOWED_CATEGORIES` and `"lessons/"`, `"kb-sync/lessons/"` to `ALLOWED_BOUNDARIES`.
4. **`modules/wiki/toolforge-kbsync-contract.json`**: Update category property schema docs.

---

## 4. Failure Interception Contract (`gated-climb-repair.mjs`)

### 4.1 Fingerprint Specification
- **Input Encoding:** UTF-8 string concatenation: `normalizePath(targetPath) + "\n" + errorSignature.trim()`.
- **Normalization:** Forward slashes (`/`), LF line endings (`\n`), trimmed error signatures.
- **Hash Function:** Non-cryptographic identity digest using MD5 truncated to 8 hexadecimal chars (`crypto.createHash('md5').update(...).digest('hex').slice(0, 8)`). Used strictly for non-colliding identity naming.

### 4.2 Idempotency & Revision Policy
If a lesson with identity `unallowed-diff-<run_id>-<fingerprint>.md` already exists:
- **Identical Content:** Skip creation, log `LESSON_EXISTS_SKIP`, and return existing path.
- **New Evidence/Revision:** Write `unallowed-diff-<run_id>-<fingerprint>-rev2.md` (incrementing revision integer). Never append uncontracted timestamps.

### 4.3 Failure Semantics & Fail-Safe Boundary
- **Quarantine Failure:** If writing `_quarantine/<run_id>` fails, log error, abort lesson write, return `QUARANTINE_FAILED`.
- **Lesson Write Failure:** If writing the lesson fails, retain quarantine bundle, log `LESSON_WRITE_FAILED` in audit log, and return `QUARANTINED_LESSON_FAILED`.
- **Path Traversal Guard:** Resolve target disk path and throw error if path attempts to escape `<vault_root>/<wiki_dir>/<lessons_dir>/`.

---

## 5. Background LLM Enrichment & Transaction Semantics (`synthesize-wiki.ts`)

### 5.1 Reuse of Phase 13 Transaction Engine
Enrichment uses the existing `synthesize-wiki.ts` Phase 13 Journaled Recoverable Promotion:
1. **Locking:** Acquire `.wiki-synthesis.lock`.
2. **Transactional Workspace:** Clone active `wiki/` directory to `.transact-<sessionId>/`.
3. **Drafting:** Write enriched markdown files into `.transact-<sessionId>/lessons/`.
4. **Validation:** Run `validateLessonSchema()` and `validate-contract.mjs` against `.transact-<sessionId>/`.
5. **Atomic Promotion:** On 100% validation pass, atomically rename `.transact-<sessionId>/` to `wiki/`.
6. **Crash Recovery:** If process crashes or validation fails, delete `.transact-<sessionId>/`, restore from `.backup-<sessionId>/`, and release lock.

### 5.2 Byte-for-Byte Preservation Boundary
Preservation is defined strictly by exact string slices:
- **Header & Section 1:** `content.substring(0, content.indexOf("#### 2. Root Cause Analysis"))` is preserved byte-for-byte.
- **Section 4:** `content.substring(content.indexOf("#### 4. Source Citations"))` is preserved byte-for-byte.
- **Enrichment Insertion:** Replaces ONLY the string slice between `#### 2. Root Cause Analysis` and `#### 4. Source Citations`.
- **Tag Removal:** Remove `"needs-enrichment"` tag from frontmatter slice **only inside the transaction workspace prior to promotion**.
- **Oversized String Guard:** Reject provider payloads where `rootCause` or `prevention` exceeds 10,000 characters.

---

## 6. Real Knowledge Pack Producer Contract & Retention Policy

### 6.1 Knowledge Pack Authoritative Producer
- **Authoritative Producer Script:** `modules/notebooklm/ingest-notebooklm.sh` (triggered via `npm run kb:sync:notebooklm` or `schedule-task-wrapper-KB-Sync-Consolidate-Pack.ps1`).
- **Inclusion Rule:** Update `modules/notebooklm/ingest-notebooklm.sh` to scan `<vault_root>/<wiki_dir>/lessons/*.md` and append files into `.nlm_pack/repo_knowledge_pack.txt` formatted with headers:
  `--- START FILE: wiki/lessons/<FileName>.md ---`

### 6.2 Quarantine Retention Policy
- **Owner Script:** `modules/wiki/cleanup-staging-archives.mjs` (executed via `npm run wiki:cleanup-archives`).
- **Policy:** `_quarantine/<run_id>` directories older than 30 days are purged during routine cleanup.
- **Self-Contained Validity:** Lesson documents embed complete error trace logs inline in Section 1, ensuring lesson nodes remain 100% diagnostically valid after quarantine bundle purge.

---

## 7. Executable Test Matrix

| Test Suite | Command | Verified Behavior | Expected Result |
|---|---|---|---|
| **Contract Schema** | `npx vitest run tests/schema-validation.test.ts` | Validates `category: "lessons"`, boundaries, and required headings via `validateLessonSchema()` | PASS (exit code 0) |
| **Failure Interception** | `node --test tests/gated-climb-repair-lessons.test.mjs` | Verifies `runGatedClimbRepair` writes `_quarantine/` AND deterministic lesson file on retry exhaustion | PASS (exit code 0) |
| **Idempotency & Fingerprint** | `node --test tests/gated-climb-repair-lessons.test.mjs` | Asserts exact duplicate payload skips write; changed evidence creates `-rev2.md` | PASS (exit code 0) |
| **Enrichment & Boundary** | `npx vitest run tests/synthesize-lessons-enrichment.test.ts` | Verifies structured JSON response, byte-for-byte preservation of Sec 1 & 4, and tag removal | PASS (exit code 0) |
| **Fail-Soft Provider** | `npx vitest run tests/synthesize-lessons-enrichment.test.ts` | Offline/malformed provider returns error, leaving original file with `needs-enrichment` intact | PASS (exit code 0) |
| **Path Traversal Guard** | `npx vitest run tests/path-traversal-containment.test.ts` | Attempts to write lesson to `../../outside.md` throw containment exception | PASS (exit code 0) |
| **Transaction Recovery** | `npx vitest run tests/transaction-recovery.test.ts` | Simulates crash during enrichment; verifies rollback from `.backup-*` and clean lock release | PASS (exit code 0) |
| **Knowledge Pack Producer** | `bash modules/notebooklm/ingest-notebooklm.sh --dry-run` | Verifies `wiki/lessons/*.md` files appear in `.nlm_pack/repo_knowledge_pack.txt` | PASS (exit code 0) |
