import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectReadySignal } from '../scripts/trm-ingest-drive.mjs';

test('detectReadySignal evaluates strictly sidecar > frontmatter > filename > title', () => {
  const sidecarEntry = { filename: 'GAP-00.md', hasSidecar: true, frontmatter: { ready: false } };
  assert.equal(detectReadySignal(sidecarEntry), 'sidecar');

  const fmEntry = { filename: 'GAP-00.md', hasSidecar: false, frontmatter: { ready: true } };
  assert.equal(detectReadySignal(fmEntry), 'frontmatter');

  const fnEntry = { filename: 'GAP-00.READY.md', hasSidecar: false, frontmatter: {} };
  assert.equal(detectReadySignal(fnEntry), 'filename');

  const titleEntry = { filename: 'GAP-00 READY.gdoc', hasSidecar: false, frontmatter: {} };
  assert.equal(detectReadySignal(titleEntry), 'gdoc_title');
});
