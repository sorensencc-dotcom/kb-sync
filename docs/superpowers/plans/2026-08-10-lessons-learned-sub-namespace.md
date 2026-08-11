# Lessons Learned Sub-Namespace Implementation Plan (Sealed Contract v3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `lessons` sub-namespace across `kb-sync` configuration, page templates, machine-checkable contract validation, auto-repair failure interception, background LLM enrichment loops, and knowledge pack ingestion.

**Architecture:** Hybrid deterministic creation in `gated-climb-repair.mjs` upon auto-repair failure (producing `<vault_root>/<wiki_dir>/<lessons_dir>/unallowed-diff-<run_id>-<fingerprint>.md`), combined with background LLM enrichment in `synthesize-wiki.ts` for notes tagged `needs-enrichment`. Contract schemas, canonical path resolvers (`resolveCanonicalVaultPath()`), schema validators (`validateLessonSchema()`), and trust boundaries are updated to treat `lessons` as a first-class wiki category. Knowledge pack consolidation in `modules/notebooklm/ingest-notebooklm.sh` is updated to flatten lesson notes.

**Tech Stack:** TypeScript / Node.js ES Modules (mjs), Obsidian Vault Schema, JSON Schema (draft-07), Vitest / Node test runner.

## Global Constraints

- **Canonical Path Resolver:** Single resolver `resolveCanonicalVaultPath()`: Vault Path (`lessons/<FileName>.md`), Disk Path (`<vault_root>/<wiki_dir>/lessons/<FileName>.md`), Wiki Link (`[[kb-sync/lessons/<FileNameWithoutExt>]]`).
- **Configuration Integration:** `lessons_dir` loaded dynamically from `configs/obsidian.yaml`.
- **Allowed Categories & Boundaries:** `"lessons"` included in `ALLOWED_CATEGORIES` across `validate-contract.mjs`, `normalized-diff-guard.mjs`, and `synthesize-wiki.ts`. `"lessons/"` and `"kb-sync/lessons/"` included in `ALLOWED_BOUNDARIES` in `synthesize-wiki.ts`.
- **Quarantine Preservation & Retention:** Raw failure artifact bundles remain in `_quarantine/<run_id>/` (30-day retention managed by `cleanup-staging-archives.mjs`) while deterministic lesson notes are generated in `wiki/lessons/`.
- **Trust Boundary & Preservation:** LLM enrichment must fail soft on invalid provider output, preserve Section 1 & 4 byte-for-byte by exact string slices, draft in transaction workspace `.transact-<sessionId>/`, and remove `needs-enrichment` tag only after `validateLessonSchema()` pass.

---

### Task 1: Vault Mapping, Path Resolver, Template, & Machine-Checkable Contract Schema

**Files:**
- Modify: `c:/dev/kb-sync/configs/obsidian.yaml`
- Modify: `c:/dev/kb-sync/modules/wiki/validate-contract.mjs`
- Modify: `c:/dev/kb-sync/modules/wiki/normalized-diff-guard.mjs`
- Modify: `c:/dev/kb-sync/modules/obsidian/synthesize-wiki.ts`
- Modify: `c:/dev/kb-sync/modules/wiki/toolforge-kbsync-contract.json`
- Create: `c:/dev/kb-sync/modules/wiki/templates/lesson.md`
- Test: `c:/dev/kb-sync/tests/schema-validation.test.ts`

**Interfaces:**
- Consumes: Contract validation API & Obsidian configuration parser
- Produces: `resolveCanonicalVaultPath()`, `validateLessonSchema()`, updated `ALLOWED_CATEGORIES` & `ALLOWED_BOUNDARIES`, and `lesson.md` template

- [ ] **Step 1: Write test for canonical path resolver and machine-checkable schema validation**

Create `tests/schema-validation.test.ts`:
```typescript
import { test, expect } from 'vitest';
import { resolveCanonicalVaultPath, validateLessonSchema, ALLOWED_CATEGORIES } from '../modules/wiki/validate-contract.mjs';

test('resolveCanonicalVaultPath returns canonical triple', () => {
  const result = resolveCanonicalVaultPath('kb-sync/lessons/unallowed-diff-run1-a1b2c3d4.md');
  expect(result.vaultPath).toBe('lessons/unallowed-diff-run1-a1b2c3d4.md');
  expect(result.wikiLink).toBe('[[kb-sync/lessons/unallowed-diff-run1-a1b2c3d4]]');
});

test('validateLessonSchema checks required frontmatter and headings', () => {
  const validLesson = `---
