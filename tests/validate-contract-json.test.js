import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const VALIDATOR_SCRIPT = path.resolve('modules/wiki/validate-contract.mjs');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kbsync-val-test-'));
}

function removeTempDir(dirPath) {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {}
}

function runValidatorJson(targetDir) {
  try {
    const stdout = execSync(`node "${VALIDATOR_SCRIPT}" --json "${targetDir}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return { status: 0, json: JSON.parse(stdout), stdout };
  } catch (err) {
    const stdout = err.stdout ? err.stdout.toString() : '';
    let json = null;
    try {
      json = JSON.parse(stdout);
    } catch {}
    return { status: err.status || 1, json, stdout, stderr: err.stderr ? err.stderr.toString() : '' };
  }
}

test('validate-contract --json mode outputs valid JSON on passing directory', (t) => {
  const tmpDir = createTempDir();
  t.after(() => removeTempDir(tmpDir));

  // Create a valid markdown note
  const validNotePath = path.join(tmpDir, 'valid-note.md');
  const validContent = `---
title: "Valid Note Title"
category: "wiki"
status: "active"
---
# Valid Note
[[kb-sync/daemons/manifest]]
`;
  fs.writeFileSync(validNotePath, validContent, 'utf8');

  const res = runValidatorJson(tmpDir);
  assert.equal(res.status, 0, 'Exit code should be 0');
  assert.notEqual(res.json, null, 'stdout should be valid JSON');
  assert.equal(res.json.schema_version, '1.0');
  assert.equal(res.json.validator_version, '1.1.0');
  assert.equal(res.json.exit_code, 0);
  assert.equal(res.json.scanned_count, 1);
  assert.equal(res.json.passed_count, 1);
  assert.equal(res.json.failed_count, 0);
  assert.deepEqual(res.json.warnings, []);
  assert.deepEqual(res.json.errors, []);
});

test('validate-contract --json mode reports rule_ids on failing directory', (t) => {
  const tmpDir = createTempDir();
  t.after(() => removeTempDir(tmpDir));

  // 1. Missing frontmatter schema
  fs.writeFileSync(path.join(tmpDir, 'no-fm.md'), '# No Frontmatter\n', 'utf8');

  // 2. Missing mandatory key
  fs.writeFileSync(path.join(tmpDir, 'missing-key.md'), '---\ntitle: "Missing Key"\n---\n', 'utf8');

  // 3. Category enum invalid
  fs.writeFileSync(path.join(tmpDir, 'bad-cat.md'), '---\ntitle: "Bad Cat"\ncategory: "invalid_category"\nstatus: "active"\n---\n', 'utf8');

  // 4. Status enum invalid
  fs.writeFileSync(path.join(tmpDir, 'bad-status.md'), '---\ntitle: "Bad Status"\ncategory: "wiki"\nstatus: "invalid_status"\n---\n', 'utf8');

  // 5. Doc ID collision (create subdirectories with duplicate basenames)
  const subA = path.join(tmpDir, 'subA');
  const subB = path.join(tmpDir, 'subB');
  fs.mkdirSync(subA);
  fs.mkdirSync(subB);
  fs.writeFileSync(path.join(subA, 'duplicate-name.md'), '---\ntitle: "Dup A"\ncategory: "wiki"\nstatus: "active"\n---\n', 'utf8');
  fs.writeFileSync(path.join(subB, 'duplicate-name.md'), '---\ntitle: "Dup B"\ncategory: "wiki"\nstatus: "active"\n---\n', 'utf8');

  const res = runValidatorJson(tmpDir);
  assert.equal(res.status, 1, 'Exit code should be 1');
  assert.notEqual(res.json, null, 'stdout should be valid JSON even on failure');
  assert.equal(res.json.schema_version, '1.0');
  assert.equal(res.json.validator_version, '1.1.0');
  assert.equal(res.json.exit_code, 1);
  assert.equal(res.json.scanned_count, 6);
  assert.ok(res.json.errors.length >= 5, 'Should have multiple validation errors');

  const ruleIds = res.json.errors.map(e => e.rule_id);
  assert.ok(ruleIds.includes('FRONTMATTER_SCHEMA_MISSING'), 'Should contain FRONTMATTER_SCHEMA_MISSING');
  assert.ok(ruleIds.includes('MANDATORY_KEY_MISSING'), 'Should contain MANDATORY_KEY_MISSING');
  assert.ok(ruleIds.includes('CATEGORY_ENUM_INVALID'), 'Should contain CATEGORY_ENUM_INVALID');
  assert.ok(ruleIds.includes('STATUS_ENUM_INVALID'), 'Should contain STATUS_ENUM_INVALID');
  assert.ok(ruleIds.includes('DOC_ID_COLLISION'), 'Should contain DOC_ID_COLLISION');
});
