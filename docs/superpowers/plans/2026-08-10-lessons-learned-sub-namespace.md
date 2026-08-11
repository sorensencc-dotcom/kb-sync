# Lessons Learned Sub-Namespace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `lessons` sub-namespace across `kb-sync` configuration, page templates, contract validation, and auto-repair/enrichment loops to capture and reuse failure patterns.

**Architecture:** Hybrid deterministic file creation in `gated-climb-repair.mjs` upon auto-repair failure, combined with background LLM enrichment in `synthesize-wiki.ts` for notes tagged `needs-enrichment`. Contract schemas and boundary sets across validation and synthesis modules are updated to recognize `lessons` as a first-class wiki category.

**Tech Stack:** TypeScript / Node.js ES Modules (mjs), Obsidian Vault Schema, JSON Schema (draft-07), Vitest / Node test runner.

## Global Constraints

- **Vault-Absolute Link Format:** All internal links in lesson pages must be formatted as vault-absolute links, e.g. `[[kb-sync/lessons/unallowed-diff-<run_id>]]` or `[[kb-sync/wiki/PathToEntity]]`.
- **Allowed Categories:** `"lessons"` must be included in `ALLOWED_CATEGORIES` in `validate-contract.mjs`, `normalized-diff-guard.mjs`, and `synthesize-wiki.ts`.
- **Allowed Boundaries:** `"lessons/"` and `"kb-sync/lessons/"` must be included in `ALLOWED_BOUNDARIES` in `synthesize-wiki.ts`.
- **Quarantine Preservation:** Raw failure artifact bundles must remain in `_quarantine/<run_id>/` while deterministic lesson notes are generated in `wiki/lessons/`.

---

### Task 1: Vault Mapping, Template, & Contract Validation Updates

**Files:**
- Modify: `c:/dev/kb-sync/configs/obsidian.yaml:29-52`
- Modify: `c:/dev/kb-sync/modules/wiki/validate-contract.mjs:43-46`
- Modify: `c:/dev/kb-sync/modules/wiki/normalized-diff-guard.mjs:4-7`
- Modify: `c:/dev/kb-sync/modules/obsidian/synthesize-wiki.ts:21-24,222-224`
- Modify: `c:/dev/kb-sync/modules/wiki/toolforge-kbsync-contract.json:52-54`
- Create: `c:/dev/kb-sync/modules/wiki/templates/lesson.md`
- Test: `c:/dev/kb-sync/tests/schema-validation.test.ts` (or run contract linter)

**Interfaces:**
- Consumes: Contract validation API & Obsidian configuration parser
- Produces: Updated `ALLOWED_CATEGORIES` Set including `"lessons"`, `ALLOWED_BOUNDARIES` including `"lessons/"` & `"kb-sync/lessons/"`, and `lesson.md` template

- [ ] **Step 1: Write test for lessons category validation**

Create or update test in `tests/schema-validation.test.ts` to assert `category: "lessons"` is valid:
```typescript
import { test, expect } from 'vitest';
import { ALLOWED_CATEGORIES } from '../modules/wiki/normalized-diff-guard.mjs';

test('ALLOWED_CATEGORIES includes lessons category', () => {
  expect(ALLOWED_CATEGORIES.has('lessons')).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/schema-validation.test.ts`
Expected: FAIL (`expected false to be true`)

- [ ] **Step 3: Update `configs/obsidian.yaml`**

Append `lessons/` mapping rule to `configs/obsidian.yaml`:
```yaml
mapping_rules:
  - prefix: "lessons/"
    folder: "lessons"
```

- [ ] **Step 4: Update `validate-contract.mjs`, `normalized-diff-guard.mjs`, `synthesize-wiki.ts`, and `toolforge-kbsync-contract.json`**

In `modules/wiki/validate-contract.mjs`:
```javascript
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
git commit -m "feat(wiki): register lessons category, boundary, and template in vault contract"
```

---

### Task 2: Failure Interception in Auto-Repair Loop

**Files:**
- Modify: `c:/dev/kb-sync/modules/wiki/gated-climb-repair.mjs`
- Test: `c:/dev/kb-sync/tests/gated-climb-repair-lessons.test.mjs` (or similar test file)

**Interfaces:**
- Consumes: `gated-climb-repair.mjs` failure state (`attempts >= maxAttempts`), raw quarantine path, error trace, and target file path.
- Produces: `wiki/lessons/unallowed-diff-<run_id>.md` document with `tags: ["failure-pattern", "remediation", "pipeline", "needs-enrichment"]`.

- [ ] **Step 1: Write failing test for deterministic lesson generation on repair failure**

Create `tests/gated-climb-repair-lessons.test.mjs`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { generateLessonFromFailure } from '../modules/wiki/gated-climb-repair.mjs';

