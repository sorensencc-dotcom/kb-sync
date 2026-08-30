import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  validateIsoUtcTimestamp,
  scanRepository,
  scanCrossRepoDrift,
  type CrossRepoDriftReport
} from '../modules/wiki/cross-repo-drift-scanner.ts';

test('validateIsoUtcTimestamp validates valid timestamps and rejects future skew', () => {
  const now = new Date().toISOString();
  assert.equal(validateIsoUtcTimestamp(now).valid, true);

  // Rejects future-dated timestamp (10 minutes in future)
  const future = new Date(Date.now() + 600000).toISOString();
  const futureCheck = validateIsoUtcTimestamp(future, 5000);
  assert.equal(futureCheck.valid, false);
  assert.match(futureCheck.reason || '', /future-dated/);

  // Rejects invalid string
  const invalidCheck = validateIsoUtcTimestamp('not-a-date');
  assert.equal(invalidCheck.valid, false);
});

test('scanRepository handles missing repository directory gracefully', () => {
  const result = scanRepository('non-existent-repo', 'C:\\non\\existent\\path');
  assert.equal(result.exists, false);
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.telemetry_source, 'UNAVAILABLE');
  assert.ok(result.violations.includes('REPOSITORY_DIRECTORY_NOT_FOUND'));
});

test('scanRepository parses valid drift report and detects violations', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-test-'));
  try {
    const reportData = {
      timestamp: new Date().toISOString(),
      status: 'DRIFT_DETECTED',
      drifted_sources: [{ file: 'src/index.ts', status: 'STALE' }],
      summary: { total_sources_checked: 10, stale_pages_count: 1 }
    };
    fs.writeFileSync(path.join(tmpDir, '.drift-report.json'), JSON.stringify(reportData));

    const result = scanRepository('test-repo', tmpDir);
    assert.equal(result.exists, true);
    assert.equal(result.status, 'DRIFT_DETECTED');
    assert.equal(result.telemetry_source, 'DRIFT_REPORT');
    assert.equal(result.stale_pages_count, 1);
    assert.equal(result.sources_checked, 10);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('scanRepository flags future timestamp in drift report as violation', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-skew-test-'));
  try {
    const futureReport = {
      timestamp: new Date(Date.now() + 3600000).toISOString(),
      status: 'NO_DRIFT',
      drifted_sources: [],
      summary: { total_sources_checked: 5, stale_pages_count: 0 }
    };
    fs.writeFileSync(path.join(tmpDir, '.drift-report.json'), JSON.stringify(futureReport));

    const result = scanRepository('skew-repo', tmpDir, { maxSkewMs: 1000 });
    assert.equal(result.exists, true);
    assert.ok(result.violations.some(v => v.includes('INVALID_TIMESTAMP')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('scanCrossRepoDrift consolidates multiple repositories and emits schema', () => {
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

    const outputPath = path.join(tmpRoot, '.cross-repo-drift-report.json');
    const report = scanCrossRepoDrift({
      baseDir: tmpRoot,
      repoList: ['repo1', 'repo2'],
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
