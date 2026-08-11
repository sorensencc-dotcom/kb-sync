# Design Specification: Compacted Context Engine (Token-Aware Sync Pipeline)

**Document Status:** Approved Design Specification  
**Target Path:** `docs/superpowers/specs/2026-08-11-compacted-context-design.md`  
**Engine Version:** v1.0.0  

---

## 1. Executive Summary & Core Motivation

As the Cast Iron Charlie (CIC) codebase expands, the size of the consolidated knowledge pack (`repo_knowledge_pack.txt`) continues to climb (~2.21 MB). While well within Google NotebookLM's **5.0 MB warning** and **8.0 MB hard constraint**, uncompacted code files consume excess context window tokens and increase LLM inference latency.

Inspired by Memcode's context compaction pattern, the **Compacted Context Engine** enhances Stage 2 of the `kb-sync` pipeline. By integrating Git modification history, local workspace diff status, explicit configuration rules, and TypeScript AST skeletonization, the engine selectively collapses mature, untouched code files into lightweight interface outlines (declarations, exports, signatures, and JSDoc comments) while preserving active, dirty, or high-risk files in full context. This targets a projected **50% to 70% reduction in byte/token footprint** (treated as a hypothesis to be empirically validated by telemetry).

> [!IMPORTANT]
> Skeletonization preserves high-level architectural structure and declared contracts, subject to documented compaction limitations (omission of internal function implementation blocks).

---

## 2. Architecture & Pipeline Integration

The Compactor sits directly between manifest compilation and consolidated file writing in `core/flatten.sh`:

```
               [Repository File Manifest]
                           │
                           ▼
             [modules/compactor/index.mjs]
                           │
    ┌──────────────────────┼──────────────────────┐
    ▼                      ▼                      ▼
[Git Status &      [Local Overrides &     [Config Rules &
 Git Log Check]    .compaction-overrides]  configs/compaction.yaml]
    │                      │                      │
    └──────────────────────┼──────────────────────┘
                           │
                           ▼
               [Strict 10-Stage Classifier]
   ┌───────────────┬───────┴───────┬───────────────┐
   ▼               ▼               ▼               ▼
 [FULL]       [SKELETON]       [OUTLINE]      [EXCLUDED]
   │               │               │               │
 (Original)  (TS Compiler API)  (Structure)   (Omit file)
   │               │               │               │
   └───────────────┼───────────────┘               │
                   │                               │
                   ▼                               ▼
       [Add Provenance Banner]                  (Skip)
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

## 3. 4-State Compaction Model & Decision Hierarchy

### 3.1 Compaction States

| Compaction State | Target File Types | Description | Default Policy |
| :--- | :--- | :--- | :--- |
| **`Full`** | Active/dirty code, high-risk paths, overrides, parser fallbacks | Preserves the entire file byte-for-byte. | Default state for all files unless explicitly qualified |
| **`Skeleton`** | Clean, untouched `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs` | Strips function/method bodies (`{ ... }`), keeping imports, exports, types, signatures, and JSDocs. | Enabled for clean stable JS/TS paths |
| **`Outline`** | `.md`, `.json` (allowlist only) | Summarizes headings or top-level keys. | Restricted strictly to `.md` and `.json`; default is `Full` |
| **`Excluded`** | Vendored code, build artifacts, lockfiles, binaries | Omitted completely from the pack. | Controlled by `skip_patterns` |

### 3.2 Strict Classifier Decision Hierarchy

File classification follows a strict, non-ambiguous 10-stage priority hierarchy:

1. **Excluded Skip Patterns Check:** Matches `skip_patterns` (always outranks dirty files to exclude lockfiles/node_modules).
2. **Global Compaction Disabled Check:** If `compaction.enabled: false`, non-excluded files default to `Full`.
3. **Fail-Closed Overrides Error Check:** If `.compaction-overrides.yaml` is malformed, force `Full`.
4. **Fail-Closed Git Inspection Check:** If Git status or log commands fail, force `Full`.
5. **Local Dirty / Untracked / Staged Check:** Files with uncommitted Git changes force `Full`.
6. **Active Local Transient Override Check:** Non-expired entries in `.compaction-overrides.yaml` force `Full`.
7. **High-Risk Path Check:** Files in `auth/`, `db/migrations/`, `deploy/`, `.github/workflows/`, `configs/` force `Full`.
8. **Bulk Git Recency Check:** Files modified within `git_window_days` (default: 14 days) force `Full`.
9. **Explicit Prefix Rule Match:** Matches `configs/compaction.yaml` rules (first match wins for clean stable files).
10. **Default Policy Fallback:** Unclassified files default to `compaction.default_level` (`Full`).

---

## 4. AST Skeletonizer Engine (`modules/compactor/skeletonizer.mjs`)

The skeletonizer uses the official `typescript` Compiler API (pinned to `"typescript": "5.4.5"`) to safely parse ASTs and replace function bodies with explicit non-executable throw statements.

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
    const sourceFile = ts.createSourceFile(
      filePath,
      rawContent,
      ts.ScriptTarget.Latest,
      true, // Preserve trivia (comments / JSDoc)
      scriptKind
    );

    if (sourceFile.parseDiagnostics && sourceFile.parseDiagnostics.length > 0) {
      const diag = sourceFile.parseDiagnostics[0];
      const pos = sourceFile.getLineAndCharacterOfPosition(diag.start);
      const text = typeof diag.messageText === 'string' ? diag.messageText : diag.messageText.messageText;
      return {
        content: rawContent,
        state: 'Full',
        warning: `Parse diagnostic error: "${text}" at line ${pos.line + 1}:${pos.character + 1}`
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

## 5. Security & Canonical Path Boundary (`modules/compactor/path-utils.mjs`)

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
```

