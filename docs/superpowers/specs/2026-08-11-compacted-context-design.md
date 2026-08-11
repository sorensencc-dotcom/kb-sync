# Design Specification: Compacted Context Engine (Token-Aware Sync Pipeline)

**Document Status:** Draft (In Review)  
**Canonical Path:** `docs/meta/specs/2026-08-11-compacted-context-design.md` (Governed Source of Truth)  
**Mirrored Path:** `docs/superpowers/specs/2026-08-11-compacted-context-design.md` (Automated Spec Mirror)  
**Engine Version:** v1.0.0  

---

## 1. Executive Summary & Core Motivation

As the Cast Iron Charlie (CIC) codebase expands, the size of the consolidated knowledge pack (`repo_knowledge_pack.txt`) continues to climb (~2.21 MB). While well within Google NotebookLM's **5.0 MB warning** and **8.0 MB hard constraint**, uncompacted code files consume excess context window tokens and increase LLM inference latency.

Inspired by Memcode's context compaction pattern, the **Compacted Context Engine** enhances Stage 2 of the `kb-sync` pipeline. By integrating Git modification history, local workspace diff status, explicit configuration rules, and TypeScript AST skeletonization, the engine selectively collapses mature, untouched code files into lightweight interface outlines (declarations, exports, signatures, and JSDoc comments) while preserving active, dirty, or high-risk files in full context. This targets a projected **50% to 70% reduction in byte/token footprint** (treated as a hypothesis to be empirically validated by telemetry).

> [!IMPORTANT]
> Skeletonization preserves high-level architectural structure and declared contracts, subject to documented compaction limitations (omission of internal function implementation blocks).

---

## 2. Architecture & `core/flatten.sh` Integration

The Compactor sits directly inside Stage 2 of `core/flatten.sh`. When compaction is enabled, `flatten.sh` delegates full batch pack compilation to `modules/compactor/index.mjs`:

```bash
# core/flatten.sh integration hook
COMPACTION_CONFIG="$REPO_ROOT/configs/compaction.yaml"

if [ "$COMPACTION_ENABLED" = "true" ] && [ -f "$COMPACTION_CONFIG" ]; then
  log_info "Compacted Context Engine enabled. Invoking batch compactor..."
  
  node "$REPO_ROOT/modules/compactor/index.mjs" \
    --repo-root "$REPO_ROOT" \
    --manifest "$TEMP_FILE_LIST" \
    --output "$PACK_DIR/$PACK_FILE" \
    --config "$COMPACTION_CONFIG" \
    --global-config "$GLOBAL_CONFIG"
    
  log_info "Compacted knowledge pack generated successfully."
  exit 0
fi
```

### Pipeline Execution Diagram

```
                 [git grep File List Manifest]
                              │
                              ▼
            [node modules/compactor/index.mjs]
                              │
    ┌─────────────────────────┼─────────────────────────┐
    ▼                         ▼                         ▼
[Git Status &         [Local Overrides &        [Config Rules &
 Git Log Check]       .compaction-overrides]    configs/compaction.yaml]
    │                         │                         │
    └─────────────────────────┼─────────────────────────┘
                              │
                              ▼
                 [10-Stage Classifier Pipeline]
   ┌──────────────────┬───────┴───────┬──────────────────┐
   ▼                  ▼               ▼                  ▼
 [FULL]          [SKELETON]       [OUTLINE]         [EXCLUDED]
   │                  │               │                  │
 (Original)     (TS Compiler API) (Structure)      (Omit file)
   │                  │               │                  │
   └──────────────────┼───────────────┘                  │
                      │                                  │
                      ▼                                  ▼
          [Add Provenance Banner]                     (Skip)
                      │
                      ▼
            [Atomic Staging File]
          (.nlm_pack/pack.tmp.txt)
                      │
                      ▼ (Verify Integrity, Hashes & Non-Zero Byte Count)
         [Atomic Replacement / Rollback]
            (repo_knowledge_pack.txt)
```

---

## 3. Schemas & Configuration Specs

### 3.1 Policy Configuration Schema (`configs/compaction.yaml`)

