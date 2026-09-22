import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ingestDriveFindings } from '../scripts/trm-ingest-drive.mjs';

test('ingestDriveFindings throws and aborts commit when .git/MERGE_HEAD is present', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trm-merge-abort-test-'));
  const driveRoot = path.join(tmpDir, 'TRM-Research');
  const completedDir = path.join(driveRoot, '03_grok_completed');
  fs.mkdirSync(completedDir, { recursive: true });

  const findingFile = path.join(completedDir, 'GAP-00-FIXTURE-findings.md');
  fs.writeFileSync(findingFile, `---\ngap_id: "GAP-00-FIXTURE"\nagent_origin: "copilot"\nverdict: "CONFIRMED"\nready: true\n---\n# Findings\nEvidence`);

  // Create fake repo dir with MERGE_HEAD
  const fakeGitDir = path.join(tmpDir, '.git');
  fs.mkdirSync(fakeGitDir, { recursive: true });
  fs.writeFileSync(path.join(fakeGitDir, 'MERGE_HEAD'), 'fake-merge-head');

  const rfcFile = path.join(tmpDir, 'rfc-gap-00-fixture.md');
  fs.writeFileSync(rfcFile, '# RFC\n');
  const registryPath = path.join(tmpDir, 'trm-research-gaps.md');
  fs.writeFileSync(registryPath, '| GAP-00-FIXTURE | topic | HIGH | active |\n');
  const logPath = path.join(tmpDir, 'Log.md');
  fs.writeFileSync(logPath, '# Log\n');

  // Verify explicit MERGE_HEAD abort error is thrown
  await assert.rejects(
    async () => {
      await ingestDriveFindings({
        driveRoot,
        rfcDir: tmpDir,
        registryPath,
        logPath,
        repoRoot: tmpDir,
        debounceMs: 10,
        commit: true
      });
    },
    /^Error: Cannot commit: \.git\/MERGE_HEAD exists$/
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
