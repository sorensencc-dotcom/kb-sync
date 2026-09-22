import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ingestDriveFindings } from '../scripts/trm-ingest-drive.mjs';

test('gdoc finding exports successfully and appends candidate evidence when doc fetcher succeeds', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trm-gdoc-export-test-'));
  const driveRoot = path.join(tmpDir, 'TRM-Research');
  const completedDir = path.join(driveRoot, '03_grok_completed');
  const rfcDir = path.join(tmpDir, 'wiki', 'research');
  fs.mkdirSync(completedDir, { recursive: true });
  fs.mkdirSync(rfcDir, { recursive: true });

  const stubFile = path.join(completedDir, 'GAP-01-findings READY.gdoc');
  fs.writeFileSync(stubFile, JSON.stringify({ doc_id: 'doc_123_abc', url: 'https://docs.google.com/document/d/doc_123_abc/edit' }));

  const mockDocContent = `---
gap_id: GAP-01
agent_origin: grok
agent_version: grok-mobile
source_type: web
verdict: CONFIRMED
verification_status: inferred
provenance_type: remote_agent_finding
not_primary_evidence: true
ready: true
---

### Findings Summary
Exported Google Doc finding successfully parsed.
`;

  // Mock doc fetcher
  const docFetcher = async (docId) => {
    if (docId === 'doc_123_abc') {
      return { ok: true, content: mockDocContent };
    }
    return { ok: false, error: 'Not found' };
  };

  const res = await ingestDriveFindings({
    driveRoot,
    rfcDir,
    debounceMs: 10,
    commit: false,
    docFetcher
  });

  assert.equal(res.ingestedCount, 1);
  assert.ok(!fs.existsSync(stubFile));
  assert.ok(fs.existsSync(path.join(driveRoot, '04_archive', 'completed')));

  const rfcPath = path.join(rfcDir, 'rfc-gap-01.md');
  assert.ok(fs.existsSync(rfcPath));
  const rfcContent = fs.readFileSync(rfcPath, 'utf8');
  assert.ok(rfcContent.includes('Exported Google Doc finding successfully parsed.'));
  assert.ok(rfcContent.includes('Verification Status**: `inferred`'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