```yaml
# configs/compaction.yaml
compaction:
  # Global compaction toggle. When false, all non-excluded files default to Full context.
  enabled: true
  
  # Git modification recency window in days. Files modified within this window resolve to Full.
  git_window_days: 14
  
  # Default state for files not explicitly matched by prefix rules (Full | Skeleton | Outline | Excluded)
  default_level: "Full"
  
  # High-risk path prefixes. Files matching these prefixes always force Full context.
  high_risk_prefixes:
    - "auth/"
    - "db/migrations/"
    - "deploy/"
    - ".github/workflows/"
    - "configs/"

  # Path rules (evaluated top-to-bottom; first match wins for clean stable files)
  rules:
    - prefix: "modules/obsidian/"
      level: "Full"          # Domain logic; keep full
    - prefix: "core/"
      level: "Skeleton"      # Pipeline engines; skeletonize
    - prefix: "modules/compactor/"
      level: "Skeleton"      # Compactor itself; skeletonize
    - prefix: "tests/"
      level: "Outline"       # Test names and suites outlined (Markdown/JSON only)
    - prefix: "wiki/"
      level: "Full"          # Knowledge nodes; keep full
```

### 3.2 Transient Override Schema (`.compaction-overrides.yaml`)

```yaml
# .compaction-overrides.yaml (Git-ignored)
# Managed via npm run kb:compact -- --restore <path>
overrides:
  - path: "core/dag.mjs"
    created_at: "2026-08-11T17:50:00Z"
    expire_at: "2026-08-14T17:50:00Z"
    reason: "Requested by LLM session for structural validation debug"
```

---

## 4. Path Utilities & Security Boundary (`modules/compactor/path-utils.mjs`)

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

  // Symlink Safety Boundary Check: Verifies underlying real path stays within repo root
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

---

## 5. Git Status & Content Hashing (`modules/compactor/git-inspector.mjs`)

```javascript
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { normalizeRepoPath } from './path-utils.mjs';

/**
 * Computes 12-char SHA-256 content hash of file content on disk.
 */
export function getFileContentHash(fullPath) {
  try {
    const buffer = fs.readFileSync(fullPath);
    return crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 12);
  } catch (_) {
    return 'unknown-hash';
  }
}

/**
 * Parses git status -z including rename (R) and copy (C) source and target pairs.
 */
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
    return null; // Fail-Closed: Return null to force ALL files to Full
  }
}

/**
 * Bulk fetches all files modified within recent N days in ONE single Git log call.
 */
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
    return null; // Fail-Closed: Force all to Full if git log fails
  }
}
```

---

## 6. Atomic File Replacement (`modules/compactor/atomic-file.mjs`)

```javascript
import fs from 'node:fs';
import path from 'node:path';

/**
 * Atomically replaces destPath with srcPath with Windows file-locking retry safety.
 * Preserves prior target file intact via temporary backup if promotion fails.
 */
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

---

## 7. Outliner Engine (`modules/compactor/outliner.mjs`)

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

---

## 8. 4-State Compaction Classifier (`modules/compactor/classifier.mjs`)

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

  // 1. Excluded Skip Patterns Check
  for (const pattern of skipPatterns || []) {
    if (matchGlobPattern(relativePath, pattern)) {
      return { state: 'Excluded', reason: `Matched exclusion pattern (${pattern})` };
    }
  }

  // 2. Global Compaction Disabled Check
  if (!config.compaction.enabled) {
    return { state: 'Full', reason: 'Global compaction disabled (compaction.enabled = false)' };
  }

  // 3. Fail-Closed Overrides Error Check
  if (overridesResult.error) {
    return { state: 'Full', reason: `Fail-closed: Overrides error (${overridesResult.error})` };
  }

  // 4. Fail-Closed Git Inspection Check
  if (dirtyFilesSet === null || recentFilesSet === null) {
    return { state: 'Full', reason: 'Fail-closed: Git status or log inspection failed' };
  }

  // 5. Local Dirty / Untracked / Staged Check
  if (dirtyFilesSet.has(relativePath)) {
    return { state: 'Full', reason: 'Uncommitted local modifications (Git dirty state)' };
  }

  // 6. Active Transient Local Override Check
  if (overridesResult.map.has(relativePath)) {
    return { state: 'Full', reason: 'Active local override in .compaction-overrides.yaml' };
  }

  // 7. High-Risk Path Check
  for (const prefix of config.compaction.high_risk_prefixes || []) {
    if (matchesPrefixBoundary(relativePath, prefix)) {
      return { state: 'Full', reason: `High-risk path match (${prefix})` };
    }
  }

  // 8. Bulk Git Recency Check
  if (recentFilesSet.has(relativePath)) {
    return { state: 'Full', reason: `Modified within recent ${config.compaction.git_window_days}-day Git window` };
  }

  // 9. Explicit Configured Rule Match (First match wins)
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

  // 10. Default Policy Fallback
  return { state: config.compaction.default_level, reason: `Default policy fallback (${config.compaction.default_level})` };
}
```

---

## 9. AST Skeletonizer Engine (`modules/compactor/skeletonizer.mjs`)

Uses TypeScript Public API (`ts.transpileModule` with `reportDiagnostics: true`) to safely check syntax diagnostics before AST transformation.

