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
const IGNORE_FILES = ['.cicignore', '.gitignore'];

function repoRoot() {
  try {
    return execSync('git rev-parse --show-toplevel', { cwd: SCRIPT_DIR }).toString().trim();
  } catch (err) {
    logError(`Not inside a git repository (or git not on PATH): ${err.message.trim()}`);
    process.exit(1);
  }
}

// Get changed files relative to HEAD (for --diff mode)
function getChangedFiles(targetDir) {
  try {
    const output = execSync('git diff --name-only HEAD', { cwd: targetDir, encoding: 'utf8' });
    return new Set(output.split('\n').filter(f => f.trim()).map(f => f.replace(/\\/g, '/')));
  } catch {
    return new Set();
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

// Load patterns from .cicignore and .gitignore, returning regex objects
function loadIgnorePatterns(dir) {
  const patterns = [];
  for (const ignoreFile of IGNORE_FILES) {
    const filePath = path.join(dir, ignoreFile);
    if (fs.existsSync(filePath)) {
      const lines = fs.readFileSync(filePath, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.replace(/#.*$/, '').trim();
        if (!trimmed) continue;
        patterns.push(globToRegex(trimmed));
      }
    }
  }
  return patterns;
}

// Convert gitignore glob pattern to regex (basic: *, **, /)
function globToRegex(pattern) {
  let isNegation = pattern.startsWith('!');
  if (isNegation) pattern = pattern.slice(1);

  let regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape special chars
    .replace(/\*\*/g, '{{DOUBLESTAR}}')     // Temp marker
    .replace(/\*/g, '[^/]*')                 // Single-level wildcard
    .replace(/{{DOUBLESTAR}}/g, '.*');      // Multi-level wildcard

  // Trailing slash matches dirs only
  const dirsOnly = pattern.endsWith('/');
  if (dirsOnly) regex = regex.slice(0, -2); // Remove escaped /

  return { regex: new RegExp(`^${regex}$`), negation: isNegation, dirsOnly };
}

// Check if path (relative to root) is ignored
function isIgnored(relPath, patterns) {
  const parts = relPath.split(path.sep);
  let ignored = false;

  for (const pattern of patterns) {
    if (pattern.dirsOnly && !relPath.endsWith(path.sep)) continue;

    if (pattern.regex.test(relPath) || parts.some((p, i) => {
      const subPath = parts.slice(0, i + 1).join('/');
      return pattern.regex.test(subPath);
    })) {
      ignored = !pattern.negation;
    }
  }
  return ignored;
}

function walkMarkdownFiles(dir, ignorePatterns = []) {
  const results = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      const relPath = path.relative(dir, entryPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !isIgnored(relPath, ignorePatterns)) {
          stack.push(entryPath);
        }
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        if (!isIgnored(relPath, ignorePatterns)) {
          results.push(entryPath);
        }
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
const ALIAS_LINK_RE = /\[\[([^\]|]+)\|([^\]]+)\]\]/g;
const MD_LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;
const LEVENSHTEIN_THRESHOLD = 2; // Suggest matches within this distance
const FRONTMATTER_SCHEMA = {
  title: { required: true, type: 'string' },
  description: { required: false, type: 'string' },
  tags: { required: false, type: 'array' },
  author: { required: false, type: 'string' },
  date: { required: false, type: 'string' }
};

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

// Detect alias usage: [[page|alias]] and suggest disambiguation
function detectAliasDisambiguation(content, registry) {
  const suggestions = [];
  for (const match of content.matchAll(ALIAS_LINK_RE)) {
    const page = match[1].trim();
    const alias = match[2].trim();
    const pageLower = page.toLowerCase();
    const aliasLower = alias.toLowerCase();

    // Check if alias could resolve to a different page
    const candidates = [];
    for (const [regName, paths] of registry) {
      if (regName === pageLower) continue;
      if (levenshteinDistance(aliasLower, regName) <= LEVENSHTEIN_THRESHOLD) {
        candidates.push(regName);
      }
    }

    if (candidates.length > 0) {
      suggestions.push({
        alias: `[[${page}|${alias}]]`,
        intended: page,
        conflicts: candidates.slice(0, 2)
      });
    }
  }
  return suggestions;
}

// Extract frontmatter from markdown (YAML between --- delimiters)
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return null;
  const yaml = match[1];
  const result = {};
  for (const line of yaml.split('\n')) {
    const [key, ...valueParts] = line.split(':');
    if (!key.trim() || !valueParts.length) continue;
    const value = valueParts.join(':').trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      result[key.trim()] = value.slice(1, -1).split(',').map(v => v.trim());
    } else if (value.toLowerCase() === 'true' || value.toLowerCase() === 'false') {
      result[key.trim()] = value.toLowerCase() === 'true';
    } else {
      result[key.trim()] = value.replace(/^['"]|['"]$/g, '');
    }
  }
  return Object.keys(result).length ? result : null;
}

// Validate frontmatter against schema
function validateFrontmatter(frontmatter, schema) {
  const errors = [];
  if (!frontmatter && Object.values(schema).some(s => s.required)) {
    errors.push('missing frontmatter (required fields not found)');
    return errors;
  }
  for (const [key, rule] of Object.entries(schema)) {
    if (rule.required && !frontmatter?.[key]) {
      errors.push(`missing required field: ${key}`);
    } else if (frontmatter?.[key]) {
      const actual = Array.isArray(frontmatter[key]) ? 'array' : typeof frontmatter[key];
      if (actual !== rule.type) {
        errors.push(`field "${key}": expected ${rule.type}, got ${actual}`);
      }
    }
  }
  return errors;
}

// Lint markdown for style issues
function lintMarkdown(content) {
  const issues = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Trailing whitespace
    if (/\s+$/.test(line) && line.trim()) {
      issues.push(`line ${i + 1}: trailing whitespace`);
    }

    // Double blank lines
    if (i > 0 && line === '' && lines[i - 1] === '') {
      issues.push(`line ${i + 1}: double blank line`);
    }

    // Heading hierarchy (don't jump levels: # -> ### is bad, # -> ## ok)
    if (/^##+ /.test(line) && i > 0) {
      const prevHeading = lines.slice(0, i).reverse().find(l => /^#+\s/.test(l));
      if (prevHeading) {
        const prevLevel = prevHeading.match(/^#+/)[0].length;
        const currLevel = line.match(/^#+/)[0].length;
        if (currLevel > prevLevel + 1) {
          issues.push(`line ${i + 1}: heading jump from h${prevLevel} to h${currLevel}`);
        }
      }
    }
  }

  return issues;
}

function safeDecode(target) {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function extractMetadata(file, content) {
  const frontmatter = parseFrontmatter(content);
  const lines = content.split(/\r?\n/);
  const wordCount = content.split(/\s+/).length;
  const headings = lines.filter(l => /^#+\s+\S/.test(l)).length;
  const links = Array.from(content.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)).length;
  return {
    file,
    title: frontmatter?.title || null,
    description: frontmatter?.description || null,
    tags: frontmatter?.tags || [],
    author: frontmatter?.author || null,
    date: frontmatter?.date || null,
    stats: { lines: lines.length, words: wordCount, headings, links }
  };
}

function validateFile(file, registry, repoRootPath) {
  const errors = [];
  const warnings = [];
  const content = fs.readFileSync(file, 'utf8');
  const dir = path.dirname(file);
  // Illustrative [[Links]] and (paths) inside fenced code examples (common in
  // templates/lint-rules docs) aren't real references — don't scan them.
  const scanContent = content.replace(/```[\s\S]*?```/g, '');

  const frontmatter = parseFrontmatter(content);
  const fmErrors = validateFrontmatter(frontmatter, FRONTMATTER_SCHEMA);
  for (const err of fmErrors) {
    warnings.push(`frontmatter: ${err}`);
  }

  const lintIssues = lintMarkdown(content);
  for (const issue of lintIssues) {
    warnings.push(`lint: ${issue}`);
  }

  const firstLines = content.split(/\r?\n/).slice(0, 10);
  if (!firstLines.some((line) => /^#\s+\S/.test(line))) {
    warnings.push('missing top-level "# Heading"');
  }

  const aliasDisambigs = detectAliasDisambiguation(scanContent, registry);
  for (const disambig of aliasDisambigs) {
    warnings.push(`link alias ${disambig.alias} may conflict with: ${disambig.conflicts.join(', ')}`);
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

  const metadata = extractMetadata(file, content);
  return { errors, warnings, metadata };
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

  const isDiffMode = process.argv.includes('--diff');
  const argTarget = process.argv.slice(2).find(arg => arg !== '--diff' && !arg.startsWith('-'));
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

  const ignorePatterns = loadIgnorePatterns(targetDir);
  if (ignorePatterns.length > 0) {
    logInfo(`Loaded ${ignorePatterns.length} ignore pattern(s) from .cicignore/.gitignore`);
  }

  let files = walkMarkdownFiles(targetDir, ignorePatterns);

  if (isDiffMode) {
    const changedFiles = getChangedFiles(targetDir);
    if (changedFiles.size === 0) {
      logInfo('No changed files detected (--diff mode).');
      process.exit(0);
    }
    files = files.filter(f => changedFiles.has(path.relative(targetDir, f).replace(/\\/g, '/')));
    logInfo(`Diff mode: validating ${files.length} changed file(s)`);
  }

  if (!files.length) {
    logWarn('No markdown files found in target.');
    process.exit(0);
  }

  let totalErrors = 0;
  let totalWarnings = 0;
  const catalog = [];

  for (const file of files) {
    const { errors, warnings, metadata } = validateFile(file, registry, root);
    catalog.push(metadata);
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

  // Write metadata catalog
  const catalogPath = path.join(targetDir, '.catalog.json');
  fs.writeFileSync(catalogPath, JSON.stringify({ generated: new Date().toISOString(), files: catalog }, null, 2));
  logInfo(`Metadata catalog written to ${catalogPath}`);

  console.log('');
  logInfo(`Scanned ${files.length} file(s): ${totalErrors} error(s), ${totalWarnings} warning(s).`);

  process.exit(totalErrors > 0 ? 1 : 0);
}

main();
