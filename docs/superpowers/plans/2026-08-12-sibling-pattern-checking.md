# Sibling Pattern Checking (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement automated Sibling Pattern Checking (Phase 2) in `kb-sync` to detect documentation drift and interface signature breakage during local Git workflow (pre-commit fail-soft, pre-push fail-closed).

**Architecture:** Build a native Node.js ES module `modules/wiki/sibling-checker.mjs` that inspects changed files against the repository's active dependency graph (`.nlm_pack/current_generation.json` -> `adjacency.json`) and `configs/obsidian.yaml` mapping rules. Integrate with bash pre-commit hook (fail-soft with TODOS.md task logging) and pre-push hook (fail-closed on structural signature violations).

**Tech Stack:** Node.js (ES Modules), Git CLI (`git diff`, `git rev-parse`), YAML parser (`js-yaml`), Vitest/Node test runner.

## Global Constraints

- **Repository Root:** `c:/dev/kb-sync`
- **Module format:** ES Modules (`.mjs`) for native execution without compilation overhead.
- **Fail-Soft Pre-Commit:** Hook must output warnings, stage TODO in `TODOS.md` with deduplication guard, and exit with status 0.
- **Fail-Closed Pre-Push:** Hook must abort push (exit status 1) if exported structural signatures change without corresponding sibling consumer file staging/updates.
- **Missing Telemetry Strategy:** Missing `.nlm_pack/current_generation.json` throws fail-closed error requiring DAG compilation.

---

### Task 1: Create Core Sibling Checker Engine (`modules/wiki/sibling-checker.mjs`)

**Files:**
- Create: `c:/dev/kb-sync/modules/wiki/sibling-checker.mjs`
- Test: `c:/dev/kb-sync/tests/sibling-checking-verification.test.ts`

**Interfaces:**
- Consumes: `.nlm_pack/current_generation.json`, `adjacency.json`, `configs/obsidian.yaml`, `git diff`
- Produces: `checkSiblingPatterns(changedFiles, repoRoot)` returning array of `{ type: 'wiki_drift' | 'signature_break', file: string, reason: string, sibling: string }`

- [ ] **Step 1: Write failing verification test for sibling checker engine**

Create `tests/sibling-checking-verification.test.ts` with test cases for:
1. Throwing error if `.nlm_pack/current_generation.json` is missing (fail-closed requirement).
2. Detecting code-to-wiki document drift when code file modified without sibling wiki doc update.
3. Detecting AST/regex export signature modifications on exported functions/classes/consts/interfaces.
4. Returning violations array for un-staged consumer siblings.

