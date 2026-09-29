import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalizeSpanText,
  computeSpanHash,
  normalizeGapText,
  formatLineageHeader,
  parseLineageHeader,
} from '../../modules/trm/gap-normalizer.mjs';

test('canonicalizeSpanText normalizes quotes, whitespace and footnote tokens', () => {
  const raw = '“Willow  Run produced 6,792   flyaways” [^1].';
  const expected = '"Willow Run produced 6,792 flyaways" .';
  assert.equal(canonicalizeSpanText(raw), expected);
});

test('computeSpanHash is stable for canonical excerpts', () => {
  assert.equal(
    computeSpanHash('src-1', canonicalizeSpanText('“Willow Run”')),
    computeSpanHash('src-1', canonicalizeSpanText('"Willow Run"')),
  );
});

test('normalizeGapText sorts markdown table rows by column 0', () => {
  const table1 = '| Model | Count |\n|---|---|\n| B-24J | 500 |\n| B-24E | 100 |';
  const table2 = '| Model | Count |\n|---|---|\n| B-24E | 100 |\n| B-24J | 500 |';
  assert.equal(normalizeGapText(table1), normalizeGapText(table2));
});

test('lineage header round-trips metadata', () => {
  const metadata = { run_id: 'run-1', source_id: 'src-1', raw_start: 4, raw_end: 12 };
  const markdown = `${formatLineageHeader(metadata)}# Draft`;
  assert.deepEqual(parseLineageHeader(markdown), metadata);
});
