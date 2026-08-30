import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeMarkdownContent } from '../modules/wiki/link-sanitizer.ts';

test('sanitizeMarkdownContent replaces file:/// absolute URIs with wikilinks', () => {
  const input = 'Check the [Scanner](file:///c:/dev/kb-sync/modules/wiki/scanner.ts) for details.';
  const available = new Set(['scanner']);
  const { sanitized, findings, fixesApplied } = sanitizeMarkdownContent(input, available);

  assert.equal(fixesApplied, 1);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'LOCAL_FILESYSTEM_URI');
  assert.equal(sanitized, 'Check the [[scanner|Scanner]] for details.');
});

test('sanitizeMarkdownContent replaces plain file:/// URIs with inline code spans', () => {
  const input = 'Output is located at file:///C:/Users/soren/report.json in filesystem.';
  const available = new Set<string>();
  const { sanitized, findings, fixesApplied } = sanitizeMarkdownContent(input, available);

  assert.equal(fixesApplied, 1);
  assert.equal(sanitized, 'Output is located at `report.json` in filesystem.');
});

test('sanitizeMarkdownContent handles cross-repository relative traversal links', () => {
  const input = 'Refer to [App Config](../../apps/web/config.json) for details.';
  const available = new Set<string>();
  const { sanitized, findings, fixesApplied } = sanitizeMarkdownContent(input, available);

  assert.equal(fixesApplied, 1);
  assert.equal(findings[0].type, 'CROSS_REPO_RELATIVE');
  assert.equal(sanitized, 'Refer to `App Config (config.json)` for details.');
});

test('sanitizeMarkdownContent flags broken wikilinks when target is missing', () => {
  const input = 'Read [[NonExistentTopic]] for more info.';
  const available = new Set(['existing-topic']);
  const { findings } = sanitizeMarkdownContent(input, available);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'BROKEN_WIKILINK');
});