```typescript
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { checkSiblingPatterns, isStructuralSignatureChange, mapSourceToWikiSibling } from '../modules/wiki/sibling-checker.mjs';

describe('Sibling Pattern Checker Engine', () => {
  const repoRoot = path.resolve(__dirname, '..');

  it('should throw an error when active DAG current_generation pointer is missing', () => {
    expect(() => checkSiblingPatterns(['core/dag.mjs'], '/non/existent/repo')).toThrow(
      'Missing active DAG current_generation pointer. Compile DAG before committing.'
    );
  });

  it('should map source files to wiki siblings using obsidian.yaml rules', () => {
    const wikiSibling = mapSourceToWikiSibling('modules/obsidian/ingest-obsidian.sh', repoRoot);
    expect(wikiSibling).toBe('wiki/entities/obsidian/ingest-obsidian.sh.md');
  });

  it('should detect structural signature changes in diff string', () => {
    const exportDiff = `+ export function updateGraph(nodes) {`;
    const nonExportDiff = `+ // updated comments`;
    expect(isStructuralSignatureChange(exportDiff)).toBe(true);
    expect(isStructuralSignatureChange(nonExportDiff)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/sibling-checking-verification.test.ts`
Expected: FAIL with module import/function undefined error.

- [ ] **Step 3: Implement `modules/wiki/sibling-checker.mjs` engine**

```javascript
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import yaml from 'js-yaml';

/**
 * Maps a source relative path to its expected Wiki Sibling path based on configs/obsidian.yaml
 * @param {string} sourcePath - Relative path in repo
 * @param {string} repoRoot - Absolute repo root
 * @returns {string} Relative wiki sibling path
 */
export function mapSourceToWikiSibling(sourcePath, repoRoot) {
  const configPath = path.join(repoRoot, 'configs', 'obsidian.yaml');
  let mappingRules = [];
  let defaultFolder = 'Unsorted';
  let wikiDir = 'wiki';

  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf8');
    const doc = yaml.load(raw) || {};
    mappingRules = doc.mapping_rules || [];
    defaultFolder = doc.default_folder || defaultFolder;
    wikiDir = doc.wiki_dir || wikiDir;
  }

  let matchedFolder = defaultFolder;
  for (const rule of mappingRules) {
    if (sourcePath.startsWith(rule.prefix)) {
      matchedFolder = rule.folder;
      break;
    }
  }

  const filename = path.basename(sourcePath);
  return `${wikiDir}/${matchedFolder}/${filename}.md`.replace(/\/+/g, '/');
}

/**
 * Checks AST/regex diff for export signature changes
 * @param {string} diffOutput - Git diff string
 * @returns {boolean} True if export signature modified
 */
export function isStructuralSignatureChange(diffOutput) {
  if (!diffOutput) return false;
  return /^\+.*export\s+(function|class|const|interface|type|async\s+function)/im.test(diffOutput) ||
         /^\-.*export\s+(function|class|const|interface|type|async\s+function)/im.test(diffOutput);
}

/**
 * Main Sibling Pattern Validator
 * @param {Array<string>} changedFiles - List of staged/changed relative file paths
 * @param {string} repoRoot - Absolute repository root
 * @returns {Array<{type: string, file: string, sibling: string, reason: string}>} Array of violations
 */
export function checkSiblingPatterns(changedFiles, repoRoot) {
  const violations = [];
  const pointerPath = path.join(repoRoot, '.nlm_pack', 'current_generation.json');

  if (!fs.existsSync(pointerPath)) {
    throw new Error('Missing active DAG current_generation pointer. Compile DAG before committing.');
  }

  const pointer = JSON.parse(fs.readFileSync(pointerPath, 'utf8'));
  const activeGenDir = path.join(repoRoot, '.nlm_pack', 'generations', pointer.active_generation);
  const adjacencyPath = path.join(activeGenDir, 'adjacency.json');

  if (!fs.existsSync(adjacencyPath)) {
    throw new Error(`Missing adjacency.json in active generation directory: ${activeGenDir}`);
  }

  const adjacency = JSON.parse(fs.readFileSync(adjacencyPath, 'utf8'));
  const normalizedStaged = changedFiles.map(f => f.replace(/\\/g, '/').toLowerCase());

  for (const file of changedFiles) {
    const normalizedFile = file.replace(/\\/g, '/');
    
    // Skip checking wiki or staging files themselves as source code
    if (normalizedFile.startsWith('wiki/') || normalizedFile.startsWith('_kb-sync-staging/')) {
      continue;
    }

    // 1. Code-to-Wiki Document Sibling Check (Rule 1)
    const expectedWikiSibling = mapSourceToWikiSibling(normalizedFile, repoRoot);
    const wikiSiblingStaged = normalizedStaged.includes(expectedWikiSibling.toLowerCase());

    if (!wikiSiblingStaged) {
      const fullWikiPath = path.join(repoRoot, expectedWikiSibling);
      let isUpToDate = false;

      if (fs.existsSync(fullWikiPath)) {
        try {
          const wikiStat = fs.statSync(fullWikiPath);
          const gitLogTime = execSync(`git log -1 --format=%ct -- "${normalizedFile}"`, {
            cwd: repoRoot,
            encoding: 'utf8'
          }).trim();
          
          if (gitLogTime) {
            const codeCommitTime = parseInt(gitLogTime, 10) * 1000;
            if (wikiStat.mtimeMs >= codeCommitTime) {
              isUpToDate = true;
            }
          }
        } catch {
          // If git log fails or stat fails, assume out of date
        }
      }

      if (!isUpToDate) {
        violations.push({
          type: 'wiki_drift',
          file: normalizedFile,
          sibling: expectedWikiSibling,
          reason: `Code modified (${normalizedFile}) without corresponding staged wiki sibling update (${expectedWikiSibling}).`
        });
      }
    }

    // 2. Code-to-Code Consumer Signature Sibling Check (Rule 2)
    const fileId = `node:file:${normalizedFile.toLowerCase()}`;
    if (adjacency.reverse && adjacency.reverse[fileId]) {
      let diff = '';
      try {
        diff = execSync(`git diff -U0 HEAD -- "${normalizedFile}"`, { cwd: repoRoot, encoding: 'utf8' });
      } catch {
        diff = '';
      }

      if (isStructuralSignatureChange(diff)) {
        const consumers = adjacency.reverse[fileId];
        for (const consumerNode of consumers) {
          const consumerRelPath = consumerNode.source.replace('node:file:', '');
          const isConsumerStaged = normalizedStaged.includes(consumerRelPath.toLowerCase());

          if (!isConsumerStaged) {
            violations.push({
              type: 'signature_break',
              file: normalizedFile,
              sibling: consumerRelPath,
              reason: `Export signature modified in "${normalizedFile}". Consumer sibling "${consumerRelPath}" is not staged for verification.`
            });
          }
        }
      }
    }
  }

  return violations;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/sibling-checking-verification.test.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add modules/wiki/sibling-checker.mjs tests/sibling-checking-verification.test.ts
git commit -m "feat(wiki): add sibling pattern checking detection engine"
```

---

### Task 2: Implement Deduplicating TODO Tasks Appender

**Files:**
- Create/Modify: `modules/wiki/sibling-checker.mjs`
- Modify: `c:/dev/TODOS.md` or `c:/dev/kb-sync/TODOS.md`

**Interfaces:**
- Produces: `appendDriftTodo(violation, repoRoot)` appending formatted TODO to `TODOS.md` if not already present.

- [ ] **Step 1: Write failing test for TODO task appender**

Add unit test in `tests/sibling-checking-verification.test.ts`:

```typescript
import { appendDriftTodo } from '../modules/wiki/sibling-checker.mjs';

it('should append drift TODO task to TODOS.md without duplicates', () => {
  const violation = {
    type: 'wiki_drift',
    file: 'modules/obsidian/synthesize-wiki.ts',
    sibling: 'wiki/entities/obsidian/synthesize-wiki.ts.md',
    reason: 'Documentation Drift Detected'
  };

  const addedFirst = appendDriftTodo(violation, repoRoot);
  const addedSecond = appendDriftTodo(violation, repoRoot);

  expect(addedFirst).toBe(true);
  expect(addedSecond).toBe(false); // Deduplication guard caught duplicate
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx tsx tests/sibling-checking-verification.test.ts`
Expected: FAIL with `appendDriftTodo is not a function`.

- [ ] **Step 3: Add `appendDriftTodo` to `modules/wiki/sibling-checker.mjs`**

```javascript
/**
 * Appends a deduplicated documentation drift TODO item to TODOS.md
 * @param {Object} violation - Violation object from checkSiblingPatterns
 * @param {string} repoRoot - Absolute repository root
 * @returns {boolean} True if new TODO task was appended, false if skipped as duplicate
 */
export function appendDriftTodo(violation, repoRoot) {
  let todosPath = path.join(repoRoot, 'TODOS.md');
  if (!fs.existsSync(todosPath)) {
    const parentTodos = path.join(repoRoot, '..', 'TODOS.md');
    if (fs.existsSync(parentTodos)) {
      todosPath = parentTodos;
    } else {
      fs.writeFileSync(todosPath, '# TODOS\n\n## Open\n\n');
    }
  }

  const content = fs.readFileSync(todosPath, 'utf8');
  const dateStr = new Date().toISOString().split('T')[0];
  const todoTitle = `Documentation Drift: Sibling wiki page out of sync for ${violation.file}`;
  
  // Deduplication check
  if (content.includes(violation.file) && content.includes('Documentation Drift: Sibling wiki page out of sync')) {
    return false;
  }

  const todoLine = `- [ ] **[P2] ${todoTitle}** (${dateStr}) — Code file \`${violation.file}\` was updated without staged sibling wiki document \`${violation.sibling}\`. Update wiki doc to maintain LLM context integrity.\n`;

  let updatedContent = '';
  if (content.includes('## Open')) {
    updatedContent = content.replace('## Open\n', `## Open\n\n${todoLine}`);
  } else {
    updatedContent = `${content}\n\n## Open\n${todoLine}`;
  }

  fs.writeFileSync(todosPath, updatedContent, 'utf8');
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/sibling-checking-verification.test.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add modules/wiki/sibling-checker.mjs tests/sibling-checking-verification.test.ts
git commit -m "feat(wiki): add deduplicated TODO logging for documentation drift"
```

---

### Task 3: Integrate Engine into Pre-Commit Hook (`scripts/wiki-validate-precommit.sh`)

**Files:**
- Modify: `c:/dev/kb-sync/scripts/wiki-validate-precommit.sh:62-74`
- Test: `c:/dev/kb-sync/tests/sibling-checking-verification.test.ts`

**Interfaces:**
- Consumes: Node script wrapper `modules/wiki/run-sibling-check.mjs --mode=pre-commit`
- Behavior: Fail-Soft (exit code 0, warnings logged, TODO staged).

- [ ] **Step 1: Create Node CLI runner for pre-commit / pre-push hooks**

Create `modules/wiki/run-sibling-check.mjs`:

```javascript
import { checkSiblingPatterns, appendDriftTodo } from './sibling-checker.mjs';
import { execSync } from 'node:child_process';

const repoRoot = process.cwd();
const mode = process.argv.includes('--mode=pre-push') ? 'pre-push' : 'pre-commit';

try {
  const stagedFilesRaw = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' });
  const stagedFiles = stagedFilesRaw.split('\n').map(s => s.trim()).filter(Boolean);

  if (stagedFiles.length === 0) {
    process.exit(0);
  }

  const violations = checkSiblingPatterns(stagedFiles, repoRoot);

  if (violations.length === 0) {
    console.log('[SIBLING-CHECK] ✓ No sibling pattern violations detected.');
    process.exit(0);
  }

  let hasHardGateViolation = false;

  for (const v of violations) {
    if (v.type === 'wiki_drift') {
      console.warn(`\n[SIBLING-CHECK] [WARN] Documentation Drift Detected!`);
      console.warn(`  - Code modified: ${v.file}`);
      console.warn(`  - Missing wiki sibling update: ${v.sibling}`);
      
      const appended = appendDriftTodo(v, repoRoot);
      if (appended) {
        console.warn(`[✓] Staged a drift remediation TODO task in TODOS.md.`);
      }
    } else if (v.type === 'signature_break') {
      console.error(`\n[SIBLING-CHECK] [ERROR] Interface Signature Drift Detected!`);
      console.error(`  - Modified library: ${v.file}`);
      console.error(`  - Un-verified consumer sibling: ${v.sibling}`);
      console.error(`  - Reason: ${v.reason}`);
      hasHardGateViolation = true;
    }
  }

  if (mode === 'pre-push' && hasHardGateViolation) {
    console.error('\n[SIBLING-CHECK] Hard Gate Reject: Push aborted due to interface signature drift.');
    console.error('Update downstream consumers or use "git push --no-verify" to bypass.');
    process.exit(1);
  }

  console.log('\n[✓] Hook completed in fail-soft mode. Commit succeeded.');
  process.exit(0);
} catch (err) {
  if (mode === 'pre-push') {
    console.error(`[SIBLING-CHECK] Exception caught during check: ${err.message}`);
    process.exit(1);
  }
  console.warn(`[SIBLING-CHECK] [WARN] Sibling check encountered non-fatal error: ${err.message}`);
  process.exit(0);
}
```

- [ ] **Step 2: Update `scripts/wiki-validate-precommit.sh`**

Replace placeholder Step 2 in `scripts/wiki-validate-precommit.sh`:

```bash
# Step 2: Sibling Pattern Scope Check for Code Changes (Phase 2 Native Node Engine)
if [ -n "$CHANGED_CODE" ]; then
  echo "[SIBLING-CHECK] Performing sibling scope check for modified code files..."
  node modules/wiki/run-sibling-check.mjs --mode=pre-commit
fi
```

- [ ] **Step 3: Verify execution with simulated git pre-commit test**

Add test to `tests/sibling-checking-verification.test.ts`:
```typescript
it('should execute pre-commit hook in fail-soft mode with exit code 0', () => {
  const result = execSync('node modules/wiki/run-sibling-check.mjs --mode=pre-commit', { encoding: 'utf8' });
  expect(result).toContain('[SIBLING-CHECK]');
});
```

- [ ] **Step 4: Commit hook integration**

```bash
git add scripts/wiki-validate-precommit.sh modules/wiki/run-sibling-check.mjs tests/sibling-checking-verification.test.ts
git commit -m "feat(hooks): integrate Phase 2 sibling checker into pre-commit hook"
```

---

### Task 4: Implement Pre-Push Hook & npm Script Integration

**Files:**
- Create: `c:/dev/kb-sync/scripts/wiki-validate-prepush.sh`
- Modify: `c:/dev/kb-sync/package.json`

**Interfaces:**
- Consumes: `node modules/wiki/run-sibling-check.mjs --mode=pre-push`
- Behavior: Hard-gate rejection (exit code 1) on signature breakage.

- [ ] **Step 1: Create `scripts/wiki-validate-prepush.sh`**

```bash
#!/usr/bin/env bash
# Pre-push hook: Hard gate on structural signature mismatches (exit code 1)

set -e

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

echo "[SIBLING-CHECK] Executing Pre-Push Hard Gate Check..."
node modules/wiki/run-sibling-check.mjs --mode=pre-push
```

- [ ] **Step 2: Update `package.json` with setup scripts**

Add script `wiki:sibling-check` and `wiki:setup-push-hook` to `package.json`:

```json
"wiki:sibling-check": "node modules/wiki/run-sibling-check.mjs",
"wiki:setup-push-hook": "node -e \"const fs=require('fs');fs.mkdirSync('.git/hooks',{recursive:true});fs.copyFileSync('scripts/wiki-validate-prepush.sh','.git/hooks/pre-push');try{fs.chmodSync('.git/hooks/pre-push',0o755)}catch{}console.log('pre-push hook installed')\""
```

- [ ] **Step 3: Run verification tests**

Run: `npm run test:all`
Expected: PASS

- [ ] **Step 4: Commit pre-push hook configuration**

```bash
git add scripts/wiki-validate-prepush.sh package.json
git commit -m "feat(hooks): implement pre-push hard-gate hook and package.json commands"
```

---

## Verification Plan

### Automated Tests
- `npx tsx tests/sibling-checking-verification.test.ts`: Test deterministic mapping rules, export signature detection, fail-soft pre-commit execution, and deduplicated TODO logging.
- `npm run test:all`: Regression check across full kb-sync test suite.

### Manual Verification
- Staging a modified code file without updating its wiki sibling, running `git commit`, verifying warning output and `TODOS.md` entry creation without blocking commit.
- Modifying function export signatures in `core/path-normalizer.mjs`, running pre-push check `node modules/wiki/run-sibling-check.mjs --mode=pre-push`, verifying exit code 1 hard-gate rejection.
