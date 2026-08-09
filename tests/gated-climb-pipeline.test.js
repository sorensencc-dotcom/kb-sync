import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runGatedClimbRepair } from '../modules/wiki/gated-climb-repair.mjs';
import { OfflineDeterministicRepairProvider } from '../modules/wiki/repair-provider.mjs';

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gated-pipeline-test-'));
}

function removeTempDir(dirPath) {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {}
}

test('runGatedClimbRepair performs self-healing repair, validation pass, and atomic promotion to staged-proposals', async (t) => {
  const tmpBaseDir = createTempDir();
  t.after(() => removeTempDir(tmpBaseDir));

  const inputDir = path.join(tmpBaseDir, 'input-vault');
  fs.mkdirSync(inputDir, { recursive: true });

  const docPath = path.join(inputDir, 'doc1.md');
  const invalidContent = `---
title: "Doc One"
category: "invalid_category"
status: "active"
---
# Doc One Content
[[kb-sync/daemons/manifest]]
`;
  fs.writeFileSync(docPath, invalidContent, 'utf8');

  const provider = new OfflineDeterministicRepairProvider({
    CATEGORY_ENUM_INVALID: { category: 'wiki' }
  });

  const res = await runGatedClimbRepair({
    targetDir: inputDir,
    provider,
    maxRetries: 3,
    runId: 'run-pass-1',
    baseDir: tmpBaseDir
  });

  assert.equal(res.passed, true, 'Result should indicate validation passed after repair');
  assert.equal(res.status, 'PASS');
  assert.equal(res.retriesUsed, 1);

  const expectedPromotedPath = path.join(tmpBaseDir, 'staged-proposals', 'run-pass-1');
  assert.equal(res.promotedPath, expectedPromotedPath);
  assert.equal(fs.existsSync(expectedPromotedPath), true, 'Promoted directory should exist');
  assert.equal(fs.existsSync(path.join(expectedPromotedPath, 'doc1.md')), true, 'Promoted doc1.md should exist');

  const repairedContent = fs.readFileSync(path.join(expectedPromotedPath, 'doc1.md'), 'utf8');
  assert.match(repairedContent, /category:\s*wiki/, 'Repaired document frontmatter category should be wiki');
  assert.match(repairedContent, /# Doc One Content/, 'Body content must remain unchanged');

  // Verify single-writer audit logging
  const auditLogPath = path.join(tmpBaseDir, 'logs', 'auto-repair-audit.jsonl');
  assert.equal(fs.existsSync(auditLogPath), true, 'Audit log file should exist');

  const logLines = fs.readFileSync(auditLogPath, 'utf8').trim().split('\n');
  assert.equal(logLines.length, 1);
  const logEntry = JSON.parse(logLines[0]);
  assert.equal(logEntry.run_id, 'run-pass-1');
  assert.equal(logEntry.status, 'PASS');
});

test('runGatedClimbRepair creates atomic quarantine bundle when retries expire', async (t) => {
  const tmpBaseDir = createTempDir();
  t.after(() => removeTempDir(tmpBaseDir));

  const inputDir = path.join(tmpBaseDir, 'input-vault');
  fs.mkdirSync(inputDir, { recursive: true });

  const docPath = path.join(inputDir, 'unfixable.md');
  const invalidContent = `---
title: "Unfixable Doc"
category: "bogus_category"
status: "active"
---
# Unfixable Content
`;
  fs.writeFileSync(docPath, invalidContent, 'utf8');

  // Provider with no matching repair rules
  const provider = new OfflineDeterministicRepairProvider({});

  const res = await runGatedClimbRepair({
    targetDir: inputDir,
    provider,
    maxRetries: 2,
    runId: 'run-quarantine-1',
    baseDir: tmpBaseDir
  });

  assert.equal(res.passed, false, 'Result should indicate failure');
  assert.equal(res.status, 'QUARANTINED');

  const expectedQuarantinePath = path.join(tmpBaseDir, '_quarantine', 'run-quarantine-1');
  assert.equal(res.quarantinePath, expectedQuarantinePath);
  assert.equal(fs.existsSync(expectedQuarantinePath), true, 'Quarantine directory should exist');

  const bundleDir = path.join(expectedQuarantinePath, 'unfixable');
  assert.equal(fs.existsSync(bundleDir), true, 'Quarantine bundle directory for unfixable should exist');

  assert.equal(fs.existsSync(path.join(bundleDir, 'original.md')), true);
  assert.equal(fs.existsSync(path.join(bundleDir, 'repaired_latest.md')), true);
  assert.equal(fs.existsSync(path.join(bundleDir, 'quarantine_manifest.json')), true);

  const manifest = JSON.parse(fs.readFileSync(path.join(bundleDir, 'quarantine_manifest.json'), 'utf8'));
  assert.equal(manifest.run_id, 'run-quarantine-1');
  assert.equal(manifest.file_slug, 'unfixable');
  assert.ok(manifest.diagnostics.length > 0, 'Manifest should list validation diagnostics');

  // Verify single-writer audit logging for quarantine
  const auditLogPath = path.join(tmpBaseDir, 'logs', 'auto-repair-audit.jsonl');
  assert.equal(fs.existsSync(auditLogPath), true);
  const logLines = fs.readFileSync(auditLogPath, 'utf8').trim().split('\n');
  const logEntry = JSON.parse(logLines[0]);
  assert.equal(logEntry.run_id, 'run-quarantine-1');
  assert.equal(logEntry.status, 'QUARANTINED');
});

test('runGatedClimbRepair creates atomic quarantine bundle when body edits are attempted (unallowed diff)', async (t) => {
  const tmpBaseDir = createTempDir();
  t.after(() => removeTempDir(tmpBaseDir));

  const inputDir = path.join(tmpBaseDir, 'input-vault');
  fs.mkdirSync(inputDir, { recursive: true });

  const docPath = path.join(inputDir, 'body-tampered.md');
  const invalidContent = `---
title: "Body Tampered Doc"
category: "invalid_category"
status: "active"
---
# Original Body Text
`;
  fs.writeFileSync(docPath, invalidContent, 'utf8');

  // Provider that attempts body modifications
  const provider = new OfflineDeterministicRepairProvider((content, diags) => {
    return `---\ntitle: "Body Tampered Doc"\ncategory: "wiki"\nstatus: "active"\n---\n# TAMPERED Body Text`;
  });

  const res = await runGatedClimbRepair({
    targetDir: inputDir,
    provider,
    maxRetries: 3,
    runId: 'run-tampered-1',
    baseDir: tmpBaseDir
  });

  assert.equal(res.passed, false);
  assert.equal(res.status, 'QUARANTINED');

  const bundleDir = path.join(tmpBaseDir, '_quarantine', 'run-tampered-1', 'body-tampered');
  assert.equal(fs.existsSync(bundleDir), true);

  const manifest = JSON.parse(fs.readFileSync(path.join(bundleDir, 'quarantine_manifest.json'), 'utf8'));
  assert.equal(manifest.run_id, 'run-tampered-1');
  assert.match(manifest.reason, /UNALLOWED_DIFF_REJECTED|Body content below frontmatter was modified/);

  const origContent = fs.readFileSync(path.join(bundleDir, 'original.md'), 'utf8');
  assert.match(origContent, /# Original Body Text/);

  const repContent = fs.readFileSync(path.join(bundleDir, 'repaired_latest.md'), 'utf8');
  assert.match(repContent, /# TAMPERED Body Text/);
});

test('runGatedClimbRepair falls back to .audit-degraded.flag on logger failure', async (t) => {
  const tmpBaseDir = createTempDir();
  t.after(() => removeTempDir(tmpBaseDir));

  const inputDir = path.join(tmpBaseDir, 'input-vault');
  fs.mkdirSync(inputDir, { recursive: true });

  const docPath = path.join(inputDir, 'valid.md');
  const validContent = `---
title: "Valid Doc"
category: "wiki"
status: "active"
---
# Valid Content
`;
  fs.writeFileSync(docPath, validContent, 'utf8');

  const provider = new OfflineDeterministicRepairProvider({});

  // Make a file at the location where logs directory would be created, causing audit log writing to fail
  const badLogDir = path.join(tmpBaseDir, 'logs');
  fs.writeFileSync(badLogDir, 'I am a file, not a directory!', 'utf8');

  const res = await runGatedClimbRepair({
    targetDir: inputDir,
    provider,
    maxRetries: 1,
    runId: 'run-degraded-1',
    baseDir: tmpBaseDir
  });

  assert.equal(res.passed, true);
  // Verify .audit-degraded.flag was created
  const flagPath = path.join(tmpBaseDir, '.audit-degraded.flag');
  const flagInPromoted = path.join(res.promotedPath, '.audit-degraded.flag');
  assert.ok(fs.existsSync(flagPath) || fs.existsSync(flagInPromoted), 'Fallback .audit-degraded.flag file should be created');
});

test('runGatedClimbRepair acquires .gated-climb.lock during repair and releases it on exit', async (t) => {
  const tmpBaseDir = createTempDir();
  t.after(() => removeTempDir(tmpBaseDir));

  const inputDir = path.join(tmpBaseDir, 'input-vault');
  fs.mkdirSync(inputDir, { recursive: true });

  const docPath = path.join(inputDir, 'valid.md');
  fs.writeFileSync(docPath, '---\ntitle: "Valid"\ncategory: "wiki"\nstatus: "active"\n---\n# Valid', 'utf8');

  const lockPath = path.join(inputDir, '.gated-climb.lock');
  assert.equal(fs.existsSync(lockPath), false);

  const res = await runGatedClimbRepair({
    targetDir: inputDir,
    maxRetries: 1,
    runId: 'run-lock-1',
    baseDir: tmpBaseDir
  });

  assert.equal(res.passed, true);
  // Lock should be released and cleaned up
  assert.equal(fs.existsSync(lockPath), false, 'Lock file should be cleaned up on completion');
});

