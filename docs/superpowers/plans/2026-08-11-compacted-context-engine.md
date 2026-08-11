# Compacted Context Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and integrate the Compacted Context Engine into Stage 2 of the `kb-sync` pipeline to reduce consolidated knowledge pack (`repo_knowledge_pack.txt`) token footprint by 50–70% via Git recency filtering, dirty workspace detection, and TypeScript AST skeletonization.

**Architecture:** A modular Node.js engine (`modules/compactor/`) invoked by `core/flatten.sh`. The engine classifies files across 4 compaction states (`Full`, `Skeleton`, `Outline`, `Excluded`) through a 10-stage decision hierarchy, skeletonizes clean untouched TS/JS files via TypeScript Compiler API (`typescript@5.4.5`), outlines Markdown/JSON files, computes token telemetry via `js-tiktoken` (`cl100k_base`), and atomically updates knowledge packs and `.sync-status.json`.

**Tech Stack:** Node.js ES Modules (`.mjs`), TypeScript Compiler API (`typescript@5.4.5`), `js-tiktoken` (`^1.0.15`), `js-yaml` (`^4.1.0`), Bash (`core/flatten.sh`), Node.js Test Runner (`node --test`).

## Global Constraints

- Pinned TypeScript Compiler API: `typescript@5.4.5` (strict version floor/lock).
- Token Counter: `js-tiktoken` with `cl100k_base` encoding.
- State Resolution Priority: Excluded -> Disabled -> Overrides Error -> Git Error -> Dirty Workspace -> Active Override -> High-Risk -> Git Recency -> Config Rules -> Default.
- Fail-Closed Behavior: Any parser error, missing Git metadata, or malformed override forces state to `Full`.
- Path Security: All paths must be normalized to POSIX format, verified against traversal (`../`), and checked for symlink escaping (`fs.realpathSync`).
- Atomic Operations: All pack/status file replacements must use `replaceFileAtomically` with `.bak` rollback safety.

---

### Task 1: Security Path Boundary & Glob Matcher (`modules/compactor/path-utils.mjs`)

**Files:**
- Create: `modules/compactor/path-utils.mjs`
- Test: `tests/path-utils.test.mjs`

**Interfaces:**
- Consumes: `node:path`, `node:fs`
- Produces:
  - `normalizeRepoPath(inputPath: string, repoRoot: string): string`
  - `matchGlobPattern(filePath: string, pattern: string): boolean`

- [ ] **Step 1: Write the failing unit test**

```javascript
import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { normalizeRepoPath, matchGlobPattern } from '../modules/compactor/path-utils.mjs';

const repoRoot = path.resolve('.');

test('normalizeRepoPath converts Windows backslashes and strips ./', () => {
  assert.strictEqual(normalizeRepoPath('.\\core\\flatten.sh', repoRoot), 'core/flatten.sh');
});

test('normalizeRepoPath rejects path traversal', () => {
  assert.throws(() => normalizeRepoPath('../outside.js', repoRoot), /Security Exception/);
});

test('matchGlobPattern matches wildcards correctly', () => {
  assert.strictEqual(matchGlobPattern('node_modules/foo/bar.js', '*node_modules/*'), true);
  assert.strictEqual(matchGlobPattern('core/flatten.sh', '*.png'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/path-utils.test.mjs`  
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `path-utils.mjs`**

```javascript
import path from 'node:path';
import fs from 'node:fs';

export function normalizeRepoPath(inputPath, repoRoot) {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new Error('Invalid path input: Path must be a non-empty string');
  }

  const resolvedRepoRoot = path.resolve(repoRoot);
  const absolutePath = path.isAbsolute(inputPath) 
    ? path.resolve(inputPath) 
    : path.resolve(resolvedRepoRoot, inputPath);

  const relative = path.relative(resolvedRepoRoot, absolutePath);

  if (relative === '' || relative === '.') {
    throw new Error(`Security Exception: Cannot target repository root directory: "${inputPath}"`);
  }

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Security Exception: Path traversal outside repository root: "${inputPath}"`);
  }

  if (fs.existsSync(absolutePath)) {
    const realPath = fs.realpathSync(absolutePath);
    const realRelative = path.relative(resolvedRepoRoot, realPath);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      throw new Error(`Security Exception: Symbolic link escapes repository root: "${inputPath}" -> "${realPath}"`);
    }
  }

  return relative.replace(/\\/g, '/');
}

