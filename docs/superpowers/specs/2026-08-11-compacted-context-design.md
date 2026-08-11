# Design Specification: Compacted Context Engine (Token-Aware Sync Pipeline)

**Document Status:** Approved Design Specification  
**Target Paths:**  
- `docs/meta/specs/2026-08-11-compacted-context-design.md` (Governed)  
- `docs/superpowers/specs/2026-08-11-compacted-context-design.md`  
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

## 4. 4-State Compaction Model & Classifier Engine (`modules/compactor/classifier.mjs`)

```javascript
import { normalizeRepoPath, matchGlobPattern } from './path-utils.mjs';

const JS_TS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const OUTLINE_EXTENSIONS = new Set(['.md', '.json']);

function isJsTsFile(filePath) {
  const ext = filePath.slice(((filePath.lastIndexOf(".") - 1) >>> 0) + 2).toLowerCase();
  return JS_TS_EXTENSIONS.has('.' + ext);
}

function isOutlineAllowedFile(filePath) {
  const ext = filePath.slice(((filePath.lastIndexOf(".") - 1) >>> 0) + 2).toLowerCase();
  return OUTLINE_EXTENSIONS.has('.' + ext);
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

## 5. Config Loader & Overrides Manager

### 5.1 `modules/compactor/config-loader.mjs`

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

### 5.2 `modules/compactor/overrides-manager.mjs`

```javascript
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { normalizeRepoPath } from './path-utils.mjs';

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
  try {
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    fs.copyFileSync(tmpPath, filePath);
    fs.unlinkSync(tmpPath);
  }
}
```

---

## 6. AST Skeletonizer Engine (`modules/compactor/skeletonizer.mjs`)

Uses TypeScript Public API (`ts.transpileModule` with `reportDiagnostics: true`) to safely check syntax diagnostics before AST transformation, avoiding internal/private compiler properties.

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

    // Fail-Closed Check via Public Compiler API
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

## 7. Token Telemetry & Process-Lifetime Encoder (`modules/compactor/telemetry.mjs`)

```javascript
import { getEncoding } from 'js-tiktoken';

// Singleton instance managed across process lifetime
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

## 8. CLI Command Interface (`modules/compactor/cli.mjs`)

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

## 9. Batch Pack Builder (`modules/compactor/index.mjs`)

```javascript
import fs from 'node:fs';
import path from 'node:path';
import { classifyFile } from './classifier.mjs';
import { skeletonizeFile } from './skeletonizer.mjs';
import { outlineFile } from './outliner.mjs';
import { getGitDirtyFiles, getBulkRecentlyModifiedFiles, getFileContentHash } from './git-inspector.mjs';
import { loadActiveOverrides } from './overrides-manager.mjs';
import { loadCompactionConfig } from './config-loader.mjs';
import { loadNormalizedManifest } from './manifest-loader.mjs';
import { countTokens } from './telemetry.mjs';
import { replaceFileAtomically } from './atomic-file.mjs';

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
```

---

## 10. Verification Plan & Test Suite Matrix

| Test Suite | File Path | Scope & Assertions |
| :--- | :--- | :--- |
| **Skeletonizer Unit Tests** | `tests/skeletonizer.test.mjs` | Function declarations, FunctionExpression (`const foo = function()`), ArrowFunctions, MethodDeclarations, constructors, getters/setters, decorators, generics, JSX/TSX, `ts.transpileModule` fail-closed fallback |
| **Classifier Unit Tests** | `tests/classifier.test.mjs` | 10-stage hierarchy resolution, dirty Git workspace check, override precedence, recency window, high-risk path rules, default fallback |
| **Path Security Tests** | `tests/path-utils.test.mjs` | Path traversal (`../`), POSIX slash normalization, symlink escaping verification, root target rejection |
| **Atomic File Replacement Tests** | `tests/atomic-file.test.mjs` | Atomic file promotion, `.bak` restoration on failed replace, Windows lock collision recovery |
| **End-to-End Integration Tests** | `tests/integration.test.mjs` | Full `buildCompactedPack` pass, `.sync-status.json` atomic update, telemetry calculations, `core/flatten.sh` execution |
