import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { generateLessonFromFailure } from '../modules/wiki/gated-climb-repair.mjs';

test('generateLessonFromFailure creates deterministic file and handles revisions', () => {
  const runId = 'test-run-123';
  const vaultRoot = process.cwd();
  const lessonsDir = path.join(vaultRoot, 'wiki', 'lessons');
  fs.mkdirSync(lessonsDir, { recursive: true });

  // Clean up any stale test files from prior runs
  const prefix = `unallowed-diff-${runId}-`;
  for (const file of fs.readdirSync(lessonsDir)) {
    if (file.startsWith(prefix)) {
      fs.unlinkSync(path.join(lessonsDir, file));
    }
  }

  const errorSignature = 'UNALLOWED_DIFF_REJECTED: modified unauthorized line';
  const targetPath = 'wiki/kb-sync/wiki/Test.md';
  const quarantinePath = '_quarantine/test-run-123';

  const lessonPath = generateLessonFromFailure({
    runId,
    error: errorSignature,
    targetPath,
    quarantinePath,
    vaultRoot
  });

  assert.strictEqual(fs.existsSync(lessonPath), true);
  const content = fs.readFileSync(lessonPath, 'utf8');
  assert.match(content, /category: "lessons"/);
  assert.match(content, /status: "active"/);
  assert.match(content, /tags: \[.*"failure-pattern".*"remediation".*"pipeline".*"needs-enrichment".*\]/);
  assert.match(content, /#### 1\. Context & Symptom/);
  assert.match(content, /#### 2\. Root Cause Analysis/);
  assert.match(content, /#### 3\. Resolution & Prevention/);
  assert.match(content, /#### 4\. Source Citations/);

  // Re-run with identical content -> skip write and return existing path
  const secondRunPath = generateLessonFromFailure({
    runId,
    error: errorSignature,
    targetPath,
    quarantinePath,
    vaultRoot
  });
  assert.strictEqual(secondRunPath, lessonPath);

  // Re-run with changed evidence -> create -rev2.md
  const rev2Path = generateLessonFromFailure({
    runId,
    error: 'UNALLOWED_DIFF_REJECTED: different failure reason',
    targetPath,
    quarantinePath,
    vaultRoot
  });
  assert.match(rev2Path, /-rev2\.md$/);
  assert.strictEqual(fs.existsSync(rev2Path), true);

  // Cleanup test artifacts
  if (fs.existsSync(lessonPath)) fs.unlinkSync(lessonPath);
  if (fs.existsSync(rev2Path)) fs.unlinkSync(rev2Path);
});
