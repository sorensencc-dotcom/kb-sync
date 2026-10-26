import test from 'node:test';
import assert from 'node:assert/strict';
import { scanDeletionPolicy } from '../scripts/notebooklm/scan-nlm-deletion-policy.mjs';

test('deletion policy rejects forbidden staged production source', () => {
  const violations = scanDeletionPolicy(
    ['modules/notebooklm/unsafe-delete.sh'],
    () => 'nlm source delete "$SOURCE_ID" -y',
  );
  assert.deepEqual(violations, ['modules/notebooklm/unsafe-delete.sh']);
});

test('deletion policy permits the canonical adapter and clean source', () => {
  assert.deepEqual(
    scanDeletionPolicy(
      ['modules/notebooklm/lib/nlm-cli.sh', 'modules/notebooklm/clean.sh'],
      file => file.endsWith('clean.sh') ? 'echo no provider deletion' : 'function nlm_sources_delete_checked() {}',
    ),
    [],
  );
});