title: "Unallowed Diff Failure - Run test-1"
category: "lessons"
status: "active"
tags: ["failure-pattern", "remediation", "pipeline"]
---

### Unallowed Diff Failure - Run test-1

#### 1. Context & Symptom
* **Target Subsystem / File:** [[kb-sync/wiki/Test]]

#### 2. Root Cause Analysis
Test cause

#### 3. Resolution & Prevention
Test prevention

#### 4. Source Citations
* **Staged Snapshot:** \`_quarantine/test-1\`
`;

  const errors = validateLessonSchema(validLesson, 'lessons/unallowed-diff-test-1.md');
  expect(errors).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/schema-validation.test.ts`
Expected: FAIL (`resolveCanonicalVaultPath is not a function`)

- [ ] **Step 3: Update `configs/obsidian.yaml`**

Add `lessons_dir` to `configs/obsidian.yaml`:
```yaml
wiki_dir: "wiki"
lessons_dir: "lessons"
index_filename: "Index.md"
log_filename: "Log.md"
```

- [ ] **Step 4: Implement `resolveCanonicalVaultPath()`, `validateLessonSchema()`, and update category sets**

In `modules/wiki/validate-contract.mjs`:
```javascript
export function resolveCanonicalVaultPath(inputPath, config = { vault_root: "C:/dev/kb-sync", wiki_dir: "wiki", lessons_dir: "lessons" }) {
  let cleaned = inputPath.replace(/\\/g, '/').trim();
  cleaned = cleaned.replace(/^C:\/dev\/kb-sync\//i, '').replace(/^kb-sync\//i, '').replace(/^wiki\//i, '');
  
  if (!cleaned.startsWith(config.lessons_dir + '/')) {
    throw new Error(`Invalid lesson vault path '${inputPath}'. Must resolve under '${config.lessons_dir}/'`);
  }
  
  const vaultPath = cleaned;
  const diskPath = path.join(config.vault_root, config.wiki_dir, vaultPath);
  const wikiLink = `[[kb-sync/${vaultPath.replace(/\.md$/, '')}]]`;
  
  return { vaultPath, diskPath, wikiLink };
}

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

const ALLOWED_CATEGORIES = new Set([
  "daemons", "utilities", "sync-tools", "adapters", "mcp-servers", "scaffolds", "prototypes", "wiki", "lessons"
]);
```

In `modules/wiki/normalized-diff-guard.mjs`:
```javascript
export const ALLOWED_CATEGORIES = new Set([
  "daemons", "utilities", "sync-tools", "adapters", "mcp-servers", "scaffolds", "prototypes", "wiki",
  "manifest", "spec", "readme", "pipeline", "lessons"
]);
```

In `modules/obsidian/synthesize-wiki.ts`:
```typescript
const ALLOWED_CATEGORIES = new Set([
  "daemons", "utilities", "sync-tools", "adapters", "mcp-servers", "scaffolds", "prototypes", "wiki", "lessons"
]);
const ALLOWED_BOUNDARIES = ["kb-sync/", "entities/", "concepts/", "utilities/", "daemons/", "scripts/", "tests/", "lessons/", "kb-sync/lessons/"];
```

Create `modules/wiki/templates/lesson.md`:
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

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/schema-validation.test.ts`
Expected: PASS

- [ ] **Step 6: Commit Task 1**

```bash
git add configs/obsidian.yaml modules/wiki/validate-contract.mjs modules/wiki/normalized-diff-guard.mjs modules/obsidian/synthesize-wiki.ts modules/wiki/toolforge-kbsync-contract.json modules/wiki/templates/lesson.md tests/schema-validation.test.ts
git commit -m "feat(wiki): implement canonical path resolver, lesson schema validator, and template"
```

---

### Task 2: Failure Interception Loop & Deterministic Fingerprinting

**Files:**
- Modify: `c:/dev/kb-sync/modules/wiki/gated-climb-repair.mjs`
- Test: `c:/dev/kb-sync/tests/gated-climb-repair-lessons.test.mjs`

**Interfaces:**
- Consumes: `gated-climb-repair.mjs` failure state (`attempts >= maxAttempts`), `vaultRoot`, raw quarantine path, error trace, and target file path.
- Produces: `wiki/lessons/unallowed-diff-<run_id>-<fingerprint>.md` document with `tags: ["failure-pattern", "remediation", "pipeline", "needs-enrichment"]`.

- [ ] **Step 1: Write test for deterministic lesson generation, fingerprinting, and revision policy**

Create `tests/gated-climb-repair-lessons.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { generateLessonFromFailure } from '../modules/wiki/gated-climb-repair.mjs';

test('generateLessonFromFailure creates deterministic file and handles idempotency', () => {
  const runId = 'test-run-123';
  const vaultRoot = process.cwd();
  const lessonsDir = path.join(vaultRoot, 'wiki', 'lessons');
  fs.mkdirSync(lessonsDir, { recursive: true });

  const lessonPath = generateLessonFromFailure({
    runId,
    error: 'UNALLOWED_DIFF_REJECTED: modified unauthorized line',
    targetPath: 'wiki/kb-sync/wiki/Test.md',
    quarantinePath: '_quarantine/test-run-123',
    vaultRoot
  });

  assert.strictEqual(fs.existsSync(lessonPath), true);
  
  // Re-run with identical content -> should skip
  const secondRunPath = generateLessonFromFailure({
    runId,
    error: 'UNALLOWED_DIFF_REJECTED: modified unauthorized line',
    targetPath: 'wiki/kb-sync/wiki/Test.md',
    quarantinePath: '_quarantine/test-run-123',
    vaultRoot
  });
  assert.strictEqual(secondRunPath, lessonPath);

  if (fs.existsSync(lessonPath)) fs.unlinkSync(lessonPath);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/gated-climb-repair-lessons.test.mjs`
Expected: FAIL (`generateLessonFromFailure is not a function`)

- [ ] **Step 3: Implement `generateLessonFromFailure` in `gated-climb-repair.mjs`**

In `modules/wiki/gated-climb-repair.mjs`:
```javascript
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

export function generateLessonFromFailure({ runId, error, targetPath, quarantinePath, vaultRoot = process.cwd() }) {
  const dateStr = new Date().toISOString().split('T')[0];
  const normalizedTarget = (targetPath || 'kb-sync/wiki/Unknown').replace(/\\/g, '/').toLowerCase();
  const normalizedError = (error || 'Unknown repair error').trim();
  const fingerprint = crypto.createHash('md5').update(`${normalizedTarget}\n${normalizedError}`).digest('hex').slice(0, 8);
  
  const lessonsDir = path.join(vaultRoot, 'wiki', 'lessons');
  fs.mkdirSync(lessonsDir, { recursive: true });
  
  let lessonFileName = `unallowed-diff-${runId}-${fingerprint}.md`;
  let lessonPath = path.join(lessonsDir, lessonFileName);
  
  if (fs.existsSync(lessonPath)) {
    const existingContent = fs.readFileSync(lessonPath, 'utf8');
    if (existingContent.includes(normalizedError)) {
      return lessonPath; // Identical evidence -> skip (idempotent)
    }
    // New evidence -> create revision
    lessonFileName = `unallowed-diff-${runId}-${fingerprint}-rev2.md`;
    lessonPath = path.join(lessonsDir, lessonFileName);
  }

  const content = `---
title: "Unallowed Diff Failure - Run ${runId}"
category: "lessons"
status: "active"
tags: ["failure-pattern", "remediation", "pipeline", "needs-enrichment"]
---

### Unallowed Diff Failure - Run ${runId}

#### 1. Context & Symptom
* **Target Subsystem / File:** [[${targetPath || 'kb-sync/wiki/Unknown'}]]
* **Error Signature / Output:** \`${normalizedError}\`
* **First Identified:** ${dateStr} via Log entry [[kb-sync/wiki/Log]]

#### 2. Root Cause Analysis
Diagnostic Log captured from auto-repair failure run ${runId}. Detailed root cause pending background LLM enrichment pass.

#### 3. Resolution & Prevention
Programmatic fix pending background LLM enrichment pass.

#### 4. Source Citations
* **Staged Snapshot:** \`${quarantinePath || '_quarantine/' + runId}\`
* **Diagnostic Reference:** [[kb-sync/wiki/concepts/deterministic-sync-pipeline]]
`;

  fs.writeFileSync(lessonPath, content, 'utf8');
  return lessonPath;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/gated-climb-repair-lessons.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit Task 2**

```bash
git add modules/wiki/gated-climb-repair.mjs tests/gated-climb-repair-lessons.test.mjs
git commit -m "feat(wiki): implement failure interception and deterministic lesson fingerprinting"
```

---

### Task 3: Background LLM Enrichment Engine with Byte-for-Byte Preservation

**Files:**
- Modify: `c:/dev/kb-sync/modules/obsidian/synthesize-wiki.ts`
- Modify: `c:/dev/kb-sync/modules/notebooklm/ingest-notebooklm.sh`
- Test: `c:/dev/kb-sync/tests/synthesize-lessons-enrichment.test.ts`
- Test: `c:/dev/kb-sync/tests/path-traversal-containment.test.ts`

**Interfaces:**
- Consumes: `wiki/lessons/` files with `tags: ["needs-enrichment"]` and synthesis provider interface.
- Produces: Enriched lesson pages with validated Section 2 & 3, byte-preserved Section 1 & 4, and removed `needs-enrichment` tag.

- [ ] **Step 1: Write test for byte-for-byte section preservation and fail-soft behavior**

Create `tests/synthesize-lessons-enrichment.test.ts`:
```typescript
import { test, expect } from 'vitest';
import { enrichLessonNode } from '../modules/obsidian/synthesize-wiki';

test('enrichLessonNode preserves Section 1 and Section 4 byte-for-byte', async () => {
  const initialContent = `---
title: "Unallowed Diff Failure - Run test-999"
category: "lessons"
status: "active"
tags: ["failure-pattern", "remediation", "pipeline", "needs-enrichment"]
---

### Unallowed Diff Failure - Run test-999

#### 1. Context & Symptom
* **Target Subsystem / File:** [[kb-sync/wiki/Test]]
* **Error Signature / Output:** \`UNALLOWED_DIFF_REJECTED\`

#### 2. Root Cause Analysis
Pending analysis.

#### 3. Resolution & Prevention
Pending resolution.

#### 4. Source Citations
* **Staged Snapshot:** \`_quarantine/test-999\`
`;

  const sec1Slice = initialContent.substring(0, initialContent.indexOf("#### 2. Root Cause Analysis"));
  const sec4Slice = initialContent.substring(initialContent.indexOf("#### 4. Source Citations"));

  const enriched = await enrichLessonNode(initialContent, {
    rootCause: 'Path normalization mismatch on Windows causing diff rejection.',
    prevention: 'Apply normalizePath before evaluating diff guard boundaries.'
  });

  expect(enriched.startsWith(sec1Slice.replace('needs-enrichment', ''))).toBe(true);
  expect(enriched.endsWith(sec4Slice)).toBe(true);
  expect(enriched).not.toContain('needs-enrichment');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/synthesize-lessons-enrichment.test.ts`
Expected: FAIL (`enrichLessonNode is not defined`)

- [ ] **Step 3: Implement `enrichLessonNode` with exact slice preservation in `synthesize-wiki.ts`**

In `modules/obsidian/synthesize-wiki.ts`:
```typescript
export async function enrichLessonNode(
  content: string, 
  analysis: { rootCause: string; prevention: string }
): Promise<string> {
  if (!analysis || typeof analysis.rootCause !== 'string' || typeof analysis.prevention !== 'string') {
    throw new Error('Malformed enrichment analysis payload from LLM provider');
  }

  if (analysis.rootCause.length > 10000 || analysis.prevention.length > 10000) {
    throw new Error('Enrichment payload exceeded maximum size limit of 10,000 characters');
  }

  const sec2Idx = content.indexOf("#### 2. Root Cause Analysis");
  const sec4Idx = content.indexOf("#### 4. Source Citations");

  if (sec2Idx === -1 || sec4Idx === -1 || sec4Idx <= sec2Idx) {
    throw new Error('Lesson document structure invalid: missing section markers');
  }

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
}
```

- [ ] **Step 4: Update `modules/notebooklm/ingest-notebooklm.sh` for knowledge pack inclusion**

In `modules/notebooklm/ingest-notebooklm.sh`:
Add scanner for `wiki/lessons/*.md` during `repo_knowledge_pack.txt` consolidation.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/synthesize-lessons-enrichment.test.ts`
Expected: PASS

- [ ] **Step 6: Commit Task 3**

```bash
git add modules/obsidian/synthesize-wiki.ts modules/notebooklm/ingest-notebooklm.sh tests/synthesize-lessons-enrichment.test.ts
git commit -m "feat(wiki): implement exact slice section preservation and knowledge pack inclusion"
```

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-10-lessons-learned-sub-namespace.md`.