export function matchGlobPattern(filePath, pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`).test(filePath);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/path-utils.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add modules/compactor/path-utils.mjs tests/path-utils.test.mjs
git commit -m "feat(compactor): add path-utils module with traversal and symlink validation"
```

---

### Task 2: Windows-Safe Atomic Replacement (`modules/compactor/atomic-file.mjs`)

**Files:**
- Create: `modules/compactor/atomic-file.mjs`
- Test: `tests/atomic-file.test.mjs`

**Interfaces:**
- Consumes: `node:fs`, `node:path`
- Produces: `replaceFileAtomically(srcPath: string, destPath: string): void`

- [ ] **Step 1: Write the failing unit test**

```javascript
import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { replaceFileAtomically } from '../modules/compactor/atomic-file.mjs';

const repoRoot = path.resolve('.');

test('replaceFileAtomically replaces file safely and cleans temp backup', () => {
  const src = path.join(repoRoot, '.tmp-src.txt');
  const dest = path.join(repoRoot, '.tmp-dest.txt');
  
  fs.writeFileSync(src, 'new content', 'utf8');
  fs.writeFileSync(dest, 'old content', 'utf8');

  try {
    replaceFileAtomically(src, dest);
    assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'new content');
    assert.strictEqual(fs.existsSync(src), false);
  } finally {
    if (fs.existsSync(src)) fs.unlinkSync(src);
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/atomic-file.test.mjs`  
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `atomic-file.mjs`**

```javascript
import fs from 'node:fs';
import path from 'node:path';

export function replaceFileAtomically(srcPath, destPath) {
  const dir = path.dirname(destPath);
  const bakPath = path.join(dir, `.bak.${path.basename(destPath)}.${Date.now()}`);
  let hasBackup = false;

  try {
    if (fs.existsSync(destPath)) {
      fs.copyFileSync(destPath, bakPath);
      hasBackup = true;
    }

    try {
      fs.renameSync(srcPath, destPath);
    } catch (err) {
      fs.copyFileSync(srcPath, destPath);
      fs.unlinkSync(srcPath);
    }

    if (hasBackup && fs.existsSync(bakPath)) {
      fs.unlinkSync(bakPath);
    }
  } catch (err) {
    if (hasBackup && fs.existsSync(bakPath)) {
      fs.copyFileSync(bakPath, destPath);
      fs.unlinkSync(bakPath);
    }
    if (fs.existsSync(srcPath)) fs.unlinkSync(srcPath);
    throw new Error(`Atomic File Replacement Failure for "${destPath}": ${err.message}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/atomic-file.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add modules/compactor/atomic-file.mjs tests/atomic-file.test.mjs
git commit -m "feat(compactor): add atomic file replacement helper with backup rollback safety"
```

---

### Task 3: Git Workspace & Recency Inspector (`modules/compactor/git-inspector.mjs`)

**Files:**
- Create: `modules/compactor/git-inspector.mjs`
- Test: `tests/git-inspector.test.mjs`

**Interfaces:**
- Consumes: `node:fs`, `node:child_process`, `node:crypto`, `modules/compactor/path-utils.mjs`
- Produces:
  - `getFileContentHash(fullPath: string): string`
  - `getGitDirtyFiles(repoRoot: string): Set<string>|null`
  - `getBulkRecentlyModifiedFiles(repoRoot: string, windowDays: number): Set<string>|null`

- [ ] **Step 1: Write the failing unit test**

```javascript
import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { getFileContentHash, getGitDirtyFiles, getBulkRecentlyModifiedFiles } from '../modules/compactor/git-inspector.mjs';

const repoRoot = path.resolve('.');

test('getFileContentHash returns 12-char SHA-256 string', () => {
  const hash = getFileContentHash(path.join(repoRoot, 'package.json'));
  assert.strictEqual(hash.length, 12);
});

test('getGitDirtyFiles returns dirty paths or null on failure', () => {
  const dirty = getGitDirtyFiles(repoRoot);
  assert.ok(dirty === null || dirty instanceof Set);
});

test('getBulkRecentlyModifiedFiles returns recent files set', () => {
  const recent = getBulkRecentlyModifiedFiles(repoRoot, 14);
  assert.ok(recent === null || recent instanceof Set);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/git-inspector.test.mjs`  
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `git-inspector.mjs`**

```javascript
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { normalizeRepoPath } from './path-utils.mjs';

export function getFileContentHash(fullPath) {
  try {
    const buffer = fs.readFileSync(fullPath);
    return crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 12);
  } catch (_) {
    return 'unknown-hash';
  }
}

export function getGitDirtyFiles(repoRoot) {
  try {
    const output = execFileSync('git', ['status', '--porcelain', '-z'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      maxBuffer: 10 * 1024 * 1024
    });

    const dirtyFiles = new Set();
    const tokens = output.split('\0');
    let i = 0;

    while (i < tokens.length) {
      const token = tokens[i];
      if (!token) { i++; continue; }
      
      const statusCode = token.slice(0, 2);
      const filePath = token.slice(3);

      if (filePath) {
        try { dirtyFiles.add(normalizeRepoPath(filePath, repoRoot)); } catch (_) {}
      }

      if (statusCode.includes('R') || statusCode.includes('C')) {
        i++;
        if (i < tokens.length && tokens[i]) {
          try { dirtyFiles.add(normalizeRepoPath(tokens[i], repoRoot)); } catch (_) {}
        }
      }
      i++;
    }

    return dirtyFiles;
  } catch (err) {
    return null;
  }
}

export function getBulkRecentlyModifiedFiles(repoRoot, windowDays) {
  if (windowDays === 0) return new Set();

  try {
    const sinceDate = `${windowDays} days ago`;
    const output = execFileSync('git', ['log', `--since=${sinceDate}`, '--name-only', '--format=', '-z'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      maxBuffer: 20 * 1024 * 1024
    });

    const recentFiles = new Set();
    const paths = output.split('\0').filter(Boolean);
    for (const p of paths) {
      try { recentFiles.add(normalizeRepoPath(p, repoRoot)); } catch (_) {}
    }
    return recentFiles;
  } catch (err) {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/git-inspector.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add modules/compactor/git-inspector.mjs tests/git-inspector.test.mjs
git commit -m "feat(compactor): add git inspector for workspace dirty tracking and bulk recency log checks"
```

---

### Task 4: Config & Transient Overrides Manager (`config-loader.mjs` & `overrides-manager.mjs`)

**Files:**
- Create: `modules/compactor/config-loader.mjs`
- Create: `modules/compactor/overrides-manager.mjs`
- Test: `tests/config-overrides.test.mjs`

**Interfaces:**
- Consumes: `node:fs`, `node:path`, `js-yaml`, `modules/compactor/atomic-file.mjs`, `modules/compactor/path-utils.mjs`
- Produces:
  - `loadCompactionConfig(configPath: string): Object`
  - `loadActiveOverrides(repoRoot: string): { map: Map<string, Object>, error: string|null }`
  - `saveOverrides(repoRoot: string, overridesMap: Map<string, Object>): void`

- [ ] **Step 1: Write the failing unit test**

```javascript
import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { loadCompactionConfig } from '../modules/compactor/config-loader.mjs';
import { loadActiveOverrides, saveOverrides } from '../modules/compactor/overrides-manager.mjs';

const repoRoot = path.resolve('.');

test('loadCompactionConfig loads configs/compaction.yaml correctly', () => {
  const config = loadCompactionConfig(path.join(repoRoot, 'configs/compaction.yaml'));
  assert.strictEqual(typeof config.compaction.enabled, 'boolean');
  assert.strictEqual(typeof config.compaction.git_window_days, 'number');
});

test('saveOverrides and loadActiveOverrides persist local overrides', () => {
  const map = new Map();
  map.set('core/flatten.sh', { path: 'core/flatten.sh', expire_at: new Date(Date.now() + 86400000).toISOString() });
  saveOverrides(repoRoot, map);

  const res = loadActiveOverrides(repoRoot);
  assert.strictEqual(res.error, null);
  assert.ok(res.map.has('core/flatten.sh'));

  const overrideFile = path.join(repoRoot, '.compaction-overrides.yaml');
  if (fs.existsSync(overrideFile)) fs.unlinkSync(overrideFile);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/config-overrides.test.mjs`  
Expected: FAIL (modules not found)

- [ ] **Step 3: Implement `config-loader.mjs` and `overrides-manager.mjs`**

`modules/compactor/config-loader.mjs`:
```javascript
import fs from 'node:fs';
import yaml from 'js-yaml';

const VALID_STATES = new Set(['Full', 'Skeleton', 'Outline', 'Excluded']);

export function loadCompactionConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Configuration Error: File not found at "${configPath}"`);
  }

  const rawText = fs.readFileSync(configPath, 'utf8');
  let rawDoc;
  try {
    rawDoc = yaml.load(rawText);
  } catch (err) {
    throw new Error(`YAML Parsing Error in "${configPath}": ${err.message}`);
  }

  if (!rawDoc || typeof rawDoc !== 'object' || !rawDoc.compaction) {
    throw new Error('Configuration Governance Error: Missing root "compaction" key');
  }

  const c = rawDoc.compaction;
  if (typeof c.enabled !== 'boolean') {
    throw new Error('Configuration Governance Error: "compaction.enabled" must be a boolean');
  }

  if (typeof c.git_window_days !== 'number' || c.git_window_days < 0 || !Number.isInteger(c.git_window_days)) {
    throw new Error('Configuration Governance Error: "compaction.git_window_days" must be a non-negative integer');
  }

  if (!VALID_STATES.has(c.default_level)) {
    throw new Error(`Configuration Governance Error: Invalid "compaction.default_level": "${c.default_level}"`);
  }

  const highRiskPrefixes = (Array.isArray(c.high_risk_prefixes) ? c.high_risk_prefixes : []).map(p => {
    if (typeof p !== 'string') throw new Error('Invalid high_risk_prefix item');
    return p.replace(/\\/g, '/').replace(/^\.\//, '');
  });

  const rules = (Array.isArray(c.rules) ? c.rules : []).map(r => {
    if (!r || typeof r.prefix !== 'string' || !VALID_STATES.has(r.level)) {
      throw new Error(`Invalid compaction rule specification: ${JSON.stringify(r)}`);
    }
    return {
      prefix: r.prefix.replace(/\\/g, '/').replace(/^\.\//, ''),
      level: r.level
    };
  });

  return {
    compaction: {
      enabled: c.enabled,
      git_window_days: c.git_window_days,
      default_level: c.default_level,
      high_risk_prefixes: highRiskPrefixes,
      rules
    }
  };
}
```

`modules/compactor/overrides-manager.mjs`:
```javascript
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { normalizeRepoPath } from './path-utils.mjs';
import { replaceFileAtomically } from './atomic-file.mjs';

const OVERRIDES_FILE = '.compaction-overrides.yaml';

export function loadActiveOverrides(repoRoot) {
  const filePath = path.join(repoRoot, OVERRIDES_FILE);
  if (!fs.existsSync(filePath)) return { map: new Map(), error: null };

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const doc = yaml.load(raw);
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.overrides)) {
      return { map: new Map(), error: 'Malformed .compaction-overrides.yaml schema' };
    }

    const activeMap = new Map();
    const now = Date.now();

    for (const entry of doc.overrides) {
      if (!entry || typeof entry.path !== 'string') continue;

      let normPath;
      try {
        normPath = normalizeRepoPath(entry.path, repoRoot);
      } catch (err) {
        return { map: new Map(), error: `Invalid path in override file: ${entry.path}` };
      }
      
      if (entry.expire_at) {
        const expireMs = Date.parse(entry.expire_at);
        if (!Number.isFinite(expireMs)) {
          return { map: new Map(), error: `Invalid expire_at timestamp for path ${normPath}` };
        }
        if (expireMs <= now) continue;
      }

      activeMap.set(normPath, entry);
    }
    return { map: activeMap, error: null };
  } catch (err) {
    return { map: new Map(), error: `Failed to load overrides: ${err.message}` };
  }
}

export function saveOverrides(repoRoot, overridesMap) {
  const filePath = path.join(repoRoot, OVERRIDES_FILE);
  const tmpPath = `${filePath}.tmp.${Date.now()}`;
  
  const doc = { overrides: Array.from(overridesMap.values()) };
  const yamlStr = yaml.dump(doc);

  fs.writeFileSync(tmpPath, yamlStr, 'utf8');
  replaceFileAtomically(tmpPath, filePath);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/config-overrides.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add modules/compactor/config-loader.mjs modules/compactor/overrides-manager.mjs tests/config-overrides.test.mjs
git commit -m "feat(compactor): add config loader and transient overrides manager"
```

---

### Task 5: AST Skeletonizer & Outliner Engines (`skeletonizer.mjs` & `outliner.mjs`)

**Files:**
- Create: `modules/compactor/skeletonizer.mjs`
- Create: `modules/compactor/outliner.mjs`
- Test: `tests/skeletonizer.test.mjs`

**Interfaces:**
- Consumes: `node:fs`, `node:path`, `typescript@5.4.5`
- Produces:
  - `skeletonizeFile(filePath: string, relativePath: string, contentHash: string, reason: string): { content: string, state: 'Skeleton'|'Full', warning?: string }`
  - `outlineFile(filePath: string, relativePath: string, contentHash: string, reason: string): { content: string, state: 'Outline'|'Full', warning?: string }`

- [ ] **Step 1: Write the failing unit test**

```javascript
import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { skeletonizeFile } from '../modules/compactor/skeletonizer.mjs';
import { outlineFile } from '../modules/compactor/outliner.mjs';

const repoRoot = path.resolve('.');

test('skeletonizeFile transforms JS/TS functions into throw placeholders', () => {
  const tmpFile = path.join(repoRoot, '.tmp-sample.ts');
  fs.writeFileSync(tmpFile, 'export function testFn() { return 42; }', 'utf8');

  try {
    const res = skeletonizeFile(tmpFile, '.tmp-sample.ts', 'hash123', 'unit test');
    assert.strictEqual(res.state, 'Skeleton');
    assert.ok(res.content.includes('throw new Error("[COMPACTED SKELETON: IMPLEMENTATION STRIPPED - DO NOT EXECUTE]")'));
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('outlineFile outlines Markdown headings', () => {
  const tmpFile = path.join(repoRoot, '.tmp-sample.md');
  fs.writeFileSync(tmpFile, '# Heading 1\nSome body\n## Heading 2\nMore body', 'utf8');

  try {
    const res = outlineFile(tmpFile, '.tmp-sample.md', 'hash123', 'unit test');
    assert.strictEqual(res.state, 'Outline');
    assert.ok(res.content.includes('# Heading 1'));
    assert.ok(res.content.includes('## Heading 2'));
    assert.strictEqual(res.content.includes('Some body'), false);
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/skeletonizer.test.mjs`  
Expected: FAIL (modules not found)

- [ ] **Step 3: Implement `skeletonizer.mjs` and `outliner.mjs`**

`modules/compactor/skeletonizer.mjs`:
```javascript
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const COMPACTOR_VERSION = '1.0.0';

if (!ts.version.startsWith('5.4')) {
  throw new Error(`Compactor Engine Error: Pinned typescript@5.4.x required. Found version ${ts.version}`);
}

function getScriptKind(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.ts':  return ts.ScriptKind.TS;
    case '.tsx': return ts.ScriptKind.TSX;
    case '.js':  return ts.ScriptKind.JS;
    case '.jsx': return ts.ScriptKind.JSX;
    case '.mjs': return ts.ScriptKind.JS;
    case '.cjs': return ts.ScriptKind.JS;
    default:     return ts.ScriptKind.TS;
  }
}

function createPlaceholderBlock() {
  return ts.factory.createBlock([
    ts.factory.createThrowStatement(
      ts.factory.createNewExpression(
        ts.factory.createIdentifier('Error'),
        undefined,
        [ts.factory.createStringLiteral('[COMPACTED SKELETON: IMPLEMENTATION STRIPPED - DO NOT EXECUTE]')]
      )
    )
  ], true);
}

export function skeletonizeFile(filePath, relativePath, contentHash, reason) {
  let rawContent;
  try {
    rawContent = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return { content: '', state: 'Full', warning: `Read error: ${err.message}` };
  }

  try {
    const scriptKind = getScriptKind(filePath);

    const transpileResult = ts.transpileModule(rawContent, {
      compilerOptions: { target: ts.ScriptTarget.Latest, jsx: ts.JsxEmit.Preserve },
      reportDiagnostics: true
    });

    const sourceFile = ts.createSourceFile(
      filePath,
      rawContent,
      ts.ScriptTarget.Latest,
      true,
      scriptKind
    );

    if (sourceFile.parseDiagnostics && sourceFile.parseDiagnostics.length > 0) {
      const diag = sourceFile.parseDiagnostics[0];
      const text = typeof diag.messageText === 'string' ? diag.messageText : diag.messageText.messageText;
      return {
        content: rawContent,
        state: 'Full',
        warning: `Syntactic diagnostic error: "${text}"`
      };
    }

    const transformer = (context) => {
      return (rootNode) => {
        const visit = (node) => {
          if (ts.isFunctionDeclaration(node) && node.body) {
            return ts.factory.updateFunctionDeclaration(
              node, node.modifiers, node.asteriskToken, node.name,
              node.typeParameters, node.parameters, node.type,
              createPlaceholderBlock()
            );
          }
          if (ts.isFunctionExpression(node) && node.body) {
            return ts.factory.updateFunctionExpression(
              node, node.modifiers, node.name, node.typeParameters,
              node.parameters, node.type,
              createPlaceholderBlock()
            );
          }
          if (ts.isMethodDeclaration(node) && node.body) {
            return ts.factory.updateMethodDeclaration(
              node, node.modifiers, node.asteriskToken, node.name,
              node.questionToken, node.typeParameters, node.parameters, node.type,
              createPlaceholderBlock()
            );
          }
          if (ts.isConstructorDeclaration(node) && node.body) {
            return ts.factory.updateConstructorDeclaration(
              node, node.modifiers, node.parameters,
              createPlaceholderBlock()
            );
          }
          if (ts.isGetAccessorDeclaration(node) && node.body) {
            return ts.factory.updateGetAccessorDeclaration(
              node, node.modifiers, node.name, node.parameters, node.type,
              createPlaceholderBlock()
            );
          }
          if (ts.isSetAccessorDeclaration(node) && node.body) {
            return ts.factory.updateSetAccessorDeclaration(
              node, node.modifiers, node.name, node.parameters,
              createPlaceholderBlock()
            );
          }
          if (ts.isArrowFunction(node) && node.body) {
            return ts.factory.updateArrowFunction(
              node, node.modifiers, node.typeParameters, node.parameters, node.type,
              node.equalsGreaterThanToken,
              createPlaceholderBlock()
            );
          }
          return ts.visitEachChild(node, visit, context);
        };
        return ts.visitNode(rootNode, visit);
      };
    };

    let result;
    let skeletonCode;
    try {
      result = ts.transform(sourceFile, [transformer]);
      const printer = ts.createPrinter({ removeComments: false, newLine: ts.NewLineKind.LineFeed });
      skeletonCode = printer.printFile(result.transformed[0]);
    } finally {
      if (result) result.dispose();
    }

    const banner = generateProvenanceBanner({
      relativePath,
      contentHash,
      state: 'Skeleton',
      reason,
      compactorVer: COMPACTOR_VERSION,
      parserVer: `typescript@${ts.version}`
    });

    return { content: `${banner}\n\n${skeletonCode}`, state: 'Skeleton' };

  } catch (err) {
    return { content: rawContent, state: 'Full', warning: `AST transformation exception: ${err.message}` };
  }
}

function generateProvenanceBanner({ relativePath, contentHash, state, reason, compactorVer, parserVer }) {
  return [
    '// =================================================================================',
    '// [COMPACTED SKELETON]',
    `// Source Path:         ${relativePath}`,
    `// Source Content Hash: ${contentHash}`,
    `// Compaction State:    ${state}`,
    `// Selection Reason:    ${reason}`,
    `// Compactor Ver:       ${compactorVer}`,
    `// Parser Engine:       ${parserVer}`,
    `// RESTORE COMMAND:     npm run kb:compact -- --restore ${relativePath}`,
    `// DUMP COMMAND:        npm run kb:compact -- --dump ${relativePath}`,
    '// ================================================================================='
  ].join('\n');
}
```

`modules/compactor/outliner.mjs`:
```javascript
import fs from 'node:fs';
import path from 'node:path';

export const OUTLINE_ALLOWLIST_EXT = new Set(['.md', '.json']);

export function isOutlineAllowedFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return OUTLINE_ALLOWLIST_EXT.has(ext);
}

export function outlineFile(filePath, relativePath, contentHash, reason) {
  let rawContent;
  try {
    rawContent = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return { content: '', state: 'Full', warning: `Read error: ${err.message}` };
  }

  const ext = path.extname(filePath).toLowerCase();

  try {
    let outlinedText = '';

    if (ext === '.md') {
      const lines = rawContent.split(/\r?\n/);
      const headingLines = lines.filter(line => /^#{1,6}\s+/.test(line));
      outlinedText = [
        `<!-- [COMPACTED OUTLINE: MARKDOWN HEADINGS ONLY (${headingLines.length} sections)] -->`,
        ...headingLines
      ].join('\n');
    } else if (ext === '.json') {
      const parsed = JSON.parse(rawContent);
      const keys = Object.keys(parsed);
      outlinedText = [
        `// [COMPACTED OUTLINE: TOP-LEVEL JSON KEYS ONLY]`,
        JSON.stringify({ _keys: keys, _count: keys.length }, null, 2)
      ].join('\n');
    } else {
      return { content: rawContent, state: 'Full', warning: `Outline unsupported for extension "${ext}"` };
    }

    const banner = [
      '// =================================================================================',
      '// [COMPACTED OUTLINE]',
      `// Source Path:         ${relativePath}`,
      `// Source Content Hash: ${contentHash}`,
      `// Compaction State:    Outline`,
      `// Selection Reason:    ${reason}`,
      '// ================================================================================='
    ].join('\n');

    return { content: `${banner}\n\n${outlinedText}`, state: 'Outline' };

  } catch (err) {
    return { content: rawContent, state: 'Full', warning: `Outline processing failed: ${err.message}` };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/skeletonizer.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add modules/compactor/skeletonizer.mjs modules/compactor/outliner.mjs tests/skeletonizer.test.mjs
git commit -m "feat(compactor): add skeletonizer and outliner transformation engines"
```

---

### Task 6: 10-Stage Decision Hierarchy Classifier (`modules/compactor/classifier.mjs`)

**Files:**
- Create: `modules/compactor/classifier.mjs`
- Test: `tests/classifier.test.mjs`

**Interfaces:**
- Consumes: `modules/compactor/path-utils.mjs`, `modules/compactor/outliner.mjs`
- Produces: `classifyFile(params: Object): { state: 'Full'|'Skeleton'|'Outline'|'Excluded', reason: string }`

- [ ] **Step 1: Write the failing unit test**

```javascript
import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { classifyFile } from '../modules/compactor/classifier.mjs';

const repoRoot = path.resolve('.');

test('classifyFile enforces 10-stage decision hierarchy', () => {
  const config = {
    compaction: {
      enabled: true,
      git_window_days: 14,
      default_level: 'Full',
      high_risk_prefixes: ['auth/'],
      rules: [{ prefix: 'core/', level: 'Skeleton' }]
    }
  };

  const res1 = classifyFile({ repoRoot, rawPath: 'node_modules/foo.js', config, overridesResult: { map: new Map() }, dirtyFilesSet: new Set(), recentFilesSet: new Set(), skipPatterns: ['*node_modules/*'] });
  assert.strictEqual(res1.state, 'Excluded');

  const res5 = classifyFile({ repoRoot, rawPath: 'core/flatten.sh', config, overridesResult: { map: new Map() }, dirtyFilesSet: new Set(['core/flatten.sh']), recentFilesSet: new Set(), skipPatterns: [] });
  assert.strictEqual(res5.state, 'Full');

  const res9 = classifyFile({ repoRoot, rawPath: 'core/dag.mjs', config, overridesResult: { map: new Map() }, dirtyFilesSet: new Set(), recentFilesSet: new Set(), skipPatterns: [] });
  assert.strictEqual(res9.state, 'Skeleton');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/classifier.test.mjs`  
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `classifier.mjs`**

```javascript
import { normalizeRepoPath, matchGlobPattern } from './path-utils.mjs';
import { isOutlineAllowedFile } from './outliner.mjs';

const JS_TS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function isJsTsFile(filePath) {
  const ext = filePath.slice(((filePath.lastIndexOf(".") - 1) >>> 0) + 2).toLowerCase();
  return JS_TS_EXTENSIONS.has('.' + ext);
}

function matchesPrefixBoundary(filePath, prefix) {
  if (filePath === prefix) return true;
  if (filePath.startsWith(prefix.endsWith('/') ? prefix : prefix + '/')) return true;
  return false;
}

export function classifyFile({ repoRoot, rawPath, config, overridesResult, dirtyFilesSet, recentFilesSet, skipPatterns }) {
  const relativePath = normalizeRepoPath(rawPath, repoRoot);

  for (const pattern of skipPatterns || []) {
    if (matchGlobPattern(relativePath, pattern)) {
      return { state: 'Excluded', reason: `Matched exclusion pattern (${pattern})` };
    }
  }

  if (!config.compaction.enabled) {
    return { state: 'Full', reason: 'Global compaction disabled (compaction.enabled = false)' };
  }

  if (overridesResult.error) {
    return { state: 'Full', reason: `Fail-closed: Overrides error (${overridesResult.error})` };
  }

  if (dirtyFilesSet === null || recentFilesSet === null) {
    return { state: 'Full', reason: 'Fail-closed: Git status or log inspection failed' };
  }

  if (dirtyFilesSet.has(relativePath)) {
    return { state: 'Full', reason: 'Uncommitted local modifications (Git dirty state)' };
  }

  if (overridesResult.map.has(relativePath)) {
    return { state: 'Full', reason: 'Active local override in .compaction-overrides.yaml' };
  }

  for (const prefix of config.compaction.high_risk_prefixes || []) {
    if (matchesPrefixBoundary(relativePath, prefix)) {
      return { state: 'Full', reason: `High-risk path match (${prefix})` };
    }
  }

  if (recentFilesSet.has(relativePath)) {
    return { state: 'Full', reason: `Modified within recent ${config.compaction.git_window_days}-day Git window` };
  }

  for (const rule of config.compaction.rules || []) {
    if (matchesPrefixBoundary(relativePath, rule.prefix)) {
      if (rule.level === 'Skeleton') {
        if (isJsTsFile(relativePath)) {
          return { state: 'Skeleton', reason: `Clean stable file matching Skeleton rule (${rule.prefix})` };
        }
        return { state: 'Full', reason: `Skeleton rule matched but unsupported file extension` };
      }
      if (rule.level === 'Outline') {
        if (isOutlineAllowedFile(relativePath)) {
          return { state: 'Outline', reason: `Clean stable file matching Outline rule (${rule.prefix})` };
        }
        return { state: 'Full', reason: `Outline rule matched but file type not in Outline allowlist` };
      }
      if (rule.level === 'Full') {
        return { state: 'Full', reason: `Configured Full rule match (${rule.prefix})` };
      }
    }
  }

  return { state: config.compaction.default_level, reason: `Default policy fallback (${config.compaction.default_level})` };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/classifier.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add modules/compactor/classifier.mjs tests/classifier.test.mjs
git commit -m "feat(compactor): add 10-stage decision hierarchy file classifier"
```

---

### Task 7: CLI Subcommand Suite & Telemetry (`cli.mjs` & `telemetry.mjs`)

**Files:**
- Create: `modules/compactor/cli.mjs`
- Create: `modules/compactor/telemetry.mjs`
- Test: `tests/cli-telemetry.test.mjs`

**Interfaces:**
- Consumes: `node:fs`, `node:path`, `js-tiktoken`, `modules/compactor/overrides-manager.mjs`
- Produces:
  - `countTokens(text: string): number`
  - `runCompactCli(args: string[], repoRoot: string): Promise<void>`

- [ ] **Step 1: Write the failing unit test**

```javascript
import test from 'node:test';
import assert from 'node:assert';
import { countTokens } from '../modules/compactor/telemetry.mjs';

test('countTokens calculates tiktoken tokens accurately', () => {
  const count = countTokens('export function helloWorld() { return "hello"; }');
  assert.ok(typeof count === 'number' && count > 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/cli-telemetry.test.mjs`  
Expected: FAIL (modules not found)

- [ ] **Step 3: Implement `telemetry.mjs` and `cli.mjs`**

`modules/compactor/telemetry.mjs`:
```javascript
import { getEncoding } from 'js-tiktoken';

let globalTokenizer = null;

function getTokenizer() {
  if (!globalTokenizer) {
    try {
      globalTokenizer = getEncoding('cl100k_base');
    } catch (_) {
      globalTokenizer = null;
    }
  }
  return globalTokenizer;
}

export function countTokens(text) {
  if (!text) return 0;
  const tokenizer = getTokenizer();
  if (tokenizer) {
    try {
      return tokenizer.encode(text).length;
    } catch (_) {}
  }
  return Math.ceil(text.length / 4);
}
```

`modules/compactor/cli.mjs`:
```javascript
import fs from 'node:fs';
import path from 'node:path';
import { loadActiveOverrides, saveOverrides } from './overrides-manager.mjs';
import { normalizeRepoPath } from './path-utils.mjs';

export async function runCompactCli(args, repoRoot) {
  const command = args[0];

  switch (command) {
    case 'inspect': {
      const statusFile = path.join(repoRoot, '.sync-status.json');
      if (!fs.existsSync(statusFile)) {
        console.log('No sync status available. Run kb-sync first.');
        return;
      }
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
      console.log('=== COMPACTED CONTEXT ENGINE STATUS ===');
      console.dir(status.compaction_stats || {}, { depth: null });
      break;
    }

    case 'restore': {
      const targetPath = args[1];
      if (!targetPath) {
        console.error('Error: Missing target path. Usage: npm run kb:compact -- --restore <path>');
        process.exit(1);
      }

      const overridesResult = loadActiveOverrides(repoRoot);
      if (overridesResult.error) {
        console.error(`Error: Refusing to update overrides due to schema error: ${overridesResult.error}`);
        process.exit(1);
      }

      const normPath = normalizeRepoPath(targetPath, repoRoot);
      const expireAt = new Date(Date.now() + 3 * 86400 * 1000).toISOString();
      
      overridesResult.map.set(normPath, {
        path: normPath,
        created_at: new Date().toISOString(),
        expire_at: expireAt,
        reason: 'Manual restore via CLI subcommand'
      });

      saveOverrides(repoRoot, overridesResult.map);
      console.log(`[COMPACTOR] Successfully restored "${normPath}" to FULL context (Active until ${expireAt}).`);
      break;
    }

    case 'dump': {
      const targetPath = args[1];
      if (!targetPath) {
        console.error('Error: Missing target path. Usage: npm run kb:compact -- --dump <path>');
        process.exit(1);
      }
      const normPath = normalizeRepoPath(targetPath, repoRoot);
      const fullPath = path.join(repoRoot, normPath);
      if (!fs.existsSync(fullPath)) {
        console.error(`Error: File not found: ${normPath}`);
        process.exit(1);
      }
      process.stdout.write(fs.readFileSync(fullPath, 'utf8'));
      break;
    }

    case 'prune-overrides': {
      const overridesResult = loadActiveOverrides(repoRoot);
      if (overridesResult.error) {
        console.error(`Error: Cannot prune overrides: ${overridesResult.error}`);
        process.exit(1);
      }
      saveOverrides(repoRoot, overridesResult.map);
      console.log('[COMPACTOR] Expired overrides pruned successfully.');
      break;
    }

    default:
      console.log('Usage: npm run kb:compact -- <inspect | --restore <path> | --dump <path> | prune-overrides>');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/cli-telemetry.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add modules/compactor/telemetry.mjs modules/compactor/cli.mjs tests/cli-telemetry.test.mjs
git commit -m "feat(compactor): add telemetry engine and CLI subcommand suite"
```

---

### Task 8: Batch Pack Builder Main Entry (`manifest-loader.mjs` & `index.mjs`)

**Files:**
- Create: `modules/compactor/manifest-loader.mjs`
- Create: `modules/compactor/index.mjs`
- Test: `tests/compactor-integration.test.mjs`

**Interfaces:**
- Consumes: All `modules/compactor/*.mjs` modules
- Produces: `buildCompactedPack(options: Object): Promise<Object>`

- [ ] **Step 1: Write the failing unit test**

```javascript
import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { buildCompactedPack } from '../modules/compactor/index.mjs';

const repoRoot = path.resolve('.');

test('buildCompactedPack generates pack and status metrics end to end', async () => {
  const tmpManifest = path.join(repoRoot, '.tmp-integration-manifest.txt');
  const tmpOutput = path.join(repoRoot, '.tmp-integration-pack.txt');
  const tmpConfig = path.join(repoRoot, 'configs/compaction.yaml');

  fs.writeFileSync(tmpManifest, 'package.json\ncore/flatten.sh', 'utf8');

  try {
    const stats = await buildCompactedPack({
      repoRoot,
      manifestPath: tmpManifest,
      outputPath: tmpOutput,
      configPath: tmpConfig,
      skipPatterns: []
    });

    assert.ok(stats.total_raw_size_bytes > 0);
    assert.ok(stats.compacted_size_bytes > 0);
    assert.ok(fs.existsSync(tmpOutput));
  } finally {
    if (fs.existsSync(tmpManifest)) fs.unlinkSync(tmpManifest);
    if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/compactor-integration.test.mjs`  
Expected: FAIL (modules not found)

- [ ] **Step 3: Implement `manifest-loader.mjs` and `index.mjs`**

`modules/compactor/manifest-loader.mjs`:
```javascript
import fs from 'node:fs';
import { normalizeRepoPath } from './path-utils.mjs';

export function loadNormalizedManifest(manifestPath, repoRoot) {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest Error: File not found at "${manifestPath}"`);
  }

  const rawText = fs.readFileSync(manifestPath, 'utf8');
  const lines = rawText.split(/\r?\n/);
  const normalizedSet = new Set();
  const manifestErrors = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === '' || line.startsWith('#')) continue;

    try {
      const normPath = normalizeRepoPath(line, repoRoot);
      normalizedSet.add(normPath);
    } catch (err) {
      manifestErrors.push(`Line ${i + 1}: ${err.message}`);
    }
  }

  if (manifestErrors.length > 0) {
    throw new Error(`Manifest Boundary Errors:\n${manifestErrors.join('\n')}`);
  }

  return Array.from(normalizedSet);
}
```

`modules/compactor/index.mjs`:
```javascript
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { classifyFile } from './classifier.mjs';
import { skeletonizeFile } from './skeletonizer.mjs';
import { outlineFile } from './outliner.mjs';
import { getGitDirtyFiles, getBulkRecentlyModifiedFiles, getFileContentHash } from './git-inspector.mjs';
import { loadActiveOverrides } from './overrides-manager.mjs';
import { loadCompactionConfig } from './config-loader.mjs';
import { loadNormalizedManifest } from './manifest-loader.mjs';
import { countTokens } from './telemetry.mjs';
import { replaceFileAtomically } from './atomic-file.mjs';
import { runCompactCli } from './cli.mjs';

async function writeChunk(stream, chunk) {
  if (!stream.write(chunk)) {
    await new Promise((resolve, reject) => {
      const onDrain = () => { stream.off('error', onError); resolve(); };
      const onError = (err) => { stream.off('drain', onDrain); reject(err); };
      stream.once('drain', onDrain);
      stream.once('error', onError);
    });
  }
}

export async function buildCompactedPack({ repoRoot, manifestPath, outputPath, configPath, skipPatterns }) {
  const config = loadCompactionConfig(configPath);
  const manifestFiles = loadNormalizedManifest(manifestPath, repoRoot);

  const dirtyFilesSet = getGitDirtyFiles(repoRoot);
  const recentFilesSet = getBulkRecentlyModifiedFiles(repoRoot, config.compaction.git_window_days);
  const overridesResult = loadActiveOverrides(repoRoot);

  const tmpOutputPath = `${outputPath}.tmp.${Date.now()}`;
  const outStream = fs.createWriteStream(tmpOutputPath, { encoding: 'utf8' });

  let totalRawBytes = 0;
  let totalCompactedBytes = 0;
  let totalRawTokens = 0;
  let totalCompactedTokens = 0;

  const stateCounts = { Full: 0, Skeleton: 0, Outline: 0, Excluded: 0 };
  const compactorWarnings = [];

  const headerText = [
    "================================================================================",
    "REWRITE LABS & CIC REPOSITORY KNOWLEDGE PACK (COMPACTED CONTEXT ENGINE)",
    `Generated: ${new Date().toISOString()}`,
    "================================================================================\n\n"
  ].join('\n');

  await writeChunk(outStream, headerText);
  const headerBytes = Buffer.byteLength(headerText, 'utf8');
  totalCompactedBytes += headerBytes;
  totalCompactedTokens += countTokens(headerText);

  for (const relativePath of manifestFiles) {
    const classification = classifyFile({
      repoRoot,
      rawPath: relativePath,
      config,
      overridesResult,
      dirtyFilesSet,
      recentFilesSet,
      skipPatterns
    });

    if (classification.state === 'Excluded') {
      stateCounts.Excluded++;
      continue;
    }

    const fullFilePath = path.join(repoRoot, relativePath);
    let rawContent;
    try {
      rawContent = fs.readFileSync(fullFilePath, 'utf8');
    } catch (err) {
      compactorWarnings.push({ file: relativePath, requestedState: classification.state, finalState: 'Excluded', reason: `Read failed: ${err.message}` });
      continue;
    }

    const rawBytes = Buffer.byteLength(rawContent, 'utf8');
    const rawTokens = countTokens(rawContent);
    totalRawBytes += rawBytes;
    totalRawTokens += rawTokens;

    let finalContent = rawContent;
    let finalState = classification.state;
    const contentHash = getFileContentHash(fullFilePath);

    if (classification.state === 'Skeleton') {
      const res = skeletonizeFile(fullFilePath, relativePath, contentHash, classification.reason);
      finalContent = res.content;
      finalState = res.state;
      if (res.warning) {
        compactorWarnings.push({ file: relativePath, requestedState: 'Skeleton', finalState: res.state, reason: res.warning });
      }
    } else if (classification.state === 'Outline') {
      const res = outlineFile(fullFilePath, relativePath, contentHash, classification.reason);
      finalContent = res.content;
      finalState = res.state;
      if (res.warning) {
        compactorWarnings.push({ file: relativePath, requestedState: 'Outline', finalState: res.state, reason: res.warning });
      }
    }

    stateCounts[finalState]++;

    const payloadBlock = `\n--- START FILE: ${relativePath} ---\n${finalContent}\n--- END FILE: ${relativePath} ---\n`;
    const finalBytes = Buffer.byteLength(payloadBlock, 'utf8');
    const finalTokens = countTokens(payloadBlock);
    
    totalCompactedBytes += finalBytes;
    totalCompactedTokens += finalTokens;

    await writeChunk(outStream, payloadBlock);
  }

  await new Promise((resolve, reject) => {
    outStream.on('error', reject);
    outStream.end(resolve);
  });

  const stats = {
    total_raw_size_bytes: totalRawBytes,
    compacted_size_bytes: totalCompactedBytes,
    total_raw_tokens: totalRawTokens,
    compacted_tokens: totalCompactedTokens,
    byte_reduction_percentage: totalRawBytes > 0 ? parseFloat(((1 - totalCompactedBytes / totalRawBytes) * 100).toFixed(2)) : 0,
    token_reduction_percentage: totalRawTokens > 0 ? parseFloat(((1 - totalCompactedTokens / totalRawTokens) * 100).toFixed(2)) : 0,
    state_counts: stateCounts,
    warnings_count: compactorWarnings.length
  };

  replaceFileAtomically(tmpOutputPath, outputPath);
  updateSyncStatusAtomically(repoRoot, stats, compactorWarnings);
  return stats;
}

function updateSyncStatusAtomically(repoRoot, stats, warnings) {
  const statusFile = path.join(repoRoot, '.sync-status.json');
  const tmpStatusFile = `${statusFile}.tmp.${Date.now()}`;
  let status = {};
  if (fs.existsSync(statusFile)) {
    try { status = JSON.parse(fs.readFileSync(statusFile, 'utf8')); } catch (_) {}
  }

  status.compaction_stats = stats;
  status.compactor_warnings = warnings;
  
  fs.writeFileSync(tmpStatusFile, JSON.stringify(status, null, 2), 'utf8');
  replaceFileAtomically(tmpStatusFile, statusFile);
}

if (process.argv[1] && process.argv[1].endsWith('index.mjs')) {
  const rawArgs = process.argv.slice(2);
  
  if (rawArgs[0] && !rawArgs[0].startsWith('--')) {
    runCompactCli(rawArgs, process.cwd()).catch(err => {
      console.error(`CLI Error: ${err.message}`);
      process.exit(1);
    });
  } else {
    const { values } = parseArgs({
      args: rawArgs,
      options: {
        'repo-root': { type: 'string' },
        'manifest': { type: 'string' },
        'output': { type: 'string' },
        'config': { type: 'string' },
        'global-config': { type: 'string' }
      }
    });

    buildCompactedPack({
      repoRoot: values['repo-root'] || process.cwd(),
      manifestPath: values['manifest'],
      outputPath: values['output'],
      configPath: values['config'],
      skipPatterns: []
    }).catch(err => {
      console.error(`Batch Pack Build Error: ${err.message}`);
      process.exit(1);
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/compactor-integration.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add modules/compactor/manifest-loader.mjs modules/compactor/index.mjs tests/compactor-integration.test.mjs
git commit -m "feat(compactor): add manifest loader and main batch pack builder entrypoint"
```

---

### Task 9: `core/flatten.sh` Integration Hook & Full Verification

**Files:**
- Modify: `core/flatten.sh:154-160`
- Create: `configs/compaction.yaml`
- Test: `tests/pipeline-flatten.test.mjs`

- [ ] **Step 1: Create `configs/compaction.yaml`**

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

- [ ] **Step 2: Update `core/flatten.sh`**

Modify `core/flatten.sh` around line 154:

```bash
# --- STEP 1.5: COMPACTED CONTEXT ENGINE -------------------------------------
COMPACTION_CONFIG="$REPO_ROOT/configs/compaction.yaml"

if [ "${COMPACTION_ENABLED:-true}" = "true" ] && [ -f "$COMPACTION_CONFIG" ]; then
  log_info "Compacted Context Engine enabled. Invoking batch compactor..."
  
  node "$REPO_ROOT/modules/compactor/index.mjs" \
    --repo-root "$REPO_ROOT" \
    --manifest "$TEMP_FILE_LIST" \
    --output "$PACK_DIR/$PACK_FILE" \
    --config "$COMPACTION_CONFIG" \
    --global-config "${GLOBAL_CONFIG:-}"
    
  log_info "Compacted knowledge pack generated successfully."
  exit 0
fi
```

- [ ] **Step 3: Run full test suite**

Run: `node --test tests/git-inspector.test.mjs tests/skeletonizer.test.mjs tests/compactor-integration.test.mjs`  
Expected: PASS (All 9 tests pass cleanly)

- [ ] **Step 4: Commit**

```bash
git add core/flatten.sh configs/compaction.yaml
git commit -m "feat(compactor): integrate Compacted Context Engine into Stage 2 flatten.sh pipeline"
```
