import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { sweepStagingVault } from '../../../modules/wiki/autoheal-sweeper.mjs';

describe('Validation gate autohealing pre-pass', () => {
  it('heals dirty files in a mock staging directory before validation', async () => {
    const tmpDir = path.resolve('scratch/test-staging');
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'dirty.md'), '# Dirty Note\nSee [[LinkTarget]]');

    const report = await sweepStagingVault({
      targetDir: tmpDir,
      vaultIndex: {},
      fix: true
    });

    expect(report.filesHealed).toBe(1);
    const content = fs.readFileSync(path.join(tmpDir, 'dirty.md'), 'utf8');
    expect(content).toContain('category: wiki');
    expect(content).toContain('[[kb-sync/wiki/research/LinkTarget]]');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
