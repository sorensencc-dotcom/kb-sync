import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultQueryNotebook,
  runNotebookSweep,
  recordQuarantine,
  loadQuarantine,
  clearQuarantine,
} from '../scripts/pipeline/cluster-sync-runner.mjs';

test('defaultQueryNotebook ignores stdin and retries once on ETIMEDOUT', () => {
  const calls = [];
  const fakeSpawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (calls.length === 1) {
      const err = new Error('spawnSync nlm ETIMEDOUT');
      err.code = 'ETIMEDOUT';
      return { status: null, stdout: '', stderr: '', error: err };
    }
    return { status: 0, stdout: '{"answer":"ok"}', stderr: '', error: null };
  };

  const res = defaultQueryNotebook('0caf6707-f8f2-4d2a-acd2-020acead55ba', 'Test question?', 90000, {
    spawnFn: fakeSpawn,
  });

  assert.equal(res.ok, true);
  assert.equal(calls.length, 2, 'Expected 1 retry after transient ETIMEDOUT');
  assert.deepEqual(calls[0].opts.stdio, ['ignore', 'pipe', 'pipe']);
});

test('defaultQueryNotebook does not retry on non-timeout failure', () => {
  let calls = 0;
  const fakeSpawn = () => {
    calls++;
    return { status: 1, stdout: '', stderr: 'auth error', error: null };
  };

  const res = defaultQueryNotebook('0caf6707-f8f2-4d2a-acd2-020acead55ba', 'Test question?', 90000, {
    spawnFn: fakeSpawn,
  });

  assert.equal(res.ok, false);
  assert.equal(calls, 1, 'Expected no retry on non-timeout exit code 1');
});

test('runNotebookSweep does not clear prior quarantine when status is INJECTION_FAILED', async (t) => {
  const testId = 'test-injection-failed-quarantine-uuid';
  recordQuarantine(testId, 'dev_triage', 'prior pack error');
  t.after(() => {
    clearQuarantine(testId);
  });

  const summary = await runNotebookSweep(
    {
      key: 'dev_triage',
      uuid: testId,
      pack_family: 'pack_dev_triage',
      has_pack: false,
    },
    {
      isDryRun: false,
      generateQuestionBattery: () => ({
        entropy: 4.1,
        source: 'unit_test',
        questions: [{ id: 'q1', text: 'Question 1' }],
      }),
      queryNotebookFn: async () => ({ ok: false, status: 1, stdout: '', stderr: 'ETIMEDOUT' }),
    }
  );

  assert.equal(summary.status, 'INJECTION_FAILED');
  assert.equal(
    Boolean(loadQuarantine().quarantined[testId]),
    true,
    'Prior quarantine must not be cleared when question injection fails'
  );
});
