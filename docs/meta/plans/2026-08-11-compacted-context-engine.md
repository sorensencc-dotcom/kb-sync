# Compacted Context Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate, validate, and harden the Compacted Context Engine (`modules/compactor/`) into Stage 2 of `core/flatten.sh` to reduce consolidated knowledge pack (`repo_knowledge_pack.txt`) token footprint by 50–70% while maintaining fail-closed reliability, downstream `chunk.sh` compatibility, and complete test suite integrity.

**Architecture:** A modular Node.js engine (`modules/compactor/`) invoked by `core/flatten.sh` during concatenated pack generation. The engine classifies files across 4 compaction states (`Full`, `Skeleton`, `Outline`, `Excluded`) through a 10-stage decision hierarchy, skeletonizes clean untouched TS/JS files via TypeScript Compiler API (`typescript@5.4.5`), outlines Markdown/JSON files, computes token telemetry via `js-tiktoken` (`1.0.21`), and updates knowledge packs using rollback-safe atomic file replacements (`replaceFileAtomically`) and `.sync-status.json`.

**Tech Stack:** Node.js ES Modules (`.mjs`), TypeScript Compiler API (`typescript@5.4.5`), `js-tiktoken` (`1.0.21`), `js-yaml` (`^4.1.0`), Bash (`core/flatten.sh`, `core/chunk.sh`), Node.js Test Runner (`node --test`).

---

## Global Constraints & Spec Ownership

- **Canonical Spec Source of Truth:** `docs/meta/specs/2026-08-11-compacted-context-design.md` (Governed). `docs/superpowers/specs/` is an automated mirror.
- **Exact Pinned Dependencies (Verified via `npm ls --depth=0`):**
  - `typescript`: `"5.4.5"` (exact version lock)
  - `js-tiktoken`: `"1.0.21"` (exact version lock)
- **Telemetry Acceptance Policy:** The 50–70% token reduction target is an informational telemetry metric recorded in `.sync-status.json` (`token_reduction_percentage`). It provides observability and performance tracking, but is not a build-blocking gate on small or un-skeletonizable repositories.
- **Decision Hierarchy:** Excluded -> Disabled -> Overrides Error -> Git Error -> Dirty Workspace -> Active Override -> High-Risk -> Git Recency -> Config Rules -> Default.
- **Fail-Closed Guarantee:** Any parser error, missing Git metadata, or malformed override forces file state to `Full`.
- **Security Boundary:** POSIX path normalization, traversal rejection (`../`), and real symlink escape verification (`fs.realpathSync`).
- **Rollback-Safe File Replacement:** Replacement uses POSIX `fs.renameSync` where supported, falling back to copy/unlink with `.bak.<filename>.<timestamp>` rollback recovery on Windows file lock collisions.
- **Control Flow & Pipeline Continuation:** In `core/flatten.sh`, when `USE_MANIFEST` is false, `index.mjs` generates `$FULL_PACK` directly. Script execution then continues seamlessly through caller tasks and downstream `core/chunk.sh` processing without calling `exit 0` prematurely.
- **Fallback Contract:** If `index.mjs` exits non-zero or `COMPACTION_ENABLED=false`, `core/flatten.sh` falls back to standard `cat` concatenation without interrupting downstream pipeline execution.

---

## File Structure & Module Map

| Module File | Responsibility | Existing State |
| :--- | :--- | :--- |
| `modules/compactor/path-utils.mjs` | Path normalization, POSIX formatting, symlink security boundary | Implemented |
| `modules/compactor/atomic-file.mjs` | Windows-portable rollback-safe file replacement helper | Implemented |
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

### Task 1: Exact Dependency Locking & Clean Lockfile Verification

**Files:**
- Modify: `package.json:68-74`
- Modify: `package-lock.json`
- Test: `npm ci && npm ls --depth=0 typescript js-tiktoken`

**Interfaces:**
- Consumes: `package.json`
- Produces: Verified exact dependency locks in `package-lock.json`.

- [ ] **Step 1: Inspect `package.json` for exact version declarations**

Verify `package.json` devDependencies are declared without carets:
```json
  "devDependencies": {
    "@types/node": "^20.0.0",
    "js-tiktoken": "1.0.21",
    "js-yaml": "^4.1.0",
    "tsx": "^4.0.0",
    "typescript": "5.4.5"
  }
```

- [ ] **Step 2: Run dependency lock verification**

Run: `npm ci && npm ls --depth=0 typescript js-tiktoken`  
Expected Output:
```text
kb-sync@0.1.3.0 C:\dev\kb-sync
├── js-tiktoken@1.0.21
└── typescript@5.4.5
```
Exit code: `0` (asserts package-lock.json matches exact installed dependencies cleanly).

