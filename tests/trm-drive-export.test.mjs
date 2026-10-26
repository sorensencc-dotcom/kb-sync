import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  exportGapsToDrive,
  redactContext,
  validateGapCardForExport,
  evaluateCardIntegrity,
  BANNED_MODERN_TERMS,
} from '../scripts/trm-export-gaps.mjs';

test('redactContext strips sensitive data against deny-list', () => {
  const sensitive = "Contact cmsormi@example.com or call 555-0199. Notes in C:\\private\\kroll.log.";
  const clean = redactContext(sensitive);
  assert.ok(!clean.includes('cmsormi@example.com'));
  assert.ok(!clean.includes('555-0199'));
  assert.ok(!clean.includes('C:\\private'));
  assert.ok(clean.includes('[REDACTED]'));
});

test('exportGapsToDrive writes card and reference context pack when RFC draft exists', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trm-export-test-'));
  const rfcDir = path.join(tmpDir, 'wiki', 'research');
  fs.mkdirSync(rfcDir, { recursive: true });
  const rfcFile = path.join(rfcDir, 'rfc-gap-00.md');
  fs.writeFileSync(rfcFile, '# RFC GAP-00\n\nSubstantive archival finding aid notes from Benson Ford Research Center.\n');

  const gapsMd = path.join(tmpDir, 'trm-research-gaps.md');
  fs.writeFileSync(
    gapsMd,
    `- [ ] [GAP-00-FIXTURE] **Willow Run Assembly**: Production records from 1943 corroborate the schedule. (Drafted: [RFC](${rfcFile}))\n`
  );

  const driveRoot = path.join(tmpDir, 'TRM-Research');
  const exported = await exportGapsToDrive({
    registryPath: gapsMd,
    driveRoot,
    priority: 'HIGH',
    limit: 5
  });

  assert.equal(exported.length, 1);
  assert.equal(exported[0].gap_id, 'GAP-00-FIXTURE');
  assert.ok(fs.existsSync(path.join(driveRoot, '01_actionable_gaps', 'GAP-00-FIXTURE.md')));
  assert.ok(fs.existsSync(path.join(driveRoot, '02_reference_context', 'GAP-00-FIXTURE-context-pack.md')));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('exportGapsToDrive omits context pack when no substantive RFC or source pointers exist', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trm-export-test-'));
  const gapsMd = path.join(tmpDir, 'trm-research-gaps.md');
  fs.writeFileSync(
    gapsMd,
    `- [ ] [GAP-01-FIXTURE] **Willow Run Tooling**: Assembly tooling specifications from 1942.\n`
  );

  const driveRoot = path.join(tmpDir, 'TRM-Research');
  const exported = await exportGapsToDrive({
    registryPath: gapsMd,
    driveRoot,
    priority: 'HIGH',
    limit: 5
  });

  assert.equal(exported.length, 1);
  assert.ok(fs.existsSync(path.join(driveRoot, '01_actionable_gaps', 'GAP-01-FIXTURE.md')));
  assert.ok(!fs.existsSync(path.join(driveRoot, '02_reference_context', 'GAP-01-FIXTURE-context-pack.md')));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('validateGapCardForExport enforces complete sentences and filters non-historical jargon', () => {
  const validGap = {
    gap_id: 'GAP-10',
    topic: 'Ford Executive Dynamics',
    description: 'Charles Sorensen met with Edsel Ford regarding bomber allocations.'
  };
  assert.equal(validateGapCardForExport(validGap).valid, true);

  const truncatedGap = {
    gap_id: 'GAP-11',
    topic: 'Ford Executive Dynamics',
    description: 'Charles Sorensen met with Edsel Ford regarding and trav'
  };
  assert.equal(validateGapCardForExport(truncatedGap).valid, false);
  assert.equal(validateGapCardForExport(truncatedGap).reason, 'incomplete_sentence_truncation');

  const contaminatedGap = {
    gap_id: 'GAP-12',
    topic: 'Ford Executive Dynamics',
    description: 'Verification standards under the Sigil Trust Engine.'
  };
  assert.equal(validateGapCardForExport(contaminatedGap).valid, false);
  assert.equal(validateGapCardForExport(contaminatedGap).reason, 'topic_contamination');
});

test('evaluateCardIntegrity detects contaminated cards and truncated bodies', () => {
  const contaminated = `---
gap_id: GAP-30
topic: Ford Executive Dynamics
---
## Specific Research Targets
Verification standards under the Sigil Trust Engine where signatures generated before a
`;
  const result = evaluateCardIntegrity(contaminated);
  assert.equal(result.valid, false);
  assert.equal(result.verdict, 'INVALID_CARD');
  assert.equal(result.reason, 'modern_non_historical_contamination');

  const truncated = `---
gap_id: GAP-29
topic: Frank Kulick
---
## Specific Research Targets
One of Ford's first five employees in 1903 and trav
`;
  const truncResult = evaluateCardIntegrity(truncated);
  assert.equal(truncResult.valid, false);
  assert.equal(truncResult.verdict, 'GARBAGE_GAP');
});
