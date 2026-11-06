import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  SPUR_SCHEMA_VERSION,
  SUPPORTED_EVENT_TYPES,
  validateSpurEvent,
  validateSpurSession,
  SpurTelemetrySession,
  auditSpurTelemetryDirectory
} from './spur-content-telemetry.mjs';

const MOCK_CLOCK = () => '2026-11-06T12:00:00.000Z';
let idCounter = 1;
const MOCK_ID_GEN = () => `00000000-0000-4000-8000-${String(idCounter++).padStart(12, '0')}`;

test.beforeEach(() => {
  idCounter = 1;
});

test('valid session document with retrieval and grounding events passes validation', () => {
  const session = new SpurTelemetrySession({
    clock: MOCK_CLOCK,
    idGenerator: MOCK_ID_GEN,
    agentId: 'agent-kb-sync',
    contentScope: 'wiki-research'
  });

  session.recordRetrieved({
    contentId: 'wiki/research/rfc-gap-01.md',
    sourceRole: 'cache',
    mediaType: 'text/markdown'
  });

  session.recordGrounded({
    contentId: 'wiki/research/rfc-gap-01.md',
    scope: 'historical-research',
    cached: true
  });

  session.end();

  const doc = session.toJSON();
  assert.equal(doc.schema_version, SPUR_SCHEMA_VERSION);
  assert.equal(doc.session_id, '00000000-0000-4000-8000-000000000001');
  assert.equal(doc.started_at, '2026-11-06T12:00:00.000Z');
  assert.equal(doc.ended_at, '2026-11-06T12:00:00.000Z');
  assert.equal(doc.events.length, 2);

  const res = validateSpurSession(doc);
  assert.equal(res.valid, true);
  assert.deepEqual(res.errors, []);
});

test('required-field validation fails for every supported event type when fields are missing', () => {
  // 1. content_retrieved missing source_role and data.media_type
  const invalidRetrieved = validateSpurEvent({
    type: 'content_retrieved',
    timestamp: MOCK_CLOCK(),
    content_id: 'doc-1'
  });
  assert.equal(invalidRetrieved.valid, false);
  assert.ok(invalidRetrieved.errors.some(e => e.includes('source_role')));
  assert.ok(invalidRetrieved.errors.some(e => e.includes('media_type')));

  // 2. content_grounded missing data.scope and data.cached
  const invalidGrounded = validateSpurEvent({
    type: 'content_grounded',
    timestamp: MOCK_CLOCK(),
    content_id: 'doc-2'
  });
  assert.equal(invalidGrounded.valid, false);
  assert.ok(invalidGrounded.errors.some(e => e.includes('content_grounded')));

  // 3. content_cited missing id and output_id
  const invalidCited = validateSpurEvent({
    type: 'content_cited',
    timestamp: MOCK_CLOCK(),
    content_id: 'doc-3'
  });
  assert.equal(invalidCited.valid, false);
  assert.ok(invalidCited.errors.some(e => e.includes("'id'")));
  assert.ok(invalidCited.errors.some(e => e.includes("'output_id'")));

  // 4. content_presented missing id, output_id, and presentation fields
  const invalidPresented = validateSpurEvent({
    type: 'content_presented',
    timestamp: MOCK_CLOCK(),
    content_id: 'doc-4'
  });
  assert.equal(invalidPresented.valid, false);
  assert.ok(invalidPresented.errors.some(e => e.includes('presentation_kind')));

  // 5. content_engaged missing presentation_id and engagement_type
  const invalidEngaged = validateSpurEvent({
    type: 'content_engaged',
    timestamp: MOCK_CLOCK(),
    content_id: 'doc-5'
  });
  assert.equal(invalidEngaged.valid, false);
  assert.ok(invalidEngaged.errors.some(e => e.includes('presentation_id')));
  assert.ok(invalidEngaged.errors.some(e => e.includes('engagement_type')));
});

