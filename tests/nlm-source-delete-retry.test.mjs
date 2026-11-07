import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteSourceWithRetry, sourceDeleteCommands } from '../scripts/nlm-pack-replace-gate.mjs';

const ID = 'b794f755-0930-4fb8-83b6-80d7b840f9eb';
const NB = '679b8bab-2d87-42cb-a726-6dc54c83acc2';

test('nlm dialect only uses the delete form nlm 0.15 supports', () => {
  assert.deepEqual(sourceDeleteCommands(true, NB, ID), [['source', 'delete', ID, '-y']]);
  const flat = sourceDeleteCommands(true, NB, ID).flat();
  assert.ok(!flat.includes('remove'));
  assert.ok(!flat.some(arg => arg.startsWith('--id=')));
});

test('a transient delete failure succeeds on a later round', () => {
  let calls = 0;
  const run = () => {
    calls += 1;
    if (calls < 3) throw new Error('503 Service Unavailable');
  };
  assert.equal(deleteSourceWithRetry(run, sourceDeleteCommands(true, NB, ID), ID, { delayMs: 0 }), true);
  assert.equal(calls, 3);
});

test('a persistent failure reports the real delete error, not a usage message', () => {
  const run = () => {
    throw new Error('┌─ Error ─┐\n│ 403 Forbidden: source locked │\n└──────────┘');
  };
  assert.throws(
    () => deleteSourceWithRetry(run, sourceDeleteCommands(true, NB, ID), ID, { delayMs: 0 }),
    err => {
      assert.match(err.message, new RegExp(`Failed to delete NotebookLM source ${ID} after 3 attempt\\(s\\)`));
      assert.match(err.message, /\[source delete b794f755[^\]]* -y\] Error 403 Forbidden: source locked/);
      assert.doesNotMatch(err.message, /No such command|remove/);
      return true;
    },
  );
});

test('non-nlm dialect still tries each fallback and keeps every error', () => {
  const seen = [];
  const run = command => {
    seen.push(command[1]);
    throw new Error(`fail ${seen.length}`);
  };
  assert.throws(
    () => deleteSourceWithRetry(run, sourceDeleteCommands(false, NB, ID), ID, { rounds: 1, delayMs: 0 }),
    /after 3 attempt\(s\): \[source delete --notebook .*\] fail 1 \| .* fail 2 \| \[source remove .*\] fail 3/,
  );
  assert.deepEqual(seen, ['delete', 'delete', 'remove']);
});
