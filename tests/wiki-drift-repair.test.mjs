import test from 'node:test';
import assert from 'node:assert/strict';
import { runRepair } from '../scripts/wiki-drift-repair.mjs';

test('check mode only detects drift', async () => {
  const calls = [];
  const result = await runRepair({
    mode: 'check',
    run: async (command) => {
      calls.push(command);
      return { code: 0, stdout: JSON.stringify({ status: 'NO_DRIFT', summary: { stale_pages_count: 0 } }) };
    }
  });

  assert.equal(result.status, 'NO_DRIFT');
  assert.deepEqual(calls, ['detect']);
});

test('repair mode stages, synthesizes, and verifies', async () => {
  const calls = [];
  let detections = 0;
  const result = await runRepair({
    mode: 'repair',
    run: async (command) => {
      calls.push(command);
      if (command === 'detect') {
        detections += 1;
        return { code: 0, stdout: JSON.stringify(detections === 1 ? { status: 'DRIFT_DETECTED', summary: { stale_pages_count: 2 } } : { status: 'NO_DRIFT', summary: { stale_pages_count: 0 } }) };
      }
      const name = typeof command === 'string' ? command : command.name;
      return { code: 0, stdout: name === 'stage' ? 'STAGING_DIR:C:/stage/latest' : JSON.stringify({ status: 'NO_DRIFT', summary: { stale_pages_count: 0 } }) };
    }
  });

  assert.equal(result.status, 'NO_DRIFT');
  assert.deepEqual(calls, ['detect', 'stage', 'synthesize', 'detect']);
});

test('publish mode requires an explicit publish flag', async () => {
  await assert.rejects(
    () => runRepair({ mode: 'publish', run: async () => ({ code: 0, stdout: '' }) }),
    /publish requires repair mode/
  );
});
