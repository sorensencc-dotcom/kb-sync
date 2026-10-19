import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveExpectedPartCount,
  findStagedPackFiles,
  checkQuarantineState,
  runQuarantineCheck,
  loadQuarantine,
  runNotebookSweep,
} from '../scripts/pipeline/cluster-sync-runner.mjs';
import { replacePackFamilyAtomic } from '../scripts/nlm-pack-replace-gate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const DAILY_NOTEBOOK = {
  key: 'daily',
  uuid: '1b4861a3-931f-4632-8fc1-343a8dd37df8',
  has_pack: true,
  pack_family: 'pack_daily',
  legacy_title_alias: 'CIC - Daily Research (Buffer/Intake) Pack',
};

test('resolveExpectedPartCount returns 21 for 21 staged part files without multipart or expected_parts', () => {
  const packFiles = Array.from({ length: 21 }, (_, idx) =>
    `pack_daily_part_${String(idx + 1).padStart(2, '0')}.txt`
  );
  assert.equal(resolveExpectedPartCount(DAILY_NOTEBOOK, packFiles), 21);
});

test('resolveExpectedPartCount returns 1 for a single non-part pack_daily.txt file', () => {
  assert.equal(resolveExpectedPartCount(DAILY_NOTEBOOK, ['pack_daily.txt']), 1);
  assert.equal(resolveExpectedPartCount(DAILY_NOTEBOOK, ['/tmp/pack_daily.txt']), 1);
});

test('resolveExpectedPartCount honors explicit numeric expected_parts override', () => {
  const packFiles = Array.from({ length: 21 }, (_, idx) =>
    `pack_daily_part_${String(idx + 1).padStart(2, '0')}.txt`
  );
  const overrideNotebook = { ...DAILY_NOTEBOOK, expected_parts: 5 };
  assert.equal(resolveExpectedPartCount(overrideNotebook, packFiles), 5);
  assert.equal(resolveExpectedPartCount(overrideNotebook, ['pack_daily.txt']), 5);
});

test('findStagedPackFiles + resolveExpectedPartCount with candidateDirs in os.tmpdir() resolves 21 parts for daily', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-sync-daily-parts-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  // Stage both unsplit pack_daily.txt and 21 part files
  fs.writeFileSync(path.join(tmpDir, 'pack_daily.txt'), 'unsplit', 'utf8');
  for (let i = 1; i <= 21; i++) {
    const name = `pack_daily_part_${String(i).padStart(2, '0')}.txt`;
    fs.writeFileSync(path.join(tmpDir, name), `part ${i}`, 'utf8');
  }

  const staged = findStagedPackFiles(DAILY_NOTEBOOK, [tmpDir]);
  assert.equal(staged.length, 21);
  assert.equal(resolveExpectedPartCount(DAILY_NOTEBOOK, staged), 21);

  // Verify runNotebookSweep passes expectedPartCount = 21 to replacePackFn
  let capturedArgs = null;
  const tmpQuarantine = path.join(tmpDir, 'quarantine.json');
  const prevEnv = process.env.NLM_QUARANTINE_FILE;
  process.env.NLM_QUARANTINE_FILE = tmpQuarantine;
  t.after(() => {
    if (prevEnv === undefined) delete process.env.NLM_QUARANTINE_FILE;
    else process.env.NLM_QUARANTINE_FILE = prevEnv;
  });

  const summary = await runNotebookSweep(DAILY_NOTEBOOK, {
    isDryRun: false,
    candidateDirs: [tmpDir],
    replacePackFn: async (args) => {
      capturedArgs = args;
      return { success: true };
    },
    generateQuestionBattery: () => ({
      questions: ['q1', 'q2'],
      entropy: 3.8,
      source: 'unit_test',
    }),
  });

  assert.equal(summary.status, 'SUCCESS');
  assert.ok(capturedArgs, 'replacePackFn should have been called');
  assert.equal(capturedArgs.expectedPartCount, 21);
  assert.equal(capturedArgs.packFiles.length, 21);
});

test('replacePackFamilyAtomic still throws MULTIPART_COUNT_MISMATCH when explicit expectedPartCount mismatches', async () => {
  const packFiles = Array.from({ length: 21 }, (_, idx) =>
    `pack_daily_part_${String(idx + 1).padStart(2, '0')}.txt`
  );
  let quarantinedError = null;

  await assert.rejects(
    async () =>
      replacePackFamilyAtomic({
        notebookId: DAILY_NOTEBOOK.uuid,
        packFiles,
        expectedPartCount: 5,
        quarantineHandler: (_id, err) => {
          quarantinedError = err;
        },
        runList: async () => [],
      }),
    /MULTIPART_COUNT_MISMATCH: Expected 5 parts, got 21/
  );
  assert.match(String(quarantinedError), /MULTIPART_COUNT_MISMATCH/);
});

