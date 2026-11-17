import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWikiFrontmatter } from '../modules/wiki/frontmatter.mjs';
import { autohealMetadata } from '../modules/wiki/autoheal-engine.mjs';

test('parseWikiFrontmatter coerces unquoted numeric title to string while rejecting arrays', () => {
  const numeric = '---\ntitle: 202607152134\ncategory: wiki\nstatus: active\nsourceRepository: kb-sync\n---\nBody\n';
  const parsed = parseWikiFrontmatter(numeric);
  assert.equal(parsed.frontmatter.title, '202607152134');

  const arr = '---\ntitle: [not, a, title]\ncategory: wiki\nstatus: active\nsourceRepository: kb-sync\n---\nBody\n';
  assert.throws(() => parseWikiFrontmatter(arr), /title must be a string/);
});

test('autohealMetadata recovers rfc-gap frontmatter with \\$ escape and embedded quotes in title', async () => {
  const dollarTitle = '---\ntitle: "RFC: GAP-01 - Inaccurate Total (\\$1.2 Million vs. \\$8 Million)"\ncategory: "research"\nstatus: "draft"\nsourceRepository: kb-sync\n---\nBody\n';
  const healedDollar = await autohealMetadata('wiki/research/rfc-gap-dollar.md', dollarTitle, { index: new Map() });
  assert.ok(healedDollar.content.includes('$1.2 Million'));

  const innerQuoteTitle = '---\ntitle: "RFC: GAP-01 - **Quote: "hello" world"\ncategory: "research"\nstatus: "draft"\nsourceRepository: kb-sync\n---\nBody\n';
  const healedQuote = await autohealMetadata('wiki/research/rfc-gap-quote.md', innerQuoteTitle, { index: new Map() });
  assert.ok(healedQuote.content.includes('hello'));
});
