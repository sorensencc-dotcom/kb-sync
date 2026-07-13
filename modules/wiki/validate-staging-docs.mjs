#!/usr/bin/env node
// ==============================================================================
// Staging Markdown Validator
// Lints a kb-sync staging snapshot (or the wiki dir) for broken relative
// markdown links, unresolved [[wiki-links]], and missing structure — before
// the snapshot is handed to the wiki semantic synthesis layer.
// ==============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const COLOR = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', reset: '\x1b[0m' };
const logInfo = (msg) => console.error(`${COLOR.green}[VALIDATE-STAGING] [INFO]${COLOR.reset} ${msg}`);
const logWarn = (msg) => console.error(`${COLOR.yellow}[VALIDATE-STAGING] [WARN]${COLOR.reset} ${msg}`);
const logError = (msg) => console.error(`${COLOR.red}[VALIDATE-STAGING] [ERROR]${COLOR.reset} ${msg}`);

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKIP_DIRS = new Set(['.git', 'node_modules']);

function repoRoot() {
  try {
    return execSync('git rev-parse --show-toplevel', { cwd: SCRIPT_DIR }).toString().trim();
  } catch (err) {
    logError(`Not inside a git repository (or git not on PATH): ${err.message.trim()}`);
    process.exit(1);
  }
}

// Mirrors ingest-wiki.sh's get_config_value: tolerant of "key: value" / "key=value",
// inline "# comment" stripping, and raw (non-YAML-escaped) values like Windows paths.
function getConfigValue(file, key) {
  const content = fs.readFileSync(file, 'utf8');
  const re = new RegExp(`^\\s*${key}\\s*[:=]\\s*(.*)$`, 'm');
  const match = content.match(re);
  if (!match) return null;
  return match[1].replace(/#.*$/, '').trim().replace(/^['"]|['"]$/g, '');
}

function findLatestStaging(vaultRoot, stagingDir) {
  const base = path.join(vaultRoot, stagingDir, 'kb-sync');
  if (!fs.existsSync(base)) return null;
  const snapshots = fs.readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{8}-\d{6}$/.test(d.name))
    .map((d) => d.name)
    .sort();
  return snapshots.length ? path.join(base, snapshots[snapshots.length - 1]) : null;
}

function walkMarkdownFiles(dir) {
  const results = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(path.join(current, entry.name));
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        results.push(path.join(current, entry.name));
      }
    }
  }
  return results;
}

// Maps lowercased basename -> array of relative paths (usually length 1;
// length > 1 means the name is ambiguous and callers should flag it rather
// than silently resolving to whichever file happened to be seen first).
function buildWikiRegistry(wikiRoot) {
  const registry = new Map();
  if (!fs.existsSync(wikiRoot)) return registry;
  for (const file of walkMarkdownFiles(wikiRoot)) {
    const name = path.basename(file, '.md').toLowerCase();
    const relPath = path.relative(wikiRoot, file);
    if (!registry.has(name)) registry.set(name, [relPath]);
    else registry.get(name).push(relPath);
  }
  return registry;
}

const WIKI_LINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
const MD_LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;
const LEVENSHTEIN_THRESHOLD = 2; // Suggest matches within this distance

// Levenshtein distance: measure similarity between two strings
function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

// Find closest matches in registry by Levenshtein distance
function findSuggestions(name, registry, maxDistance = LEVENSHTEIN_THRESHOLD) {
  const suggestions = [];
  const nameLower = name.toLowerCase();
  for (const [regName, paths] of registry) {
    const dist = levenshteinDistance(nameLower, regName);
    if (dist <= maxDistance) {
      suggestions.push({ name: regName, paths, distance: dist });
    }
  }
  return suggestions.sort((a, b) => a.distance - b.distance).slice(0, 3);
}

