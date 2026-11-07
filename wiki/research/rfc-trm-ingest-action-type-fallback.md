---
title: "RFC: TRM Ingestion Action Type Inferencing and Resilient Schema Fallback"
category: "research"
topic: "rfc-trm-ingest-action-type-fallback"
gap_id: "act-trm-ingest-action-type-fallback"
status: "active"
created_at: "2026-11-06T17:30:00.000Z"
assigned_tier: "Tier 2 (Execution)"
routed_model: "claude-3-5-sonnet-20241022"
router_confidence: 0.85
author: "sorensencc-dotcom"
source: "mobile-gemini-gdoc"
tracking_issue: 144
citations:
  - "scripts/validate-drive-findings.mjs"
  - "tests/validate-drive-findings.test.mjs"
  - "scripts/trm-ingest-drive.mjs"
---

# RFC: TRM Ingestion Action Type Inferencing and Resilient Schema Fallback

## 1. Problem statement and ingress failure modes

In mobile and asynchronous out-of-band ingress pipelines (Google Drive `.gdoc` stubs, mobile drop cards, multi-agent mailboxes), action payloads frequently omit or underspecify the `action_type` field:
1. **Strict schema rejection**: Ingress implementations that assert `['deterministic_fix', 'antigravity_triage'].includes(item.action_type)` reject valid mobile drop requests when `action_type` is omitted or specified as a generic label (such as `action`, `task`, or `fix`).
2. **Loss of operational velocity**: Manual mobile notes or quick triage drops are diverted into quarantine or rejection outboxes, requiring manual re-keying.

---

## 2. Deterministic inferencing and fallback rules

To ensure fault-tolerant ingestion without sacrificing routing precision, `validatePayload` and `inferActionType` apply deterministic normalization rules:

### 2.1 Precedence order
1. **Explicit valid type**: If `action_type` is already `'deterministic_fix'` or `'antigravity_triage'`, preserve it.
2. **Direction heuristic**: If `direction` contains `REFACTOR`, `FEATURE`, `SPIKE`, or `NEW_IMPLEMENTATION`, assign `'antigravity_triage'`.
3. **Intent and keyword heuristic**: If the normalized text of `intent`, `title`, `summary`, `category`, or `topic` starts with or contains known deterministic remediation prefixes (`fix`, `remediate`, `prune`, `quarantine`, `clean`), assign `'deterministic_fix'`.
4. **Default safe fallback**: Default all other unmapped payloads to `'antigravity_triage'`.

---

## 3. Verification and test matrix

Unit tests in `tests/validate-drive-findings.test.mjs` verify:
- Graceful normalization without throwing unhandled exceptions.
- Deterministic fix routing for self-healing automations.
- Zero data loss for mobile Google Drive drops lacking explicit frontmatter typing.

---

## 4. References and linked topics
- [[Index]]
- [[trm-research-gaps]]
- [[trm-drive-transport-adapter-spec]]
- [[Log]]
