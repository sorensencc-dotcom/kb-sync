import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateFinding,
  validateMobileInboxDrop,
  computeFindingId,
  LINK_SCRUBBER_REGEX,
  inferActionType,
  validatePayload
} from '../scripts/validate-drive-findings.mjs';

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
ready: true
---
Link replaced by provider: [Suspicious link removed] in findings report.`;
  const res1 = validateFinding(bracketScrubbed);
  assert.equal(res1.valid, false);
  assert.equal(res1.quarantine_reason, 'link_scrubber_corruption');
  assert.equal(res1.frontmatter.gap_id, 'GAP-00-FIXTURE');
  assert.equal(res1.frontmatter.ready, true);

  const encodedScrubbed = `---
gap_id: "GAP-00-FIXTURE"
verdict: "CONFIRMED"
---
Link replaced by provider: %5Bsuspicious%20link%20removed%5D in findings report.`;
  const res2 = validateFinding(encodedScrubbed);
  assert.equal(res2.valid, false);
  assert.equal(res2.quarantine_reason, 'link_scrubber_corruption');

  const plusScrubbed = Buffer.from(`---
gap_id: "GAP-00-FIXTURE"
verdict: "CONFIRMED"
---
Link replaced by provider: [suspicious+link+removed] in findings report.`);
  const res3 = validateFinding(plusScrubbed);
  assert.equal(res3.valid, false);
  assert.equal(res3.quarantine_reason, 'link_scrubber_corruption');
  assert.equal(res3.frontmatter.gap_id, 'GAP-00-FIXTURE');
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
  assert.equal(res.frontmatter.topic, 'cic');

  const encodedDrop = `---
source: grok
skill: drive-it
topic: cic
status: drop
---
# Corrupted Drop
See reference: %5Bsuspicious%20link%20removed%5D
`;
  const resEncoded = validateMobileInboxDrop(encodedDrop, '2026-10-23T000000Z__cic__corrupted.md');
  assert.equal(resEncoded.valid, false);
  assert.equal(resEncoded.quarantine_reason, 'link_scrubber_corruption');
  assert.equal(resEncoded.frontmatter.topic, 'cic');
});

test('inferActionType preserves explicit action types and falls back accurately', () => {
  assert.equal(inferActionType({ action_type: 'deterministic_fix' }), 'deterministic_fix');
  assert.equal(inferActionType({ action_type: 'antigravity_triage' }), 'antigravity_triage');

  // Direction heuristic
  assert.equal(inferActionType({ direction: 'REFACTOR_OPTIMIZATION' }), 'antigravity_triage');
  assert.equal(inferActionType({ direction: 'NEW_FEATURE_SPIKE' }), 'antigravity_triage');

  // Prefix heuristic
  assert.equal(inferActionType({ intent: 'fix_broken_parser' }), 'deterministic_fix');
  assert.equal(inferActionType({ summary: 'remediate stale lock' }), 'deterministic_fix');
  assert.equal(inferActionType({ category: 'prune_dangling_worktrees' }), 'deterministic_fix');
  assert.equal(inferActionType({ intent: 'quarantine_corrupted_drops' }), 'deterministic_fix');
  assert.equal(inferActionType({ intent: 'clean_orphaned_sessions' }), 'deterministic_fix');

  // Unmapped and missing fallback to antigravity_triage
  assert.equal(inferActionType({ action_type: 'custom_unknown' }), 'antigravity_triage');
  assert.equal(inferActionType({}), 'antigravity_triage');
  assert.equal(inferActionType(null), 'antigravity_triage');
});

test('validatePayload enforces source and intent while normalizing missing action_type', () => {
  assert.throws(() => validatePayload(null), /Payload must be an object/);
  assert.throws(() => validatePayload({ intent: 'test_intent' }), /Missing source/);
  assert.throws(() => validatePayload({ source: 'mobile-gemini' }), /Missing intent/);

  const pendingGap = { type: 'pending-gap', gap_id: 'GAP-01' };
  assert.equal(validatePayload(pendingGap), true);

  const missingType = {
    source: 'mobile-gemini-gdoc',
    intent: 'act_trm_ingest_action_type_fallback'
  };
  assert.equal(validatePayload(missingType), true);
  assert.equal(missingType.action_type, 'antigravity_triage');

  const deterministicPayload = {
    source: 'mobile-gemini-gdoc',
    intent: 'fix_trm_outbox_leak'
  };
  assert.equal(validatePayload(deterministicPayload), true);
  assert.equal(deterministicPayload.action_type, 'deterministic_fix');

  const intentInferredFromTitle = {
    source: 'mobile-grok',
    title: 'Sanitize Ingress Payloads'
  };
  assert.equal(validatePayload(intentInferredFromTitle), true);
  assert.equal(intentInferredFromTitle.intent, 'sanitize_ingress_payloads');
  assert.equal(intentInferredFromTitle.action_type, 'antigravity_triage');
});

test('validateMobileInboxDrop infers action_type into frontmatter', () => {
  const dropWithFix = `---
source: grok
skill: drive-it
topic: cic
status: drop
title: "Fix Stale Lock Ingestion"
---
# Fix Body
`;
  const resFix = validateMobileInboxDrop(dropWithFix, '2026-10-23T000000Z__cic__fix.md');
  assert.equal(resFix.valid, true);
  assert.equal(resFix.frontmatter.action_type, 'deterministic_fix');

  const dropWithDefault = `---
source: grok
skill: drive-it
topic: cic
status: drop
title: "Research Willow Run Wing Spars"
---
# Research Body
`;
  const resDefault = validateMobileInboxDrop(dropWithDefault, '2026-10-23T000000Z__cic__research.md');
  assert.equal(resDefault.valid, true);
  assert.equal(resDefault.frontmatter.action_type, 'antigravity_triage');
});

