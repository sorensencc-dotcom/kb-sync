import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'scripts');
const PKG_PATH = path.join(REPO_ROOT, 'package.json');

test('all scheduled task wrappers in scripts/ set working directory to RepoRoot', () => {
  const files = fs.readdirSync(SCRIPTS_DIR)
    .filter((f) => f.startsWith('schedule-task-wrapper-') && f.endsWith('.ps1'));

  assert.ok(files.length >= 7, `Expected at least 7 wrappers, found ${files.length}`);

  for (const file of files) {
    const fullPath = path.join(SCRIPTS_DIR, file);
    const content = fs.readFileSync(fullPath, 'utf8');

    assert.ok(
      content.includes('Set-Location $RepoRoot'),
      `Wrapper ${file} must invoke "Set-Location $RepoRoot" to guarantee correct working directory when spawned by Task Scheduler`
    );
  }
});

test('scripts invoked by scheduled task wrappers exist in repository', () => {
  const researchAuditPath = path.join(SCRIPTS_DIR, 'schedule-task-wrapper-KB-Sync-Research-Audit.ps1');
  const researchAudit = fs.readFileSync(researchAuditPath, 'utf8');

  // Verify node --test targets exist relative to REPO_ROOT
  const nodeMatches = researchAudit.matchAll(/node\s+--test\s+([^\s|&]+)/g);
  for (const match of nodeMatches) {
    const targetFile = path.resolve(REPO_ROOT, match[1]);
    assert.ok(
      fs.existsSync(targetFile),
      `Target test file ${match[1]} in ${path.basename(researchAuditPath)} must exist at ${targetFile}`
    );
  }

  // Verify node runner script targets exist relative to REPO_ROOT
  const scriptMatches = researchAudit.matchAll(/node\s+([^\s|&]+\.mjs)/g);
  for (const match of scriptMatches) {
    const targetScript = path.resolve(REPO_ROOT, match[1]);
    assert.ok(
      fs.existsSync(targetScript),
      `Target runner script ${match[1]} in ${path.basename(researchAuditPath)} must exist at ${targetScript}`
    );
  }
});

test('npm run scripts invoked by scheduled task wrappers exist in package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  const scripts = pkg.scripts || {};

  const wrappers = [
    'schedule-task-wrapper-KB-Sync-Ops-Audit.ps1',
    'schedule-task-wrapper-KB-Sync-Research-Audit.ps1',
  ];

  for (const wrapperName of wrappers) {
    const wrapperPath = path.join(SCRIPTS_DIR, wrapperName);
    if (!fs.existsSync(wrapperPath)) continue;
    const content = fs.readFileSync(wrapperPath, 'utf8');

    const npmMatches = content.matchAll(/npm\s+run\s+([^\s|&]+)/g);
    for (const match of npmMatches) {
      const scriptName = match[1];
      assert.ok(
        scriptName in scripts,
        `npm script "${scriptName}" invoked by ${wrapperName} must be defined in package.json`
      );
    }
  }
});