test('rejection of fabricated or incomplete content identifiers', () => {
  const noIdentifier = validateSpurEvent({
    type: 'content_retrieved',
    timestamp: MOCK_CLOCK(),
    source_role: 'cache',
    data: { media_type: 'text/markdown' }
  });
  assert.equal(noIdentifier.valid, false);
  assert.ok(noIdentifier.errors.some(e => e.includes('content_id') || e.includes('content_url')));

  const emptyIdentifier = validateSpurEvent({
    type: 'content_retrieved',
    timestamp: MOCK_CLOCK(),
    content_id: '   ',
    content_url: '',
    source_role: 'cache',
    data: { media_type: 'text/markdown' }
  });
  assert.equal(emptyIdentifier.valid, false);
  assert.ok(emptyIdentifier.errors.some(e => e.includes('content_id') || e.includes('content_url')));
});

test('preservation of license_ref and terms_ref as opaque references without category derivation', () => {
  const session = new SpurTelemetrySession({ clock: MOCK_CLOCK, idGenerator: MOCK_ID_GEN });
  const event = session.recordRetrieved({
    contentId: 'doc-licensed-01',
    sourceRole: 'archive',
    mediaType: 'text/plain',
    licenseRef: 'https://spdx.org/licenses/CC-BY-4.0.json',
    termsRef: 'urn:custom:terms:research-only:v1'
  });

  assert.equal(event.license_ref, 'https://spdx.org/licenses/CC-BY-4.0.json');
  assert.equal(event.terms_ref, 'urn:custom:terms:research-only:v1');
  // Does NOT fabricate commercial categories
  assert.equal(event.licensing_category, undefined);

  const doc = session.toJSON();
  const validation = validateSpurSession(doc);
  assert.equal(validation.valid, true);
});

test('sidecar serialization separates telemetry from knowledge pack byte budget', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spur-telemetry-test-'));
  try {
    const session = new SpurTelemetrySession({
      clock: MOCK_CLOCK,
      idGenerator: MOCK_ID_GEN,
      outboxDir: tmpDir
    });

    for (let i = 0; i < 5; i++) {
      session.recordRetrieved({
        contentId: `doc-${i}`,
        sourceRole: 'cache',
        mediaType: 'text/markdown'
      });
      session.recordGrounded({
        contentId: `doc-${i}`,
        scope: 'trm',
        cached: true
      });
      session.recordCited({
        id: `cite-${i}`,
        outputId: 'rfc-test-01',
        contentId: `doc-${i}`
      });
    }

    const writtenPath = session.flush();
    assert.ok(fs.existsSync(writtenPath));
    assert.ok(!writtenPath.endsWith('.md') && !writtenPath.endsWith('.txt'));
    assert.ok(writtenPath.endsWith('.json'));

    const content = JSON.parse(fs.readFileSync(writtenPath, 'utf8'));
    assert.equal(content.events.length, 15);
    assert.equal(content.session_id, '00000000-0000-4000-8000-000000000001');

    // Audit validates the directory
    const audit = auditSpurTelemetryDirectory(tmpDir);
    assert.equal(audit.valid, true);
    assert.equal(audit.documentCount, 1);
    assert.equal(audit.eventCountByType.content_retrieved, 5);
    assert.equal(audit.eventCountByType.content_grounded, 5);
    assert.equal(audit.eventCountByType.content_cited, 5);
    assert.equal(audit.invalidDocuments.length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('audit fails closed on malformed session documents', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spur-telemetry-invalid-'));
  try {
    const badJsonPath = path.join(tmpDir, 'corrupt.json');
    fs.writeFileSync(badJsonPath, '{ not valid json }', 'utf8');

    const malformedSessionPath = path.join(tmpDir, 'session-bad.json');
    fs.writeFileSync(malformedSessionPath, JSON.stringify({
      schema_version: '2.0-invalid',
      session_id: 'not-a-uuid',
      started_at: 'bad-date',
      events: [{ type: 'unknown_event' }]
    }), 'utf8');

    const audit = auditSpurTelemetryDirectory(tmpDir);
    assert.equal(audit.valid, false);
    assert.equal(audit.documentCount, 2);
    assert.equal(audit.invalidDocuments.length, 2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
