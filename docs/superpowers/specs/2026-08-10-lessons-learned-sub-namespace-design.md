---
title: "2026 08 10 lessons learned sub namespace design"
category: "wiki"
status: "active"
---

# Lessons Learned Sub-Namespace Design (Sealed Contract v4)

**Date:** 2026-08-10  
**Status:** Approved for Implementation (Contract v4 Hardened)  
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
vault_root: "./" # Environment or CLI parameter agnostic
wiki_dir: "wiki"
lessons_dir: "lessons"
index_filename: "Index.md"
log_filename: "Log.md"
```

### 2.2 Cross-Platform Canonical Path Resolver
To eliminate path ambiguity across disk, vault, and link validators, a single canonical resolver function `resolveCanonicalVaultPath(inputPath)` is defined in `modules/wiki/validate-contract.mjs`:

```javascript
import path from 'path';

export function resolveCanonicalVaultPath(inputPath, config = { vault_root: process.cwd(), wiki_dir: "wiki", lessons_dir: "lessons" }) {
  const normInput = path.normalize(inputPath).replace(/\\/g, '/').trim();
  const normVaultRoot = path.normalize(config.vault_root).replace(/\\/g, '/').trim();
  
  // Cross-platform path relative extraction
  let relativePath = normInput;
  if (normInput.toLowerCase().startsWith(normVaultRoot.toLowerCase())) {
    relativePath = path.relative(config.vault_root, inputPath).replace(/\\/g, '/');
  }
  
  // Strip leading wiki/ or kb-sync/ prefixes
  let cleaned = relativePath.replace(/^kb-sync\//i, '').replace(/^wiki\//i, '');
  
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

### 3.1 Robust Schema Ownership (`modules/wiki/validate-contract.mjs`)
The `validateLessonSchema(content, filePath)` function is centrally exported by `modules/wiki/validate-contract.mjs` and re-used by `normalized-diff-guard.mjs` and `synthesize-wiki.ts`. It parses frontmatter using a multi-doc fence delimiter split for CRLF/POSIX robustness:

```javascript
import jsYaml from 'js-yaml';

export function validateLessonSchema(content, filePath) {
  const errors = [];
  const parts = content.split(/^---\r?\n/m);
  if (parts.length < 3) return ["Missing required YAML frontmatter block"];

  let frontmatter;
  try {
    frontmatter = jsYaml.load(parts[1]);
  } catch (err) {
    return [`YAML frontmatter parse error: ${err.message}`];
  }

  if (!frontmatter || typeof frontmatter !== 'object') return ["Invalid frontmatter structure"];
  if (frontmatter.category !== "lessons") errors.push(`Category must be 'lessons', got '${frontmatter.category}'`);
  if (!frontmatter.title || typeof frontmatter.title !== 'string') errors.push("Missing valid frontmatter 'title'");
  if (!Array.isArray(frontmatter.tags) || !frontmatter.tags.includes("failure-pattern")) errors.push("Frontmatter 'tags' must contain 'failure-pattern'");

  const requiredHeadings = [
    /#### 1\. Context & Symptom/i,
    /#### 2\. Root Cause Analysis/i,
    /#### 3\. Resolution & Prevention/i,
    /#### 4\. Source Citations/i
  ];
  for (const headingRegex of requiredHeadings) {
    if (!headingRegex.test(content)) errors.push(`Missing required heading matching '${headingRegex.source}'`);
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

### 4.2 Idempotency & Revision Counter Policy
If a lesson with identity `unallowed-diff-<run_id>-<fingerprint>.md` already exists:
- **Identical Content:** Skip creation, log `LESSON_EXISTS_SKIP`, and return existing path.
- **New Evidence/Revision:** Query existing revisions (`-rev*.md`) in `<lessons_dir>/`, find max revision integer $N$, and write `unallowed-diff-<run_id>-<fingerprint>-rev${N+1}.md`. Never append uncontracted timestamps.

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

### 5.2 Case-Insensitive Slice Preservation Boundary
Preservation is defined strictly by exact string slices located via case-insensitive heading search:
```typescript
const sec2Match = content.match(/#### 2\. Root Cause Analysis/i);
const sec4Match = content.match(/#### 4\. Source Citations/i);

if (!sec2Match || !sec4Match || sec4Match.index! <= sec2Match.index!) {
  throw new Error('Lesson document structure invalid: missing section markers');
}

const sec2Idx = sec2Match.index!;
const sec4Idx = sec4Match.index!;

// Preserve Section 1 slice byte-for-byte (updating frontmatter tags)
let sec1Slice = content.substring(0, sec2Idx);
sec1Slice = sec1Slice.replace(
  /tags:\s*\[(.*?)\]/,
  (match, p1) => {
    const tags = p1.split(',').map((t: string) => t.trim().replace(/^["']|["']$/g, ''));
    const filtered = tags.filter((t: string) => t !== 'needs-enrichment');
    return `tags: [${filtered.map((t: string) => `"${t}"`).join(', ')}]`;
  }
);

// Preserve Section 4 slice byte-for-byte
const sec4Slice = content.substring(sec4Idx);

// Replace ONLY Sections 2 and 3
const enrichedMiddle = `#### 2. Root Cause Analysis\n${analysis.rootCause.trim()}\n\n#### 3. Resolution & Prevention\n${analysis.prevention.trim()}\n\n`;

return sec1Slice + enrichedMiddle + sec4Slice;
```

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
| **Idempotency & Fingerprint** | `node --test tests/gated-climb-repair-lessons.test.mjs` | Asserts exact duplicate payload skips write; changed evidence creates `-revN.md` counter | PASS (exit code 0) |
| **Enrichment & Boundary** | `npx vitest run tests/synthesize-lessons-enrichment.test.ts` | Verifies structured JSON response, byte-for-byte preservation of Sec 1 & 4 via case-insensitive matcher, and tag removal | PASS (exit code 0) |
| **Fail-Soft Provider** | `npx vitest run tests/synthesize-lessons-enrichment.test.ts` | Offline/malformed provider returns error, leaving original file with `needs-enrichment` intact | PASS (exit code 0) |
| **Path Traversal Guard** | `npx vitest run tests/path-traversal-containment.test.ts` | Attempts to write lesson to `../../outside.md` throw containment exception | PASS (exit code 0) |
| **Transaction Recovery** | `npx vitest run tests/transaction-recovery.test.ts` | Simulates crash during enrichment; verifies rollback from `.backup-*` and clean lock release | PASS (exit code 0) |
| **Knowledge Pack Producer** | `bash modules/notebooklm/ingest-notebooklm.sh --dry-run` | Verifies `wiki/lessons/*.md` files appear in `.nlm_pack/repo_knowledge_pack.txt` | PASS (exit code 0) |