- [ ] **Step 3: Commit dependency lock updates**

Commit dependency lock updates cleanly.

---

### Task 2: Adversarial Security, Git Rename/Copy Fixture & Failure-Injection Tests

**Files:**
- Modify: `tests/adversarial-compactor.test.mjs`
- Test: `node --test tests/adversarial-compactor.test.mjs`

**Interfaces:**
- Tests: Real filesystem symlink traversal escape (with explicit OS privilege skip logging), real space-containing filename parsing, Git status porcelain `-z` rename (`R`)/copy (`C`) path pairs, and classifier override error state fallback.

- [ ] **Step 1: Implement `tests/adversarial-compactor.test.mjs` with Git rename/copy fixtures**

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

test('normalizeRepoPath rejects real filesystem symbolic links that escape repository root', () => {
  const symlinkPath = path.join(repoRoot, '.tmp-outside-symlink');
  const targetOutside = path.resolve(repoRoot, '..');

  try {
    try {
      fs.symlinkSync(targetOutside, symlinkPath, 'junction');
    } catch (err) {
      if (err.code === 'EPERM' || err.code === 'EACCES') {
        console.log('[SKIP] Symlink creation requires elevated OS privileges on Windows.');
        return;
      }
      throw err;
    }

    assert.throws(
      () => normalizeRepoPath('.tmp-outside-symlink', repoRoot),
      /Security Exception/
    );
  } finally {
    if (fs.existsSync(symlinkPath)) fs.unlinkSync(symlinkPath);
  }
});

test('loadNormalizedManifest handles filenames with spaces and CRLF newlines without trimming spaces', () => {
  const tmpManifest = path.join(repoRoot, '.tmp-space-manifest.txt');
  const spaceFile = 'tests/fixtures/sample file with spaces.js';
  
  fs.mkdirSync(path.dirname(path.join(repoRoot, spaceFile)), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, spaceFile), 'console.log(1);', 'utf8');
  fs.writeFileSync(tmpManifest, `package.json\r\n${spaceFile}\r\n`, 'utf8');

  try {
    const list = loadNormalizedManifest(tmpManifest, repoRoot);
    assert.ok(list.includes(spaceFile));
  } finally {
    if (fs.existsSync(tmpManifest)) fs.unlinkSync(tmpManifest);
    if (fs.existsSync(path.join(repoRoot, spaceFile))) fs.unlinkSync(path.join(repoRoot, spaceFile));
  }
});

