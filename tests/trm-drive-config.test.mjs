import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadDriveConfig } from '../scripts/trm-drive-common.mjs';

test('loadDriveConfig returns valid schema defaults when config is present', () => {
  const config = loadDriveConfig();
  assert.ok(config.drive_buffer_root);
  assert.equal(config.ingest_debounce_seconds, 15);
  assert.equal(config.lease_seconds, 14400);
  assert.deepEqual(config.ready_equivalents.precedence, ['sidecar', 'frontmatter', 'filename', 'gdoc_title']);
  assert.equal(config.drive_export.mode, 'local_first');
  assert.ok(Array.isArray(config.taxonomy.agent_origin));
});