function safeDecode(target) {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function validateFile(file, registry, repoRootPath) {
  const errors = [];
  const warnings = [];
  const content = fs.readFileSync(file, 'utf8');
  const dir = path.dirname(file);
  // Illustrative [[Links]] and (paths) inside fenced code examples (common in
  // templates/lint-rules docs) aren't real references — don't scan them.
  const scanContent = content.replace(/```[\s\S]*?```/g, '');

  const firstLines = content.split(/\r?\n/).slice(0, 10);
  if (!firstLines.some((line) => /^#\s+\S/.test(line))) {
    warnings.push('missing top-level "# Heading"');
  }

  for (const match of scanContent.matchAll(WIKI_LINK_RE)) {
    const name = match[1].trim();
    const hit = registry.get(name.toLowerCase());
    if (!hit) {
      const suggestions = findSuggestions(name, registry);
      let msg = `unresolved wiki-link [[${name}]] (no matching page in wiki registry)`;
      if (suggestions.length > 0) {
        const suggStr = suggestions.map(s => `[[${s.name}]]`).join(' or ');
        msg += `. Did you mean: ${suggStr}?`;
      }
      warnings.push(msg);
    } else if (hit.length > 1) {
      warnings.push(`ambiguous wiki-link [[${name}]] matches ${hit.length} pages: ${hit.join(', ')}`);
    }
  }

  for (const match of scanContent.matchAll(MD_LINK_RE)) {
    let target = match[1].trim();
    if (!target || /^(https?:|mailto:|#)/i.test(target)) continue;
    target = target.split('#')[0].trim();
    if (!target) continue;
    const decoded = safeDecode(target);
    const resolved = decoded.startsWith('/')
      ? path.resolve(repoRootPath, decoded.replace(/^\/+/, ''))
      : path.resolve(dir, decoded);
    if (!fs.existsSync(resolved)) {
      errors.push(`broken relative link -> "${target}" (resolved: ${resolved})`);
    }
  }

  return { errors, warnings };
}

function main() {
  const root = repoRoot();
  const configFile = path.join(root, 'configs', 'obsidian.yaml');
  if (!fs.existsSync(configFile)) {
    logError(`Config not found: ${configFile}`);
    process.exit(1);
  }

  const vaultRoot = process.env.OBSIDIAN_VAULT_ROOT || getConfigValue(configFile, 'vault_root');
  const stagingDir = getConfigValue(configFile, 'staging_dir');
  const wikiDir = getConfigValue(configFile, 'wiki_dir');
  if (!vaultRoot || !stagingDir || !wikiDir) {
    logError('vault_root / staging_dir / wiki_dir missing from configs/obsidian.yaml');
    process.exit(1);
  }

  const argTarget = process.argv[2];
  const targetDir = argTarget
    ? path.resolve(argTarget)
    : findLatestStaging(vaultRoot, stagingDir);

  if (!targetDir || !fs.existsSync(targetDir)) {
    logError(argTarget
      ? `Target not found: ${targetDir}`
      : `No staging snapshots found under ${path.join(vaultRoot, stagingDir, 'kb-sync')}. Run: npm run kb:sync:obsidian`);
    process.exit(1);
  }

  if (!fs.statSync(targetDir).isDirectory()) {
    logError(`Target is not a directory: ${targetDir}`);
    process.exit(1);
  }

  logInfo(`Target: ${targetDir}`);

  const registry = buildWikiRegistry(path.join(vaultRoot, wikiDir));
  const totalPages = [...registry.values()].reduce((sum, arr) => sum + arr.length, 0);
  logInfo(`Wiki registry: ${totalPages} page(s), ${registry.size} unique name(s), loaded from ${path.join(vaultRoot, wikiDir)}`);

  const files = walkMarkdownFiles(targetDir);
  if (!files.length) {
    logWarn('No markdown files found in target.');
    process.exit(0);
  }

  let totalErrors = 0;
  let totalWarnings = 0;

  for (const file of files) {
    const { errors, warnings } = validateFile(file, registry, root);
    if (!errors.length && !warnings.length) continue;
    const rel = path.relative(targetDir, file);
    console.log(`\n${rel}`);
    for (const e of errors) {
      console.log(`  ${COLOR.red}✗ ERROR${COLOR.reset} ${e}`);
      totalErrors++;
    }
    for (const w of warnings) {
      console.log(`  ${COLOR.yellow}⚠ WARN${COLOR.reset}  ${w}`);
      totalWarnings++;
    }
  }

  console.log('');
  logInfo(`Scanned ${files.length} file(s): ${totalErrors} error(s), ${totalWarnings} warning(s).`);

  process.exit(totalErrors > 0 ? 1 : 0);
}

main();