> [!NOTE]
> `ts.transpileModule` performs fast syntactic syntax diagnostic verification. Semantic/type-checking diagnostics (which require full symbol graph building) are intentionally out of scope for pipeline speed performance.

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

    // Fail-Closed Syntactic Diagnostic Gate via Public Compiler API
    const transpileResult = ts.transpileModule(rawContent, {
      compilerOptions: { target: ts.ScriptTarget.Latest, jsx: ts.JsxEmit.Preserve },
      reportDiagnostics: true
    });

    if (transpileResult.diagnostics && transpileResult.diagnostics.length > 0) {
      const diag = transpileResult.diagnostics[0];
      const text = typeof diag.messageText === 'string' ? diag.messageText : diag.messageText.messageText;
      return {
        content: rawContent,
        state: 'Full',
        warning: `Syntactic diagnostic error: "${text}"`
      };
    }

    const sourceFile = ts.createSourceFile(
      filePath,
      rawContent,
      ts.ScriptTarget.Latest,
      true,
      scriptKind
    );

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

---

## 10. Token Telemetry (`modules/compactor/telemetry.mjs`)

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

---

## 11. CLI Command Suite (`modules/compactor/cli.mjs`)

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

---

## 12. Batch Pack Builder Main Entry (`modules/compactor/index.mjs`)

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

// Main CLI Execution Guard
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

---

## 13. Config Loader (`modules/compactor/config-loader.mjs`)

Validates `configs/compaction.yaml` against the schema in §3.1. Fail-closed: any missing/malformed field throws — callers (via `buildCompactedPack`) do not catch this, so a broken config aborts the build rather than silently falling back to defaults.

```javascript
import fs from 'node:fs';
import yaml from 'js-yaml';

const REQUIRED_LEVELS = new Set(['Full', 'Skeleton', 'Outline', 'Excluded']);

export function loadCompactionConfig(configPath) {
  if (!configPath || !fs.existsSync(configPath)) {
    throw new Error(`Config Error: compaction config not found at "${configPath}"`);
  }

  let parsed;
  try {
    parsed = yaml.load(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    throw new Error(`Config Error: failed to parse YAML at "${configPath}": ${err.message}`);
  }

  const compaction = parsed && parsed.compaction;
  if (!compaction || typeof compaction !== 'object') {
    throw new Error(`Config Error: missing top-level "compaction" key in "${configPath}"`);
  }

  if (typeof compaction.enabled !== 'boolean') {
    throw new Error('Config Error: compaction.enabled must be a boolean');
  }
  if (!REQUIRED_LEVELS.has(compaction.default_level)) {
    throw new Error(`Config Error: compaction.default_level must be one of ${[...REQUIRED_LEVELS].join(', ')}`);
  }
  if (typeof compaction.git_window_days !== 'number' || compaction.git_window_days < 0) {
    throw new Error('Config Error: compaction.git_window_days must be a non-negative number');
  }

  compaction.high_risk_prefixes = Array.isArray(compaction.high_risk_prefixes) ? compaction.high_risk_prefixes : [];
  compaction.rules = Array.isArray(compaction.rules) ? compaction.rules : [];

  for (const [i, rule] of compaction.rules.entries()) {
    if (!rule || typeof rule.prefix !== 'string' || !REQUIRED_LEVELS.has(rule.level)) {
      throw new Error(`Config Error: rules[${i}] must have a string "prefix" and valid "level"`);
    }
  }

  return { compaction };
}
```

---

## 14. Overrides Manager (`modules/compactor/overrides-manager.mjs`)

Loads/persists `.compaction-overrides.yaml` (§3.2). `loadActiveOverrides` returns `{ map, error }` — fail-closed on malformed YAML or schema violations (`map: null`, `error` set); classifier stage 3 (§8) forces `Full` on any `error`. Expired entries are dropped silently during load, not treated as errors. `saveOverrides` re-filters expired entries defensively at write time, so `prune-overrides` (§11) and `restore` (§11) share one code path and neither can accidentally persist a stale entry.

