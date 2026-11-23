#!/usr/bin/env node
/**
 * AST Invariant Linter for kb-sync.
 * Enforces structural invariants to make repeated mistakes impossible:
 *   1. no-shell-true: Banning shell: true in child_process calls (DEP0190 & injection).
 *   2. no-unlocked-state-rmw: Banning raw writes to state files without locks.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const PROTECTED_STATE_FILES = new Set([
  '.nlm-quarantine.json',
  'quarantine.json',
  '.sync-status.json',
  'sync-status.json',
  '.nlm-sync.lock',
  'watchlist.json',
]);

const EXEMPT_STATE_FILES = new Set([
  'transaction-manager.mjs',
  'pid-lock.mjs',
  'queue.mjs',
]);

export function lintSourceFile(filePath, content) {
  const violations = [];
  const fileName = path.basename(filePath);
  const isTest = /(?:^|[\\/])tests[\\/]|\.test\.[a-z]+$/i.test(filePath);
  const isExemptStateModule = EXEMPT_STATE_FILES.has(fileName);

  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS
  );

  function walk(node) {
    if (ts.isCallExpression(node)) {
      checkChildProcessCall(node, sourceFile, filePath, violations);
      if (!isTest && !isExemptStateModule) {
        checkRawStateWrite(node, sourceFile, filePath, violations);
      }
    }
    ts.forEachChild(node, walk);
  }

  walk(sourceFile);
  return violations;
}

function checkChildProcessCall(node, sourceFile, filePath, violations) {
  const callText = node.expression.getText(sourceFile);
  const isProcessCall = /\b(?:spawn|spawnSync|exec|execFile|execFileSync|execFileAsync|spawnAsync)\b/.test(callText);
  if (!isProcessCall) return;

  for (const arg of node.arguments) {
    if (ts.isObjectLiteralExpression(arg)) {
      for (const prop of arg.properties) {
        if (ts.isPropertyAssignment(prop) && prop.name.getText(sourceFile) === 'shell') {
          const valText = prop.initializer.getText(sourceFile);
          if (valText !== 'false') {
            const { line, character } = sourceFile.getLineAndCharacterOfPosition(prop.getStart(sourceFile));
            violations.push({
              rule: 'no-shell-true',
              file: filePath,
              line: line + 1,
              col: character + 1,
              message: `[LINT_NO_SHELL_TRUE] ${filePath}:${line + 1}:${character + 1}: Avoid 'shell: true' in child_process calls. Use spawnResolvedCli or pass argv arrays directly to prevent Windows DEP0190 and command injection hazards.`,
            });
          }
        }
      }
    }
  }
}

function checkRawStateWrite(node, sourceFile, filePath, violations) {
  const callText = node.expression.getText(sourceFile);
  const isFsWrite = /\b(?:fs\.writeFileSync|fs\.writeFile|fsPromises\.writeFile|promises\.writeFile)\b/.test(callText) ||
    /^(?:writeFileSync|writeFile)$/.test(callText);
  if (!isFsWrite || node.arguments.length === 0) return;

  const firstArg = node.arguments[0];
  const argText = firstArg.getText(sourceFile);

  const matched = [];
  for (const stateName of PROTECTED_STATE_FILES) {
    if (argText.includes(stateName)) {
      matched.push(stateName);
    }
  }
  if (matched.length === 0) return;

  // Pick the most specific match (longest string) to avoid duplicate hits on substrings
  matched.sort((a, b) => b.length - a.length);
  const stateName = matched[0];

  const { line, character } = sourceFile.getLineAndCharacterOfPosition(firstArg.getStart(sourceFile));
  violations.push({
    rule: 'no-unlocked-state-rmw',
    file: filePath,
    line: line + 1,
    col: character + 1,
    message: `[LINT_NO_UNLOCKED_STATE_RMW] ${filePath}:${line + 1}:${character + 1}: Raw write to state file '${stateName}'. Use updateJsonLocked from modules/trm/storage/transaction-manager.mjs or core/pid-lock.mjs to prevent dual-process lost updates.`,
  });
}

export function lintFiles(filePaths) {
  const allViolations = [];
  for (const file of filePaths) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      const fileViolations = lintSourceFile(file, content);
      allViolations.push(...fileViolations);
    } catch (err) {
      console.error(`Error reading ${file}: ${err.message}`);
    }
  }
  return allViolations;
}

export function collectDefaultFiles(repoRoot = REPO_ROOT) {
  const files = [];
  const scanDirs = ['scripts', 'modules', 'core'];

  for (const dir of scanDirs) {
    const fullDir = path.join(repoRoot, dir);
    if (!fs.existsSync(fullDir)) continue;
    collectRecursive(fullDir, files);
  }
  return files;
}

function collectRecursive(dir, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') {
        collectRecursive(full, out);
      }
    } else if (/\.(?:mjs|ts|js|cjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename)) {
  const targetFiles = process.argv.slice(2).length > 0
    ? process.argv.slice(2).map((p) => path.resolve(p))
    : collectDefaultFiles();

  const violations = lintFiles(targetFiles);
  if (violations.length > 0) {
    console.error(`\n=== INVARIANT LINT FAILURES (${violations.length}) ===`);
    for (const v of violations) {
      console.error(v.message);
    }
    console.error('\nFix the violations above before committing.\n');
    process.exit(1);
  } else {
    console.log(`PASS: All ${targetFiles.length} files conform to repo invariants.`);
    process.exit(0);
  }
}
