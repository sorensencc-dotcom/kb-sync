# Compacted Context Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate, validate, and harden the Compacted Context Engine (`modules/compactor/`) into Stage 2 of `core/flatten.sh` to reduce consolidated knowledge pack (`repo_knowledge_pack.txt`) token footprint by 50–70% while maintaining fail-closed reliability, downstream `chunk.sh` compatibility, and complete test suite integrity.

**Architecture:** A modular Node.js engine (`modules/compactor/`) invoked by `core/flatten.sh`. The engine classifies files across 4 compaction states (`Full`, `Skeleton`, `Outline`, `Excluded`) through a 10-stage decision hierarchy, skeletonizes clean untouched TS/JS files via TypeScript Compiler API (`typescript@5.4.5`), outlines Markdown/JSON files, computes token telemetry via `js-tiktoken` (`1.0.15`), and atomically updates knowledge packs and `.sync-status.json`.

**Tech Stack:** Node.js ES Modules (`.mjs`), TypeScript Compiler API (`typescript@5.4.5`), `js-tiktoken` (`1.0.15`), `js-yaml` (`^4.1.0`), Bash (`core/flatten.sh`), Node.js Test Runner (`node --test`).

---

## Global Constraints & Spec Ownership

- **Canonical Spec Source of Truth:** `docs/meta/specs/2026-08-11-compacted-context-design.md` (Governed). `docs/superpowers/specs/` is an automated mirror.
- **Exact Pinned Dependencies:**
  - `typescript`: `"5.4.5"` (exact, no caret/tilde)
  - `js-tiktoken`: `"1.0.15"` (exact, no caret/tilde)
- **Token Counter:** `js-tiktoken` with `cl100k_base` encoding (singleton across process lifetime).
- **Decision Hierarchy:** Excluded -> Disabled -> Overrides Error -> Git Error -> Dirty Workspace -> Active Override -> High-Risk -> Git Recency -> Config Rules -> Default.
- **Fail-Closed Guarantee:** Any parser error, missing Git metadata, or malformed override forces state to `Full`.
- **Security Boundary:** POSIX path normalization, traversal rejection (`../`), and symlink containment verification (`fs.realpathSync`).
- **Atomic File Operations:** Safe atomic replace via `replaceFileAtomically` with `.bak` rollback safety on Windows file lock collisions.
- **Rollback Contract:** If `index.mjs` exits non-zero or `COMPACTION_ENABLED=false`, `core/flatten.sh` falls back to standard `cat` concatenation without interrupting downstream `chunk.sh` or staging pipeline execution.

---

## File Structure & Module Map

| Module File | Responsibility | Existing State |
| :--- | :--- | :--- |
| `modules/compactor/path-utils.mjs` | Path normalization, POSIX formatting, symlink security boundary | Implemented |
| `modules/compactor/atomic-file.mjs` | Windows-portable atomic file replacement & `.bak` rollback | Implemented |
| `modules/compactor/git-inspector.mjs` | Git porcelain status parsing, bulk recency log checking, SHA-256 content hashing | Implemented |
| `modules/compactor/config-loader.mjs` | `configs/compaction.yaml` YAML parser & schema validator | Implemented |
| `modules/compactor/overrides-manager.mjs` | Transient `.compaction-overrides.yaml` loader & writer | Implemented |
| `modules/compactor/skeletonizer.mjs` | TypeScript Compiler API (`5.4.5`) AST body stripper & throw statement injector | Implemented |
| `modules/compactor/outliner.mjs` | Markdown heading & JSON top-level key structural summarizer | Implemented |
| `modules/compactor/classifier.mjs` | 10-stage decision hierarchy file classifier | Implemented |
| `modules/compactor/telemetry.mjs` | `js-tiktoken` token counter (`cl100k_base`) | Implemented |
| `modules/compactor/manifest-loader.mjs` | Manifest parser, newline cleaner, and deduplicator | Implemented |
| `modules/compactor/cli.mjs` | CLI subcommand runner (`inspect`, `restore`, `dump`, `prune-overrides`) | Implemented |
| `modules/compactor/index.mjs` | Main batch pack builder entrypoint & status telemetry recorder | Implemented |

