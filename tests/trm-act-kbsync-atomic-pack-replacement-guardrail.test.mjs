/**
 * TRM TDD Test Contract: act-kbsync-atomic-pack-replacement-guardrail
 * Intent: Enforce Atomic Pack Replacement Guardrails and Ban Standalone Delete Scripts in KB-Sync
 * Target: kb-sync
 *
 * Acceptance Criteria:
 * - Runtime gate in kb-sync CLI throwing hard error on unleased delete operations.
 * - Linter rule preventing raw NotebookLM delete API scripts.
 * - Unit tests simulating failed upload rollback without data loss.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import {
  createSourceDeletionLease,
  deleteNotebookSource,
  purgePackFamilyBeforeUpload,
} from '../scripts/nlm-pack-replace-gate.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mockCli = path.join(os.tmpdir(), `kb-sync-mock-nlm-cli-${process.pid}`);
if (!fs.existsSync(mockCli)) {
  fs.writeFileSync(
    mockCli,
    `#!/usr/bin/env node\n${fs.readFileSync(path.join(repoRoot, 'tests', 'mock-nlm-cli.mjs'), 'utf8')}`,
    'utf8',
  );
  fs.chmodSync(mockCli, 0o755);
}

test('runtime deletion rejects unleased source IDs', () => {
  process.env.MOCK_NLM_MODE = 'empty';
  assert.throws(
    () => deleteNotebookSource(mockCli, 'nb-guardrail', 'src-old'),
    /UNLEASED_SOURCE_DELETE/,
  );
});

test('runtime deletion accepts only a matching lease', () => {
  process.env.MOCK_NLM_MODE = 'empty';
  const lease = createSourceDeletionLease({
    notebookId: 'nb-guardrail',
    sourceIds: ['src-old'],
    reason: 'replacement',
  });
  assert.equal(deleteNotebookSource(mockCli, 'nb-guardrail', 'src-old', lease), true);
  assert.throws(
    () => deleteNotebookSource(mockCli, 'other-notebook', 'src-old', lease),
    /UNLEASED_SOURCE_DELETE/,
  );
});

test('standalone pre-upload purge is rejected', () => {
  process.env.MOCK_NLM_MODE = 'custom';
  process.env.MOCK_NLM_DATA = JSON.stringify([{ id: 'src-old', title: 'pack_guardrail.txt' }]);
  assert.throws(() => purgePackFamilyBeforeUpload({
    cli: mockCli,
    notebookId: 'nb-guardrail',
    packFile: 'pack_guardrail.txt',
    dryRun: false,
  }), /ATOMIC_REPLACEMENT_REQUIRED/);
});

test('deletion policy scanner rejects a direct deletion call in production code', () => {
  const scanner = path.join(repoRoot, 'scripts', 'notebooklm', 'scan-nlm-deletion-policy.mjs');
  const ingest = fs.readFileSync(path.join(repoRoot, 'modules', 'notebooklm', 'ingest-notebooklm.sh'), 'utf8');
  assert.equal(/nlm_source_delete\s*\(/.test(ingest), false);
  assert.doesNotThrow(() => execFileSync(process.execPath, [scanner], { cwd: repoRoot, encoding: 'utf8' }));
});