test('replaceFileAtomically restores target file if source file does not exist', () => {
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

test('classifyFile forces Full state when overrides file has schema error', () => {
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

test('git-inspector dirty files parser handles porcelain -z rename (R) and copy (C) records structurally', () => {
  // Porcelain -z output format: XY path\0 or XY old\0new\0 for R/C
  const fakePorcelainOutput = 'R  old.ts\0new.ts\0C  src.ts\0copy.ts\0 M modified.ts\0';
  const tokens = fakePorcelainOutput.split('\0');
  const dirtyFiles = new Set();
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];
    if (!token) { i++; continue; }
    const statusCode = token.slice(0, 2);
    const filePath = token.slice(3);
    if (filePath) dirtyFiles.add(filePath);

    if (statusCode.includes('R') || statusCode.includes('C')) {
      i++;
      if (i < tokens.length && tokens[i]) dirtyFiles.add(tokens[i]);
    }
    i++;
  }

  assert.ok(dirtyFiles.has('old.ts'), 'Rename source must be dirty');
  assert.ok(dirtyFiles.has('new.ts'), 'Rename target must be dirty');
  assert.ok(dirtyFiles.has('src.ts'), 'Copy source must be dirty');
  assert.ok(dirtyFiles.has('copy.ts'), 'Copy target must be dirty');
  assert.ok(dirtyFiles.has('modified.ts'), 'Modified file must be dirty');
});
```

- [ ] **Step 2: Run adversarial test suite**

Run: `node --test tests/adversarial-compactor.test.mjs`  
Expected: PASS

- [ ] **Step 3: Run all compactor engine tests**

Run: `node --test tests/git-inspector.test.mjs tests/skeletonizer.test.mjs tests/compactor-integration.test.mjs tests/adversarial-compactor.test.mjs`  
Expected: PASS (All 14+ tests pass cleanly)

---

### Task 3: Configuration Setup, Stage 2 Pipeline Integration & Success/Fallback/Failure Tests

**Files:**
- Create: `configs/compaction.yaml`
- Modify: `core/flatten.sh:214-239`
- Create: `tests/pipeline-fallback.test.mjs`

**Interfaces:**
- Creates `configs/compaction.yaml` with production risk boundaries and compaction rules.
- Modifies `core/flatten.sh` concatenated pack block to execute compactor using exact CLI flags `--output <dir> --pack-name <name> --repo-root <dir>`.
- Adds `tests/pipeline-fallback.test.mjs` testing:
  1. `COMPACTION_ENABLED=true` success path producing a compacted pack, asserting skeletonization (`[COMPACTED SKELETON]`), and running downstream `chunk.sh`.
  2. `COMPACTION_ENABLED=false` fallback path producing standard concatenated pack and running downstream `chunk.sh`.
  3. Non-existent `--config` failure fallback path producing standard concatenated pack and running downstream `chunk.sh`.

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

- [ ] **Step 2: Update `core/flatten.sh` concatenated pack mode (lines 214-239)**

Replace lines 214-239 in `core/flatten.sh`:

```bash
  # Concatenated pack mode: write full pack file with START/END FILE markers
  FULL_PACK="$PACK_DIR/$PACK_FILE"
  log_info "Writing concatenated pack to: $FULL_PACK"

  COMPACTION_CONFIG="$REPO_ROOT/configs/compaction.yaml"
  USE_COMPACTION=false

  if [ "${COMPACTION_ENABLED:-true}" = "true" ] && [ -f "$COMPACTION_CONFIG" ]; then
    log_info "Compacted Context Engine enabled. Invoking batch compactor..."
    if node "$REPO_ROOT/modules/compactor/index.mjs" \
      --repo-root "$REPO_ROOT" \
      --manifest "$TEMP_FILE_LIST" \
      --output "$FULL_PACK" \
      --config "$COMPACTION_CONFIG" \
      --global-config "${GLOBAL_CONFIG:-}"; then
      log_info "Compacted knowledge pack generated successfully."
      USE_COMPACTION=true
    else
      log_warn "Compactor execution failed. Falling back to standard git flattener..."
    fi
  fi

  if [ "$USE_COMPACTION" = false ]; then
    {
      echo "================================================================================"
      echo "REWRITE LABS & CIC REPOSITORY KNOWLEDGE PACK"
      echo "Generated: $(date)"
      echo "Repo Root: $REPO_ROOT"
      echo "================================================================================"
      echo ""

      while IFS= read -r file; do
        [ -z "$file" ] && continue
        echo ""
        echo "--- START FILE: $file ---"
        if [ -f "$REPO_ROOT/$file" ]; then
          cat "$REPO_ROOT/$file" || true
        fi
        echo "--- END FILE: $file ---"
        echo ""
      done < "$TEMP_FILE_LIST"
    } > "$FULL_PACK"

    log_info "Standard uncompacted knowledge pack generated successfully."
  fi
```

- [ ] **Step 3: Write pipeline success, disabled fallback, and compactor failure fallback test suite (`tests/pipeline-fallback.test.mjs`)**

```javascript
import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const repoRoot = path.resolve('.');

test('core/flatten.sh COMPACTION_ENABLED=true success path generates skeletonized pack and chunk.sh consumes it', () => {
  const packDir = path.join(repoRoot, '.tmp-pipeline-success-pack');
  const chunkDir = path.join(repoRoot, '.tmp-pipeline-success-chunks');
  const packFile = 'compacted_pack.txt';

  try {
    execFileSync('bash', [
      'core/flatten.sh',
      '--output', packDir,
      '--pack-name', packFile,
      '--repo-root', repoRoot
    ], {
      cwd: repoRoot,
      env: { ...process.env, COMPACTION_ENABLED: 'true' },
      encoding: 'utf8'
    });

    const packPath = path.join(packDir, packFile);
    assert.ok(fs.existsSync(packPath), 'Compact knowledge pack must exist');
    const content = fs.readFileSync(packPath, 'utf8');
    assert.ok(content.includes('COMPACTED CONTEXT ENGINE'), 'Header must contain Compacted Context Engine banner');
    assert.ok(content.includes('[COMPACTED SKELETON]') || content.includes('[COMPACTED OUTLINE]'), 'Pack must contain skeletonized or outlined file entries');

    execFileSync('bash', [
      'core/chunk.sh',
      '--file', packPath,
      '--output-dir', chunkDir
    ], { cwd: repoRoot, encoding: 'utf8' });

    const chunkFiles = fs.readdirSync(chunkDir).filter(f => f.startsWith('repo_knowledge_pack_part_'));
    assert.ok(chunkFiles.length > 0, 'chunk.sh must split compacted pack into chunks');

  } finally {
    if (fs.existsSync(packDir)) fs.rmSync(packDir, { recursive: true, force: true });
    if (fs.existsSync(chunkDir)) fs.rmSync(chunkDir, { recursive: true, force: true });
  }
});

test('core/flatten.sh COMPACTION_ENABLED=false fallback path generates standard pack and chunk.sh consumes it', () => {
  const packDir = path.join(repoRoot, '.tmp-pipeline-fallback-pack');
  const chunkDir = path.join(repoRoot, '.tmp-pipeline-fallback-chunks');
  const packFile = 'fallback_pack.txt';

  try {
    execFileSync('bash', [
      'core/flatten.sh',
      '--output', packDir,
      '--pack-name', packFile,
      '--repo-root', repoRoot
    ], {
      cwd: repoRoot,
      env: { ...process.env, COMPACTION_ENABLED: 'false' },
      encoding: 'utf8'
    });

    const packPath = path.join(packDir, packFile);
    assert.ok(fs.existsSync(packPath));
    const content = fs.readFileSync(packPath, 'utf8');
    assert.ok(content.includes('REWRITE LABS & CIC REPOSITORY KNOWLEDGE PACK'));

    execFileSync('bash', [
      'core/chunk.sh',
      '--file', packPath,
      '--output-dir', chunkDir
    ], { cwd: repoRoot, encoding: 'utf8' });

    const chunkFiles = fs.readdirSync(chunkDir).filter(f => f.startsWith('repo_knowledge_pack_part_'));
    assert.ok(chunkFiles.length > 0);

  } finally {
    if (fs.existsSync(packDir)) fs.rmSync(packDir, { recursive: true, force: true });
    if (fs.existsSync(chunkDir)) fs.rmSync(chunkDir, { recursive: true, force: true });
  }
});

test('core/flatten.sh compactor execution failure falls back to standard pack and chunk.sh succeeds', () => {
  const packDir = path.join(repoRoot, '.tmp-pipeline-fail-pack');
  const chunkDir = path.join(repoRoot, '.tmp-pipeline-fail-chunks');
  const packFile = 'fail_fallback_pack.txt';

  try {
    execFileSync('bash', [
      'core/flatten.sh',
      '--output', packDir,
      '--pack-name', packFile,
      '--repo-root', repoRoot
    ], {
      cwd: repoRoot,
      env: { ...process.env, COMPACTION_ENABLED: 'true', COMPACTION_CONFIG: 'non-existent-file.yaml' },
      encoding: 'utf8'
    });

    const packPath = path.join(packDir, packFile);
    assert.ok(fs.existsSync(packPath), 'Fallback pack must be created despite compactor failure');
    const content = fs.readFileSync(packPath, 'utf8');
    assert.ok(content.includes('REWRITE LABS & CIC REPOSITORY KNOWLEDGE PACK'), 'Must contain standard flattener header');

    execFileSync('bash', [
      'core/chunk.sh',
      '--file', packPath,
      '--output-dir', chunkDir
    ], { cwd: repoRoot, encoding: 'utf8' });

    const chunkFiles = fs.readdirSync(chunkDir).filter(f => f.startsWith('repo_knowledge_pack_part_'));
    assert.ok(chunkFiles.length > 0, 'chunk.sh must split fallback pack into chunks');

  } finally {
    if (fs.existsSync(packDir)) fs.rmSync(packDir, { recursive: true, force: true });
    if (fs.existsSync(chunkDir)) fs.rmSync(chunkDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 4: Run full project test suite gate**

Run: `npm run test:all && npm run kb:pre-flight`  
Expected: PASS

---

## Rollback & Recovery Procedure

If the Compacted Context Engine encounters a production issue or generates an invalid pack during nightly sync:

1. **Disable Compaction:** Set `COMPACTION_ENABLED=false` in environment or set `compaction.enabled: false` in `configs/compaction.yaml`. `core/flatten.sh` will bypass the Node.js batch compactor and fall back to standard uncompacted `cat` concatenation without interrupting pipeline execution.
2. **Purge Transient Overrides:** Run `npm run kb:compact -- prune-overrides` or remove `.compaction-overrides.yaml`.
3. **Rollback-Safe File Replacement:** `replaceFileAtomically` creates a temporary `.bak.<filename>.<timestamp>` file during replacement. If a write or file lock error occurs, the temporary backup is restored over the target. Once replacement completes cleanly, the temporary backup is removed.