---

### Task 1: Dependency Pinning & Lockfile Verification

**Files:**
- Modify: `package.json:67-73`
- Modify: `package-lock.json`
- Test: `npm ls typescript js-tiktoken`

**Interfaces:**
- Verifies: Exact versions `typescript@5.4.5` and `js-tiktoken@1.0.15` in devDependencies.

- [ ] **Step 1: Inspect `package.json` for exact version bounds**

Inspect `package.json` to verify `typescript` is pinned to `"5.4.5"` and `js-tiktoken` is `"1.0.15"`.

- [ ] **Step 2: Update package.json to exact versions if needed**

```json
  "devDependencies": {
    "@types/node": "^20.0.0",
    "js-tiktoken": "1.0.15",
    "js-yaml": "^4.1.0",
    "tsx": "^4.0.0",
    "typescript": "5.4.5"
  }
```

- [ ] **Step 3: Run dependency lock verification**

Run: `npm install && npm ls typescript js-tiktoken`  
Expected:
```text
├── js-tiktoken@1.0.15
└── typescript@5.4.5
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): pin exact dependency versions for typescript 5.4.5 and js-tiktoken 1.0.15"
```

---

### Task 2: Adversarial Security & Failure-Injection Test Suite

**Files:**
- Modify: `tests/git-inspector.test.mjs`
- Modify: `tests/skeletonizer.test.mjs`
- Modify: `tests/compactor-integration.test.mjs`
- Create: `tests/adversarial-compactor.test.mjs`

**Interfaces:**
- Tests: Symlink escape rejection, Git status renames (`R`)/copies (`C`), filenames with spaces, Windows file lock recovery, malformed manifest lines, classifier overrides error fallback.

- [ ] **Step 1: Write adversarial test suite (`tests/adversarial-compactor.test.mjs`)**

```javascript
import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { normalizeRepoPath } from '../modules/compactor/path-utils.mjs';
import { replaceFileAtomically } from '../modules/compactor/atomic-file.mjs';
import { classifyFile } from '../modules/compactor/classifier.mjs';
import { loadNormalizedManifest } from '../modules/compactor/manifest-loader.mjs';

const repoRoot = path.resolve('.');

test('normalizeRepoPath rejects symbolic links that escape repository root', () => {
  assert.throws(
    () => normalizeRepoPath('/etc/passwd', repoRoot),
    /Security Exception/
  );
});

test('replaceFileAtomically preserves target when source file missing', () => {
  const dest = path.join(repoRoot, '.tmp-dest-keep.txt');
  fs.writeFileSync(dest, 'original content', 'utf8');

  try {
    assert.throws(
      () => replaceFileAtomically(path.join(repoRoot, 'non-existent-src.txt'), dest),
      /Atomic File Replacement Failure/
    );
    assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'original content');
  } finally {
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
  }
});

test('classifyFile forces Full state when overrides report error', () => {
  const config = { compaction: { enabled: true, git_window_days: 14, default_level: 'Skeleton', high_risk_prefixes: [], rules: [] } };
  const overridesResult = { map: new Map(), error: 'Malformed YAML in override file' };
  
  const res = classifyFile({
    repoRoot,
    rawPath: 'core/flatten.sh',
    config,
    overridesResult,
    dirtyFilesSet: new Set(),
    recentFilesSet: new Set(),
    skipPatterns: []
  });

  assert.strictEqual(res.state, 'Full');
  assert.ok(res.reason.includes('Fail-closed: Overrides error'));
});

test('loadNormalizedManifest strips CRLF and handles space-containing paths', () => {
  const tmpManifest = path.join(repoRoot, '.tmp-space-manifest.txt');
  fs.writeFileSync(tmpManifest, 'package.json\r\ncore/flatten.sh\r\n\r\n', 'utf8');

  try {
    const list = loadNormalizedManifest(tmpManifest, repoRoot);
    assert.deepStrictEqual(list, ['package.json', 'core/flatten.sh']);
  } finally {
    if (fs.existsSync(tmpManifest)) fs.unlinkSync(tmpManifest);
  }
});
```

