#!/usr/bin/env node
/**
 * flatten-manifest.mjs
 *
 * Fast Node.js file manifest generator for repository flattening.
 * Replaces slow subshell loops in bash with native Node.js filtering.
 * Completes in ~2s over 12,000+ files on Windows NTFS instead of timing out at 90s.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readConfigValue } from './config-loader.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function globToRegExp(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') re += '.*';
    else if (c === '?') re += '.';
    else if ('./+^$(){}[]|\\'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return new RegExp('^' + re + '$', 'i');
}

export function generateManifest({ repoRoot, globalConfigFile, includeExtensions, outputFile }) {
  const root = path.resolve(repoRoot || '.');

  let skipPatterns = [];
  if (globalConfigFile && fs.existsSync(globalConfigFile)) {
    const raw = readConfigValue(globalConfigFile, 'skip_patterns', true);
    if (Array.isArray(raw) && raw.length > 0) {
      skipPatterns = raw;
    }
  }

  if (skipPatterns.length === 0) {
    skipPatterns = [
      'package-lock.json',
      'yarn.lock',
      'pnpm-lock.yaml',
      '*node_modules/*',
      '*dist/*',
      '*build/*',
      '*.png',
      '*.jpg',
      '*.jpeg',
      '*.gif',
      '*.svg',
      '*.webp',
      '*.ico',
      '*.woff',
      '*.woff2',
      '*.ttf',
      '*.eot',
      '*.pdf',
      '*.bin',
      '*.zip',
      '*.tar.gz',
      '*.tgz',
      '*playwright-report/*',
      '*coverage/*',
      '*_kb-sync-staging/*',
      '*.nlm_pack*',
      '*.test_*',
      '*.ijfw/*',
    ];
  }

  const skipRegexes = skipPatterns.map(globToRegExp);

  let extList = [];
  if (includeExtensions) {
    extList = includeExtensions
      .split(/[\r\n,]+/)
      .map((e) => e.trim())
      .filter(Boolean);
  }

  let rawTracked = '';
  let rawUntracked = '';
  let rawDeleted = '';
  try {
    rawTracked = execSync('git ls-files', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (_) {}

  try {
    rawUntracked = execSync('git ls-files --others --exclude-standard', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (_) {}

  try {
    rawDeleted = execSync('git ls-files --deleted', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (_) {}

  const deletedSet = new Set(
    rawDeleted
      ? rawDeleted
          .split(/\r?\n/)
          .map((f) => f.trim().replace(/\\/g, '/'))
          .filter(Boolean)
      : [],
  );

  let candidates = Array.from(
    new Set([...rawTracked.split(/\r?\n/), ...rawUntracked.split(/\r?\n/)]),
  )
    .map((f) => f.trim().replace(/\\/g, '/'))
    .filter(Boolean);

  if (candidates.length === 0 && fs.existsSync(root)) {
    try {
      const walk = (dir, relDir = '') => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            if (entry.name === '.git' || entry.name === 'node_modules') continue;
            walk(path.join(dir, entry.name), relPath);
          } else if (entry.isFile()) {
            candidates.push(relPath);
          }
        }
      };
      walk(root);
    } catch (_) {}
  }

  const matched = [];
  for (const file of candidates) {
    if (deletedSet.has(file)) continue;

    let skipped = false;
    for (const re of skipRegexes) {
      if (re.test(file)) {
        skipped = true;
        break;
      }
    }
    if (skipped) continue;

    if (extList.length > 0) {
      const hasExt = extList.some((ext) => file.endsWith(ext));
      if (!hasExt) continue;
    }

    matched.push(file);
  }

  matched.sort();

  const outputContent = matched.length > 0 ? matched.join('\n') + '\n' : '';
  if (outputFile) {
    const outDir = path.dirname(outputFile);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outputFile, outputContent, 'utf8');
  }

  return matched;
}

// CLI Interface
const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (scriptPath && (scriptPath === path.resolve(__filename) || scriptPath.endsWith('flatten-manifest.mjs'))) {
  const args = process.argv.slice(2);
  let repoRoot = '.';
  let globalConfigFile = '';
  let includeExtensions = '';
  let outputFile = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--repo-root') {
      repoRoot = args[++i];
    } else if (args[i] === '--global-config') {
      globalConfigFile = args[++i];
    } else if (args[i] === '--include-extensions') {
      includeExtensions = args[++i];
    } else if (args[i] === '--output') {
      outputFile = args[++i];
    }
  }

  try {
    const files = generateManifest({ repoRoot, globalConfigFile, includeExtensions, outputFile });
    if (!outputFile) {
      process.stdout.write(files.join('\n') + '\n');
    }
    process.exit(0);
  } catch (err) {
    console.error(`[FLATTEN-MANIFEST] Error: ${err.message}`);
    process.exit(1);
  }
}
