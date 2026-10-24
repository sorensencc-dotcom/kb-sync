import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFinding, validateMobileInboxDrop, computeFindingId, LINK_SCRUBBER_REGEX } from '../scripts/validate-drive-findings.mjs';

test('validateFinding accepts valid findings and computes 0x1f finding_id', () => {
  const raw = `---
gap_id: "GAP-00-FIXTURE"
agent_origin: "copilot"
agent_version: "m365-copilot"
source_type: "web"
verdict: "CONFIRMED"
verification_status: "inferred"
provenance_type: "remote_agent_finding"
not_primary_evidence: true
ready: true
---

# Findings Report
Evidence text here with [1] citation.`;

  const res = validateFinding(raw);
  assert.equal(res.valid, true);
  assert.equal(res.frontmatter.gap_id, 'GAP-00-FIXTURE');
  assert.ok(res.finding_id);
  assert.equal(res.finding_id.length, 64);
});

test('computeFindingId prevents delimiter collision', () => {
  const id1 = computeFindingId('GAP-1', 'abc');
  const id2 = computeFindingId('GAP-1a', 'bc');
  assert.notEqual(id1, id2);
});

test('validateFinding rejects empty SHA-256 and invalid gap_id pattern', () => {
  const emptySha = `---
gap_id: "GAP-invalid-lower"
body_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
---`;
  const res = validateFinding(emptySha);
  assert.equal(res.valid, false);
});

test('validateFinding quarantines documents corrupted by Google Drive link scrubber', () => {
  const bracketScrubbed = `---
gap_id: "GAP-00-FIXTURE"
verdict: "CONFIRMED"
---
Link replaced by provider: [Suspicious link removed] in findings report.`;
  const res1 = validateFinding(bracketScrubbed);
  assert.equal(res1.valid, false);
  assert.equal(res1.quarantine_reason, 'link_scrubber_corruption');

  const encodedScrubbed = `---
gap_id: "GAP-00-FIXTURE"
verdict: "CONFIRMED"
---
Link replaced by provider: %5Bsuspicious link removed%5D in findings report.`;
  const res2 = validateFinding(encodedScrubbed);
  assert.equal(res2.valid, false);
  assert.equal(res2.quarantine_reason, 'link_scrubber_corruption');
});

test('validateMobileInboxDrop quarantines mobile drops corrupted by link scrubber', () => {
  const scrubbedDrop = `---
source: grok
skill: drive-it
topic: cic
status: drop
---
# Corrupted Drop
See reference: [Suspicious link removed]
`;
  const res = validateMobileInboxDrop(scrubbedDrop, '2026-10-23T000000Z__cic__corrupted.md');
  assert.equal(res.valid, false);
  assert.equal(res.quarantine_reason, 'link_scrubber_corruption');

  const encodedDrop = `---
source: grok
skill: drive-it
topic: cic
status: drop
---
# Corrupted Drop
See reference: %5Bsuspicious link removed%5D
`;
  const resEncoded = validateMobileInboxDrop(encodedDrop, '2026-10-23T000000Z__cic__corrupted.md');
  assert.equal(resEncoded.valid, false);
  assert.equal(resEncoded.quarantine_reason, 'link_scrubber_corruption');
});

