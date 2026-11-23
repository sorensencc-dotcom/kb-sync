import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

for (const task of ['Ops', 'Research']) {
  test(`KB-Sync-${task} tolerates an unavailable architecture-guide refresh`, () => {
    const wrapper = fs.readFileSync(
      path.join(repoRoot, 'scripts', `schedule-task-wrapper-KB-Sync-${task}.ps1`),
      'utf8'
    );

    assert.match(wrapper, /\$ArgsList\s*\+=\s*["']--allow-stale-drive-guide["']/);
  });
}
