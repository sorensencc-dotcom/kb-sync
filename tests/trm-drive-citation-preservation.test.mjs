import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFinding, unwrapCodeFences } from '../scripts/validate-drive-findings.mjs';

test('preserves citation formats and link anchors intact through normalization', () => {
  const content = `---
gap_id: "GAP-00-FIXTURE"
agent_origin: "copilot"
source_type: "web"
verdict: "CONFIRMED"
---

# Findings Report
1. Primary docket accession CU-0000 confirms subsidiary [1].
2. Cross-referenced with SEC records [cite: 3, 7] and [Official Archive](https://example.test/docket).
3. Footnote reference[^note1].

[^note1]: Primary determination filing 1967.`;

  const res = validateFinding(content);
  assert.equal(res.valid, true);
  assert.ok(res.body.includes('[1]'));
  assert.ok(res.body.includes('[cite: 3, 7]'));
  assert.ok(res.body.includes('[Official Archive](https://example.test/docket)'));
  assert.ok(res.body.includes('[^note1]'));
});

test('unwraps fenced code blocks with conversational preamble safely', () => {
  const wrapped = `Here are the findings for your research task:
\`\`\`markdown
---
gap_id: "GAP-00-FIXTURE"
agent_origin: "grok"
source_type: "web"
verdict: "CONFIRMED"
---
# Body
Content with [1]
\`\`\``;

  const res = validateFinding(wrapped);
  assert.equal(res.valid, true);
  assert.equal(res.frontmatter.gap_id, 'GAP-00-FIXTURE');
  assert.ok(res.body.includes('Content with [1]'));
});