---

## 6. Windows-Safe Atomic Replacement (`modules/compactor/atomic-file.mjs`)

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

---

## 7. Provenance & CLI Subcommand Suite (`modules/compactor/cli.mjs`)

Command interface exposed via `npm run kb:compact -- <subcommand>`:

- `inspect`: Displays latest compaction statistics from `.sync-status.json`.
- `restore <path>`: Writes a transient override entry to `.compaction-overrides.yaml` forcing `Full` context for 3 days.
- `dump <path>`: Prints the raw, uncompacted file directly to stdout for instant reference.
- `prune-overrides`: Cleans expired override entries safely.

---

## 8. Telemetry Metrics & Status Schema

Telemetry is recorded in `.sync-status.json` under `compaction_stats`:

```json
{
  "compaction_stats": {
    "total_raw_size_bytes": 2170779,
    "compacted_size_bytes": 845000,
    "total_raw_tokens": 542694,
    "compacted_tokens": 211250,
    "byte_reduction_percentage": 61.07,
    "token_reduction_percentage": 61.07,
    "state_counts": {
      "Full": 44,
      "Skeleton": 182,
      "Outline": 12,
      "Excluded": 35
    },
    "warnings_count": 0
  }
}
```

---

## 9. Verification Plan & Test Matrix

The engine requires automated vitest coverage before deployment:

| Test Module | Test Coverage Required |
| :--- | :--- |
| `tests/skeletonizer.test.mjs` | Functions, methods, getters/setters, arrow functions, decorators, generics, JSX/TSX, fail-closed fallback |
| `tests/classifier.test.mjs` | 10-stage resolution hierarchy, dirty status, override precedence, recency window, high-risk path rules |
| `tests/path-utils.test.mjs` | Path traversal rejection, POSIX slashes, symlink escaping, Windows drive root checks |
| `tests/atomic-file.test.mjs` | Atomic file promotion, backup restoration on failure, Windows file lock handling |
| `tests/integration.test.mjs` | Full `buildCompactedPack` end-to-end pass, pack manifest verification, `.sync-status.json` generation |