```javascript
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const OVERRIDES_FILENAME = '.compaction-overrides.yaml';

export function loadActiveOverrides(repoRoot) {
  const filePath = path.join(repoRoot, OVERRIDES_FILENAME);

  if (!fs.existsSync(filePath)) {
    return { map: new Map(), error: null };
  }

  let parsed;
  try {
    parsed = yaml.load(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return { map: null, error: `Failed to parse ${OVERRIDES_FILENAME}: ${err.message}` };
  }

  if (parsed == null) {
    return { map: new Map(), error: null };
  }

  const entries = parsed.overrides;
  if (!Array.isArray(entries)) {
    return { map: null, error: `${OVERRIDES_FILENAME}: "overrides" must be an array` };
  }

  const now = Date.now();
  const map = new Map();

  for (const [i, entry] of entries.entries()) {
    if (!entry || typeof entry.path !== 'string' || typeof entry.expire_at !== 'string') {
      return { map: null, error: `${OVERRIDES_FILENAME}: overrides[${i}] missing required "path" or "expire_at"` };
    }
    const expireMs = Date.parse(entry.expire_at);
    if (Number.isNaN(expireMs)) {
      return { map: null, error: `${OVERRIDES_FILENAME}: overrides[${i}] has invalid expire_at "${entry.expire_at}"` };
    }
    if (expireMs <= now) continue; // expired: drop silently, not an error
    map.set(entry.path, entry);
  }

  return { map, error: null };
}

export function saveOverrides(repoRoot, map) {
  const filePath = path.join(repoRoot, OVERRIDES_FILENAME);
  const now = Date.now();
  const overrides = [...map.values()].filter(entry => {
    const expireMs = Date.parse(entry.expire_at);
    return !Number.isNaN(expireMs) && expireMs > now;
  });

  const doc = {
    overrides: overrides.map(({ path: p, created_at, expire_at, reason }) => ({
      path: p, created_at, expire_at, reason
    }))
  };

  fs.writeFileSync(filePath, yaml.dump(doc), 'utf8');
}
```

---

## 15. Dependency Gaps (Pre-Implementation Blockers)

The following must land before `writing-plans` / implementation, not after — confirmed by direct inspection of `kb-sync/package.json` and `node_modules`:

| Dependency | Current State | Required |
| :--- | :--- | :--- |
| `typescript` | `package.json` declares `^5.0.0`; not present in `node_modules` at all (not installed) | Pin to `5.4.5` exactly (skeletonizer's `ts.version.startsWith('5.4')` guard throws otherwise), then `npm install` |
| `js-tiktoken` | Not declared in `package.json`; not installed | Add as a dependency, `npm install` |
| `js-yaml` | Already declared (`^4.1.0`) and used by `config-loader.mjs` / `overrides-manager.mjs` | No action — already satisfied |

---

## 16. Verification Plan & Test Suite Matrix

| Test Suite | File Path | Scope & Assertions |
| :--- | :--- | :--- |
| **Skeletonizer Unit Tests** | `tests/skeletonizer.test.mjs` | Function declarations, FunctionExpression (`const foo = function()`), ArrowFunctions, MethodDeclarations, constructors, getters/setters, decorators, generics, JSX/TSX, `ts.transpileModule` fail-closed fallback |
| **Classifier Unit Tests** | `tests/classifier.test.mjs` | 10-stage hierarchy resolution, dirty Git workspace check, override precedence, recency window, high-risk path rules, default fallback |
| **Path Security Tests** | `tests/path-utils.test.mjs` | Path traversal (`../`), POSIX slash normalization, symlink escaping verification (`fs.realpathSync`), root target rejection |
| **Atomic File Replacement Tests** | `tests/atomic-file.test.mjs` | Atomic file promotion, `.bak` restoration on failed replace, Windows lock collision recovery |
| **Config Loader Tests** | `tests/config-loader.test.mjs` | Missing file, malformed YAML, missing/invalid `compaction.enabled`/`default_level`/`git_window_days`, invalid rule entries |
| **Overrides Manager Tests** | `tests/overrides-manager.test.mjs` | Missing file (empty map), malformed YAML (fail-closed error), expired-entry filtering on load, `saveOverrides` round-trip, `saveOverrides` re-filtering stale entries at write time |
| **Manifest Loader Tests** | `tests/manifest-loader.test.mjs` | Missing manifest file, comment/blank-line skipping, path-traversal rejection surfaced as `Manifest Boundary Errors`, duplicate-entry dedup via `Set` |
| **End-to-End Integration Tests** | `tests/integration.test.mjs` | Full `buildCompactedPack` pass, `.sync-status.json` atomic update, telemetry calculations, `core/flatten.sh` execution |

> [!NOTE]
> `config-loader.mjs`, `overrides-manager.mjs`, `manifest-loader.mjs`, `classifier.mjs`, and `path-utils.mjs` were smoke-tested manually against a temp repo fixture (config parse, override expiry filtering + round-trip save, malformed-YAML fail-closed, manifest path-traversal rejection, classifier priority resolution) — all passed. `skeletonizer.mjs` and `telemetry.mjs` were NOT smoke-tested: `typescript` and `js-tiktoken` are not installed in `node_modules` (see §15), so nothing importing them can currently run.
