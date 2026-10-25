import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const allowedRawDeletion = new Set();
const productionRoots = ['modules/', 'scripts/'];
const sourceFile = /\.(?:js|mjs|ts|sh)$/i;
const forbidden = /(?:\bnlm(?:\.exe)?\s+source\s+(?:delete|remove)\b|\bnlm_source_delete\s+(?=["'$]))/i;

function trackedFiles() {
  const stagedOnly = process.argv.includes('--staged');
  const args = stagedOnly ? ['diff', '--cached', '--name-only', '--diff-filter=ACM'] : ['ls-files'];
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' })
    .split(/\r?\n/)
    .map(file => file.trim().replaceAll('\\', '/'))
    .filter(file => file && sourceFile.test(file) && productionRoots.some(root => file.startsWith(root)));
}

export function scanDeletionPolicy(files, readFile) {
  const violations = [];
  for (const relativePath of files) {
    if (allowedRawDeletion.has(relativePath)) continue;
    const content = readFile(relativePath);
    if (forbidden.test(content)) violations.push(relativePath);
  }
  return violations;
}

const violations = scanDeletionPolicy(
  trackedFiles(),
  relativePath => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'),
);

if (violations.length) {
  console.error(`NotebookLM deletion policy violation in ${violations.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('NotebookLM deletion policy passed.');
}
