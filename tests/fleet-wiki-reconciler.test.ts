import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  deriveRepoWikiUrl,
  syncRepositoryWiki,
  reconcileFleetWikis,
  type FleetReconcileReport
} from '../modules/wiki/fleet-wiki-reconciler.ts';

test('deriveRepoWikiUrl constructs SSH wiki URLs for canonical names', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'url-test-'));
  try {
    const url = deriveRepoWikiUrl(tmpDir, 'kb-sync');
    assert.equal(url, 'git@github.com:sorensencc-dotcom/kb-sync.wiki.git');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('syncRepositoryWiki skips repositories without docs or wiki directory', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-repo-'));
  try {
    const result = syncRepositoryWiki('empty-repo', tmpDir, { dryRun: true });
    assert.equal(result.status, 'SKIPPED_NO_DOCS');
    assert.equal(result.filesPublished, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('reconcileFleetWikis handles non-existent paths gracefully', () => {
  const report = reconcileFleetWikis({
    repoList: ['non-existent-1', 'non-existent-2'],
    dryRun: true
  });
  assert.equal(report.summary.total_repositories, 2);
  assert.equal(report.summary.failed_count, 2);
  assert.equal(report.overall_status, 'FAILED');
});
