/**
 * TRM TDD Test Contract: act-kbsync-spur-content-telemetry-attribution
 * Intent: Implement SPUR Content Telemetry & Licensing Attribution Generator in KB-Sync
 * Target: kb-sync
 *
 * Acceptance Criteria:
 * - Implements requirements according to specifications
 * - Validates schema-compatible session documents
 * - Tests pass with zero regressions
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SPUR_SCHEMA_VERSION,
  SpurTelemetrySession,
  validateSpurSession
} from '../modules/telemetry/spur-content-telemetry.mjs';

test('TRM Contract: act-kbsync-spur-content-telemetry-attribution - emits schema-compatible session document', () => {
  const session = new SpurTelemetrySession({
    agentId: 'kb-sync-trm',
    contentScope: 'historical-research'
  });

  session.recordRetrieved({
    contentId: 'wiki/research/rfc-gap-02.md',
    sourceRole: 'cache',
    mediaType: 'text/markdown',
    licenseRef: 'https://spdx.org/licenses/CC-BY-4.0.json'
  });

  session.recordGrounded({
    contentId: 'wiki/research/rfc-gap-02.md',
    scope: 'trm',
    cached: true
  });

  session.recordCited({
    id: 'cite-01',
    outputId: 'rfc-output-01',
    contentId: 'wiki/research/rfc-gap-02.md'
  });

  session.end();

  const doc = session.toJSON();
  assert.equal(doc.schema_version, SPUR_SCHEMA_VERSION);
  assert.equal(doc.agent_id, 'kb-sync-trm');
  assert.equal(doc.content_scope, 'historical-research');
  assert.equal(doc.events.length, 3);

  const validation = validateSpurSession(doc);
  assert.equal(validation.valid, true);
  assert.equal(validation.errors.length, 0);
});
