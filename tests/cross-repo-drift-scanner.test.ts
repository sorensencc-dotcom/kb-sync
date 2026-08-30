import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  validateIsoUtcTimestamp,
  resolveRepoPath,
  isDisallowedPath,
  scanRepository,
  scanCrossRepoDrift,
  CANONICAL_REPOSITORIES,
  type CrossRepoDriftReport
} from '../modules/wiki/cross-repo-drift-scanner.ts';

test('validateIsoUtcTimestamp validates valid timestamps and rejects future skew', () => {
  const now = new Date().toISOString();
  assert.equal(validateIsoUtcTimestamp(now).valid, true);

  const future = new Date(Date.now() + 600000).toISOString();
  const futureCheck = validateIsoUtcTimestamp(future, 5000);
  assert.equal(futureCheck.valid, false);
  assert.match(futureCheck.reason || '', /future-dated/);

  const invalidCheck = validateIsoUtcTimestamp('not-a-date');
  assert.equal(invalidCheck.valid, false);
});

test('resolveRepoPath selects canonical paths by default without pointing to dev-sandbox', () => {
  const kbSyncResolved = resolveRepoPath('kb-sync');
  assert.equal(kbSyncResolved.path, 'C:\\dev\\kb-sync');
  assert.equal(kbSyncResolved.isCanonical, true);
  assert.equal(kbSyncResolved.path.includes('dev-sandbox'), false);

  const trmResolved = resolveRepoPath('trm');
  assert.equal(trmResolved.path, 'C:\\dev\\trm');
  assert.equal(trmResolved.isCanonical, true);
});

test('isDisallowedPath flags dev-sandbox, worktrees, and staging directories', () => {
  assert.equal(isDisallowedPath('C:\\dev\\dev-sandbox\\kb-sync-drift-fix'), true);
  assert.equal(isDisallowedPath('C:\\dev\\.claude\\worktrees\\agent-1'), true);
  assert.equal(isDisallowedPath('C:\\dev\\_kb-sync-staging'), true);
  assert.equal(isDisallowedPath('C:\\dev\\kb-sync'), false);
  assert.equal(isDisallowedPath('C:\\dev\\trm'), false);
});

test('scanRepository blocks disallowed sandbox paths when not explicitly allowed', () => {
  const result = scanRepository('kb-sync', 'C:\\dev\\dev-sandbox\\kb-sync-drift-fix', { allowDisallowedPaths: false });
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.violations.includes('DISALLOWED_PATH_SANDBOX_OR_WORKTREE'));
});

test('scanRepository handles missing repository directory gracefully', () => {
  const result = scanRepository('non-existent-repo', 'C:\\non\\existent\\path', { allowDisallowedPaths: true });
  assert.equal(result.exists, false);
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.telemetry_source, 'UNAVAILABLE');
  assert.ok(result.violations.includes('REPOSITORY_DIRECTORY_NOT_FOUND'));
});

test('scanRepository distinguishes native telemetry from fallback git inspection', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-test-'));
  try {
    // 1. Without .drift-report.json -> FALLBACK_GIT_INSPECTION and DEGRADED
    const fallbackResult = scanRepository('test-repo', tmpDir, { allowDisallowedPaths: true });
    assert.equal(fallbackResult.telemetry_source, 'FALLBACK_GIT_INSPECTION');
    assert.equal(fallbackResult.status, 'DEGRADED');
    assert.ok(fallbackResult.violations.includes('MISSING_NATIVE_DRIFT_TELEMETRY'));

    // 2. With valid .drift-report.json -> NATIVE_DRIFT_TELEMETRY
    const reportData = {
      timestamp: new Date().toISOString(),
      status: 'DRIFT_DETECTED',
      drifted_sources: [{ file: 'src/index.ts', status: 'STALE' }],
      summary: { total_sources_checked: 10, stale_pages_count: 1 }
    };
    fs.writeFileSync(path.join(tmpDir, '.drift-report.json'), JSON.stringify(reportData));

    const nativeResult = scanRepository('test-repo', tmpDir, { allowDisallowedPaths: true });
    assert.equal(nativeResult.telemetry_source, 'NATIVE_DRIFT_TELEMETRY');
    assert.equal(nativeResult.status, 'DRIFT_DETECTED');
    assert.equal(nativeResult.stale_pages_count, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('scanCrossRepoDrift consolidates multiple repositories and calculates canonical coverage', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-test-'));
  try {
    const repo1 = path.join(tmpRoot, 'repo1');
    const repo2 = path.join(tmpRoot, 'repo2');
    fs.mkdirSync(repo1);
    fs.mkdirSync(repo2);

    fs.writeFileSync(path.join(repo1, '.drift-report.json'), JSON.stringify({
      timestamp: new Date().toISOString(),
      status: 'NO_DRIFT',
      drifted_sources: [],
      summary: { total_sources_checked: 20, stale_pages_count: 0 }
    }));

    fs.writeFileSync(path.join(repo2, '.drift-report.json'), JSON.stringify({
      timestamp: new Date().toISOString(),
      status: 'DRIFT_DETECTED',
      drifted_sources: [{ file: 'foo.ts', status: 'STALE' }],
      summary: { total_sources_checked: 15, stale_pages_count: 1 }
    }));

    const customPathMap = {
      'repo1': repo1,
      'repo2': repo2
    };

    const outputPath = path.join(tmpRoot, '.cross-repo-drift-report.json');
    const report = scanCrossRepoDrift({
      repoList: ['repo1', 'repo2'],
      customPathMap,
      allowDisallowedPaths: true,
      outputPath
    });

    assert.equal(report.summary.total_repositories, 2);
    assert.equal(report.summary.clean_repositories, 1);
    assert.equal(report.summary.drifted_repositories, 1);
    assert.equal(report.summary.total_stale_pages, 1);
    assert.equal(report.overall_status, 'DRIFT_DETECTED');
    assert.ok(fs.existsSync(outputPath));
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