test('checkQuarantineState returns ok: true for empty object and ok: false with quarantined entry for daily', () => {
  assert.deepEqual(checkQuarantineState({}), { ok: true, quarantined: [] });
  assert.deepEqual(checkQuarantineState({ quarantined: {} }), { ok: true, quarantined: [] });

  const dailyError = 'MULTIPART_COUNT_MISMATCH: Expected 1 parts, got 21';
  const withDaily = checkQuarantineState({
    quarantined: {
      [DAILY_NOTEBOOK.uuid]: {
        key: 'daily',
        error: dailyError,
        quarantinedAt: '2026-10-19T06:00:00.000Z',
      },
    },
  });

  assert.equal(withDaily.ok, false);
  assert.deepEqual(withDaily.quarantined, [
    {
      uuid: DAILY_NOTEBOOK.uuid,
      key: 'daily',
      error: dailyError,
    },
  ]);
});

test('runQuarantineCheck is read-only and never modifies the quarantine file', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-sync-qcheck-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const qFile = path.join(tmpDir, '.nlm-quarantine.json');
  const initialPayload = JSON.stringify(
    {
      quarantined: {
        [DAILY_NOTEBOOK.uuid]: {
          key: 'daily',
          error: 'MULTIPART_COUNT_MISMATCH: Expected 1 parts, got 21',
          quarantinedAt: '2026-10-19T06:00:00.000Z',
        },
      },
    },
    null,
    2
  );
  fs.writeFileSync(qFile, initialPayload, 'utf8');

  const res = runQuarantineCheck(qFile);
  assert.equal(res.ok, false);
  assert.equal(res.quarantined.length, 1);
  assert.equal(res.quarantined[0].key, 'daily');
  assert.equal(res.quarantined[0].uuid, DAILY_NOTEBOOK.uuid);
  assert.equal(fs.readFileSync(qFile, 'utf8'), initialPayload);
});

test('runNotebookSweep with isDryRun: true does not clear an existing quarantine entry', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-sync-dryrun-quarantine-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const tmpQuarantine = path.join(tmpDir, '.nlm-quarantine.json');
  const initialQuarantine = {
    quarantined: {
      [DAILY_NOTEBOOK.uuid]: {
        key: 'daily',
        error: 'MULTIPART_COUNT_MISMATCH: Expected 1 parts, got 21',
        quarantinedAt: '2026-10-19T06:00:00.000Z',
      },
    },
  };
  fs.writeFileSync(tmpQuarantine, JSON.stringify(initialQuarantine, null, 2), 'utf8');
  fs.writeFileSync(path.join(tmpDir, 'pack_daily_part_01.txt'), 'part 1', 'utf8');

  const prevEnv = process.env.NLM_QUARANTINE_FILE;
  process.env.NLM_QUARANTINE_FILE = tmpQuarantine;
  t.after(() => {
    if (prevEnv === undefined) delete process.env.NLM_QUARANTINE_FILE;
    else process.env.NLM_QUARANTINE_FILE = prevEnv;
  });

  const summary = await runNotebookSweep(DAILY_NOTEBOOK, {
    isDryRun: true,
    mode: 'catchup',
    candidateDirs: [tmpDir],
    generateQuestionBattery: () => ({
      questions: ['q1'],
      entropy: 3.5,
      source: 'unit_test',
    }),
  });

  assert.equal(summary.status, 'SUCCESS');
  const afterData = loadQuarantine(tmpQuarantine);
  const check = checkQuarantineState(afterData);
  assert.equal(check.ok, false, 'dry-run must never clear persisted quarantine entry');
  assert.equal(check.quarantined.length, 1);
  assert.equal(check.quarantined[0].uuid, DAILY_NOTEBOOK.uuid);
});

test('Research-Audit wrapper checks quarantine via --check-quarantine under Verifying zero remaining quarantined notebooks step', () => {
  const wrapperPath = path.join(REPO_ROOT, 'scripts', 'schedule-task-wrapper-KB-Sync-Research-Audit.ps1');
  const content = fs.readFileSync(wrapperPath, 'utf8');

  assert.match(content, /Verifying zero remaining quarantined notebooks\.\.\./);
  assert.match(content, /cluster-sync-runner\.mjs\s+--check-quarantine/);
  assert.match(content, /\$OverallStatus\s*=\s*1/);
});
