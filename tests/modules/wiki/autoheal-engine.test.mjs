import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { autohealMetadata, sweepStagingVault, rollbackAutohealRun } from '../../../modules/wiki/autoheal-engine.mjs';

test('autoheal-engine sanitizes unquoted colons in YAML title and normalizes drop/redirect statuses', async () => {
  const raw = [
    '---',
    'title: RFC: GAP-97--willow-run',
    'category: research',
    'status: redirect',
    '---',
    '# RFC: GAP-97--willow-run',
    'Body.'
  ].join('\n');

  const healed = await autohealMetadata('wiki/research/rfc.md', raw, { repoName: 'kb-sync' });
  assert.ok(healed.repairs.includes('sanitized_yaml_quotes'));
  assert.ok(healed.repairs.includes('normalized_status'));
  assert.equal(healed.frontmatter.title, 'RFC: GAP-97--willow-run');
  assert.equal(healed.frontmatter.status, 'archived');

  const dropHealed = await autohealMetadata(
    'wiki/note.md',
    '---\ntitle: Dropped\ncategory: wiki\nstatus: drop\n---\n# Dropped\nBody.',
    { repoName: 'kb-sync' }
  );
  assert.equal(dropHealed.frontmatter.status, 'archived');
});

test('autoheal-engine is idempotent, skips unchanged files incrementally, and rolls back bit-for-bit', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autoheal-engine-'));
  const wikiDir = path.join(tmpRoot, 'wiki');
  fs.mkdirSync(wikiDir, { recursive: true });

  const notePath = path.join(wikiDir, 'sample.md');
  const original = '# Sample Note\nBody with trailing spaces.   \n';
  fs.writeFileSync(notePath, original, 'utf8');

  try {
    const first = await sweepStagingVault({
      vaultRoot: tmpRoot,
      targetDir: wikiDir,
      fix: true,
      allowDirty: true,
      compileVFS: false
    });
    assert.equal(first.status, 'APPLIED');
    assert.equal(first.filesHealed, 1);

    const healed = fs.readFileSync(notePath, 'utf8');
    assert.notEqual(healed, original);
    assert.match(healed, /^---\r?\n/);

    const second = await sweepStagingVault({
      vaultRoot: tmpRoot,
      targetDir: wikiDir,
      fix: true,
      allowDirty: true,
      compileVFS: false
    });
    assert.equal(second.status, 'NO_DRIFT');
    assert.equal(second.filesHealed, 0);
    assert.equal(second.filesSkippedIncremental, 1);
    assert.equal(fs.readFileSync(notePath, 'utf8'), healed);

    const rolledBack = await rollbackAutohealRun(first.runId, tmpRoot);
    assert.equal(rolledBack.restoredCount, 1);
    assert.equal(fs.readFileSync(notePath, 'utf8'), original);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