test('generateLessonFromFailure writes template-compliant markdown file', () => {
  const runId = 'test-run-123';
  const outDir = path.join(process.cwd(), 'wiki', 'lessons');
  fs.mkdirSync(outDir, { recursive: true });

  const lessonPath = generateLessonFromFailure({
    runId,
    error: 'UNALLOWED_DIFF_REJECTED: modified unauthorized line',
    targetPath: 'wiki/kb-sync/wiki/Test.md',
    quarantinePath: '_quarantine/test-run-123'
  });

  assert.strictEqual(fs.existsSync(lessonPath), true);
  const content = fs.readFileSync(lessonPath, 'utf8');
  assert.match(content, /category: "lessons"/);
  assert.match(content, /needs-enrichment/);
  
  // Cleanup test file
  if (fs.existsSync(lessonPath)) fs.unlinkSync(lessonPath);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/gated-climb-repair-lessons.test.mjs`
Expected: FAIL (`generateLessonFromFailure is not a function`)

- [ ] **Step 3: Implement `generateLessonFromFailure` and integrate into `gated-climb-repair.mjs`**

In `modules/wiki/gated-climb-repair.mjs`:
```javascript
export function generateLessonFromFailure({ runId, error, targetPath, quarantinePath }) {
  const dateStr = new Date().toISOString().split('T')[0];
  const lessonFileName = `unallowed-diff-${runId}.md`;
  const lessonsDir = path.join(process.cwd(), 'wiki', 'lessons');
  fs.mkdirSync(lessonsDir, { recursive: true });
  
  const lessonPath = path.join(lessonsDir, lessonFileName);
  const content = `---
title: "Unallowed Diff Failure - Run ${runId}"
category: "lessons"
status: "active"
tags: ["failure-pattern", "remediation", "pipeline", "needs-enrichment"]
---

### Unallowed Diff Failure - Run ${runId}

#### 1. Context & Symptom
* **Target Subsystem / File:** [[${targetPath || 'kb-sync/wiki/Unknown'}]]
* **Error Signature / Output:** \`${error || 'Unknown repair error'}\`
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

In `runGatedClimbRepair()`, when repair retries are exhausted (`attempts >= maxAttempts`):
```javascript
// Generate deterministic lesson file alongside quarantine bundle
generateLessonFromFailure({
  runId,
  error: lastError ? lastError.message : 'Max repair retries exceeded',
  targetPath: filePath,
  quarantinePath: finalQuarantinePath
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/gated-climb-repair-lessons.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit Task 2**

```bash
git add modules/wiki/gated-climb-repair.mjs tests/gated-climb-repair-lessons.test.mjs
git commit -m "feat(wiki): generate deterministic lesson files on gated climb repair failure"
```

---

### Task 3: Background LLM Enrichment Engine (`synthesize-wiki.ts`)

**Files:**
- Modify: `c:/dev/kb-sync/modules/obsidian/synthesize-wiki.ts`
- Test: `c:/dev/kb-sync/tests/synthesize-lessons-enrichment.test.ts` (or similar test file)

**Interfaces:**
- Consumes: `wiki/lessons/` files with `tags: ["needs-enrichment"]` and synthesis provider interface.
- Produces: Enriched lesson pages with populated Section 2 & 3 and removed `needs-enrichment` tag.

- [ ] **Step 1: Write test for background lesson enrichment scanner & tag cleanup**

Create `tests/synthesize-lessons-enrichment.test.ts`:
```typescript
import { test, expect } from 'vitest';
import { enrichLessonNode } from '../modules/obsidian/synthesize-wiki';

test('enrichLessonNode updates root cause and removes needs-enrichment tag', async () => {
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
`;

  const enriched = await enrichLessonNode(initialContent, {
    rootCause: 'Path normalization mismatch on Windows causing diff rejection.',
    prevention: 'Apply normalizePath before evaluating diff guard boundaries.'
  });

  expect(enriched).not.toContain('needs-enrichment');
  expect(enriched).toContain('Path normalization mismatch on Windows');
  expect(enriched).toContain('Apply normalizePath before evaluating diff guard boundaries');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/synthesize-lessons-enrichment.test.ts`
Expected: FAIL (`enrichLessonNode is not defined`)

- [ ] **Step 3: Implement `enrichLessonNode` and scanner in `synthesize-wiki.ts`**

In `modules/obsidian/synthesize-wiki.ts`:
```typescript
export async function enrichLessonNode(
  content: string, 
  analysis: { rootCause: string; prevention: string }
): Promise<string> {
  // Remove needs-enrichment tag
  let updated = content.replace(
    /tags:\s*\[(.*?)\]/,
    (match, p1) => {
      const tags = p1.split(',').map((t: string) => t.trim().replace(/^["']|["']$/g, ''));
      const filtered = tags.filter((t: string) => t !== 'needs-enrichment');
      return `tags: [${filtered.map((t: string) => `"${t}"`).join(', ')}]`;
    }
  );

  // Update Section 2: Root Cause Analysis
  updated = updated.replace(
    /#### 2\. Root Cause Analysis\n[\s\S]*?(?=\n#### 3\.)/,
    `#### 2. Root Cause Analysis\n${analysis.rootCause}\n`
  );

  // Update Section 3: Resolution & Prevention
  updated = updated.replace(
    /#### 3\. Resolution & Prevention\n[\s\S]*?(?=\n#### 4\.)/,
    `#### 3. Resolution & Prevention\n${analysis.prevention}\n`
  );

  return updated;
}

export async function processUnenrichedLessons(wikiDir: string, provider: any): Promise<number> {
  const lessonsDir = path.join(wikiDir, 'lessons');
  if (!fs.existsSync(lessonsDir)) return 0;

  const files = fs.readdirSync(lessonsDir).filter(f => f.endsWith('.md'));
  let enrichedCount = 0;

  for (const file of files) {
    const filePath = path.join(lessonsDir, file);
    const content = fs.readFileSync(filePath, 'utf8');

    if (content.includes('needs-enrichment')) {
      const analysis = await provider.analyzeFailureLesson(content);
      const enrichedContent = await enrichLessonNode(content, analysis);
      fs.writeFileSync(filePath, enrichedContent, 'utf8');
      enrichedCount++;
    }
  }

  return enrichedCount;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/synthesize-lessons-enrichment.test.ts`
Expected: PASS

- [ ] **Step 5: Commit Task 3**

```bash
git add modules/obsidian/synthesize-wiki.ts tests/synthesize-lessons-enrichment.test.ts
git commit -m "feat(wiki): add background LLM enrichment scanner and tag cleanup in synthesize-wiki"
```

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-10-lessons-learned-sub-namespace.md`.
