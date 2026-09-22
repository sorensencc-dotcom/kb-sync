import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFinding, computeFindingId } from '../scripts/validate-drive-findings.mjs';

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
