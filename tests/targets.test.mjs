import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNotebookId, extractFrontmatterCategory } from '../core/targets.mjs';
import { NOTEBOOK_TARGETS } from '../core/config.mjs';

test('resolveNotebookId', async (t) => {
  await t.test('returns default notebook id when category is missing', () => {
    assert.equal(resolveNotebookId(), NOTEBOOK_TARGETS['daily']);
    assert.equal(resolveNotebookId(null), NOTEBOOK_TARGETS['daily']);
    assert.equal(resolveNotebookId(''), NOTEBOOK_TARGETS['daily']);
  });

  await t.test('returns correct notebook id for known category', () => {
    assert.equal(resolveNotebookId('master-kb'), NOTEBOOK_TARGETS['master-kb']);
  });

  await t.test('handles casing and whitespace', () => {
    assert.equal(resolveNotebookId('  Master-KB '), NOTEBOOK_TARGETS['master-kb']);
  });

  await t.test('returns default notebook id for unknown category', () => {
    assert.equal(resolveNotebookId('unknown-category-123'), NOTEBOOK_TARGETS['daily']);
  });
});

test('extractFrontmatterCategory', async (t) => {
  await t.test('returns daily for empty/null content', () => {
    assert.equal(extractFrontmatterCategory(), 'daily');
    assert.equal(extractFrontmatterCategory(null), 'daily');
    assert.equal(extractFrontmatterCategory(''), 'daily');
  });

  await t.test('extracts category without quotes', () => {
    assert.equal(extractFrontmatterCategory('---\ncategory: my-category\n---'), 'my-category');
  });

  await t.test('extracts category with double quotes', () => {
    assert.equal(extractFrontmatterCategory('---\ncategory: "my-category"\n---'), 'my-category');
  });

  await t.test('extracts category with single quotes', () => {
    assert.equal(extractFrontmatterCategory("---\ncategory: 'my-category'\n---"), 'my-category');
  });

  await t.test('ignores comments', () => {
    assert.equal(extractFrontmatterCategory('---\ncategory: my-category # some comment\n---'), 'my-category');
  });

  await t.test('returns daily if category missing', () => {
    assert.equal(extractFrontmatterCategory('---\ntitle: hello\n---'), 'daily');
  });
});