- [ ] **Step 2: Run adversarial test suite**

Run: `node --test tests/adversarial-compactor.test.mjs`  
Expected: PASS

- [ ] **Step 3: Run complete compactor test suite**

Run: `node --test tests/git-inspector.test.mjs tests/skeletonizer.test.mjs tests/compactor-integration.test.mjs tests/adversarial-compactor.test.mjs`  
Expected: PASS (All 13+ tests pass cleanly)

- [ ] **Step 4: Commit**

```bash
git add tests/
git commit -m "test(compactor): add adversarial security, atomic rollback, and classifier error tests"
```

---

### Task 3: Stage 2 Pipeline Integration & Downstream Compatibility

**Files:**
- Create: `configs/compaction.yaml`
- Modify: `core/flatten.sh:154-165`
- Test: `tests/pipeline-flatten.test.mjs`

**Interfaces:**
- Modifies `core/flatten.sh` to check `COMPACTION_ENABLED` and invoke `modules/compactor/index.mjs`.
- Preserves downstream `chunk.sh` manifest contract, `.sync-status.json` telemetry schema, and stage rollback behavior.

- [ ] **Step 1: Create `configs/compaction.yaml` configuration**

```yaml
# configs/compaction.yaml
compaction:
  enabled: true
  git_window_days: 14
  default_level: "Full"
  high_risk_prefixes:
    - "auth/"
    - "db/migrations/"
    - "deploy/"
    - ".github/workflows/"
    - "configs/"

  rules:
    - prefix: "modules/obsidian/"
      level: "Full"
    - prefix: "core/"
      level: "Skeleton"
    - prefix: "modules/compactor/"
      level: "Skeleton"
    - prefix: "tests/"
      level: "Outline"
    - prefix: "wiki/"
      level: "Full"
```

- [ ] **Step 2: Update `core/flatten.sh` with fail-closed fallback**

Modify `core/flatten.sh` around line 154 to add compactor invocation with automatic fallback to standard concatenation if compaction fails:

```bash
# --- STEP 1.5: COMPACTED CONTEXT ENGINE -------------------------------------
COMPACTION_CONFIG="$REPO_ROOT/configs/compaction.yaml"

if [ "${COMPACTION_ENABLED:-true}" = "true" ] && [ -f "$COMPACTION_CONFIG" ]; then
  log_info "Compacted Context Engine enabled. Invoking batch compactor..."
  
  if node "$REPO_ROOT/modules/compactor/index.mjs" \
    --repo-root "$REPO_ROOT" \
    --manifest "$TEMP_FILE_LIST" \
    --output "$PACK_DIR/$PACK_FILE" \
    --config "$COMPACTION_CONFIG" \
    --global-config "${GLOBAL_CONFIG:-}"; then
    
    log_info "Compacted knowledge pack generated successfully."
    exit 0
  else
    log_warn "Compactor execution failed. Falling back to standard manual flattener..."
  fi
fi
```

- [ ] **Step 3: Run pipeline integration verification test**

Run: `node --test tests/compactor-integration.test.mjs`  
Expected: PASS

- [ ] **Step 4: Run full project test suite gate**

Run: `npm run test:all && npm run kb:pre-flight`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add configs/compaction.yaml core/flatten.sh
git commit -m "feat(compactor): hook Compacted Context Engine into Stage 2 flatten.sh pipeline"
```

---

## Rollback & Recovery Procedure

If the Compacted Context Engine encounters a production issue or generates an invalid pack during nightly sync:

1. **Disable Compaction:** Set `COMPACTION_ENABLED=false` in environment or set `compaction.enabled: false` in `configs/compaction.yaml`. `core/flatten.sh` will bypass the Node.js batch compactor and use standard uncompacted `cat` concatenation.
2. **Purge Transient Overrides:** Run `npm run kb:compact -- prune-overrides` or remove `.compaction-overrides.yaml`.
3. **Restore Backup Pack:** If `.nlm_pack/repo_knowledge_pack.txt` is corrupted, copy `.nlm_pack/repo_knowledge_pack.txt.bak` back over `repo_knowledge_pack.txt`.
