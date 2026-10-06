import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { VikingVFSMount, provisionSampleFixtures } from '../../../modules/wiki/viking-vfs-mount-v4.mjs';
import { sweepStagingVault } from '../../../modules/wiki/autoheal-sweeper-v2.mjs';

test('Viking VFS Mount v4 Production Suite', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viking-vfs-test-'));

  t.after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors on temp dir
    }
  });

  await t.test('1. Decoupled Fixture Provisioning & Dynamic Frontmatter Extraction', () => {
    provisionSampleFixtures(tmpDir);
    const vfs = new VikingVFSMount(tmpDir);
    const compileResult = vfs.compileTieredSummaries('wiki/research');

    assert.equal(compileResult.noteCount, 2);
    assert(compileResult.abstractTokens > 0);
    assert(compileResult.overviewTokens > 0);

    const abstractContent = fs.readFileSync(compileResult.abstractPath, 'utf8');
    assert(abstractContent.includes('Topics Covered: historical-revocation-verification, mobile-websocket-heartbeats'));
    assert(abstractContent.includes('Guidance for background JS interval throttling on mobile browsers'));
    assert(abstractContent.includes('Sigil protocol rules for offline historical key revocation audits'));

    const overviewContent = fs.readFileSync(compileResult.overviewPath, 'utf8');
    assert(overviewContent.includes('### Document: `viking://resources/wiki/research/mobile-websocket-heartbeats.md`'));
    assert(overviewContent.includes('### Document: `viking://resources/wiki/research/historical-revocation-verification.md`'));
  });

  await t.test('2. URI Resolution: Tier Query Parameters & Direct File Resolution', () => {
    const vfs = new VikingVFSMount(tmpDir);

    // L0 Abstract
    const l0Res = vfs.resolveVikingURI('viking://resources/wiki/research');
    assert.equal(l0Res.tier, 'l0');
    assert(l0Res.content.includes('# Viking VFS L0 Abstract'));

    // L1 Overview
    const l1Res = vfs.resolveVikingURI('viking://resources/wiki/research?tier=l1');
    assert.equal(l1Res.tier, 'l1');
    assert(l1Res.content.includes('# Viking VFS L1 Overview'));

    // L2 Direct Note
    const l2Res = vfs.resolveVikingURI('viking://resources/wiki/research/mobile-websocket-heartbeats.md');
    assert.equal(l2Res.tier, 'l2');
    assert(l2Res.content.includes('# Mobile Browser WebSocket Heartbeats'));
  });

  await t.test('3. Security: Path Traversal Attack Blocking', () => {
    const vfs = new VikingVFSMount(tmpDir);

    assert.throws(() => {
      vfs.resolveSafePath('../../etc/passwd');
    }, /\[SECURITY_ALERT\] Path traversal attempt blocked/);

    assert.throws(() => {
      vfs.resolveVikingURI('viking://resources/../../secret.txt');
    }, /\[SECURITY_ALERT\] Path traversal attempt blocked/);
  });

  await t.test('4. Autoheal Sweeper v2 VFS Compilation Pass', async () => {
    const stagingDir = path.join(tmpDir, 'staging');
    fs.mkdirSync(stagingDir, { recursive: true });
    fs.writeFileSync(path.join(stagingDir, 'test-doc.md'), '# Test Document\n\nSome text content.', 'utf8');

    const report = await sweepStagingVault({
      targetDir: stagingDir,
      vaultRoot: tmpDir,
      fix: true,
      dryRun: false,
      allowDirty: true,
      compileVFS: true
    });

    assert.equal(report.status, 'APPLIED');
    assert.equal(report.filesScanned, 1);
    assert.equal(report.filesHealed, 1);
    assert(report.vfsTiersCompiled.length > 0);
  });
});
