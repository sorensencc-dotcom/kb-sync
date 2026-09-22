import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFinding } from '../scripts/validate-drive-findings.mjs';

test('validates copilot, grok, and human agent findings uniformly', () => {
  const origins = ['copilot', 'grok', 'human'];
  for (const origin of origins) {
    const raw = `---\ngap_id: "GAP-00-FIXTURE"\nagent_origin: "${origin}"\nverdict: "CONFIRMED"\n---\n# Report\nText`;
    const res = validateFinding(raw);
    assert.equal(res.valid, true);
    assert.equal(res.frontmatter.agent_origin, origin);
  }
});
