import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAllowedDiff } from '../modules/wiki/normalized-diff-guard.mjs';
import { RepairProvider, OllamaRepairProvider, OfflineDeterministicRepairProvider } from '../modules/wiki/repair-provider.mjs';

test('validateAllowedDiff permits valid frontmatter category, status, and title updates matching diagnostics', () => {
  const original = [
    '---',
    'title: Old Title',
    'category: invalid-category',
    'status: invalid-status',
    '---',
    '',
    '# Document Body',
    'This is the immutable document body.'
  ].join('\n');

  const repaired = [
    '---',
    'title: New Valid Title',
    'category: manifest',
    'status: active',
    '---',
    '',
    '# Document Body',
    'This is the immutable document body.'
  ].join('\n');

  const diagnostics = [
    { rule_id: 'CATEGORY_ENUM_INVALID', field: 'category' },
    { rule_id: 'STATUS_ENUM_INVALID', field: 'status' },
    { rule_id: 'MANDATORY_KEY_MISSING', field: 'title' }
  ];

  const result = validateAllowedDiff(original, repaired, diagnostics);
  assert.ok(result);
  assert.equal(result.valid, true);
});

test('validateAllowedDiff rejects diff when body text below frontmatter is altered with UNALLOWED_DIFF_REJECTED', () => {
  const original = [
    '---',
    'category: daemons',
    '---',
    '',
    '# Original Body',
    'Original content.'
  ].join('\n');

  const repaired = [
    '---',
    'category: manifest',
    '---',
    '',
    '# Modified Body',
    'Original content.'
  ].join('\n');

  const diagnostics = [
    { rule_id: 'CATEGORY_ENUM_INVALID', field: 'category' }
  ];

  assert.throws(
    () => validateAllowedDiff(original, repaired, diagnostics),
    (err) => {
      assert.equal(err.code, 'UNALLOWED_DIFF_REJECTED');
      return true;
    },
    'Should throw UNALLOWED_DIFF_REJECTED when body content is altered'
  );
});

test('validateAllowedDiff rejects diff when unlisted frontmatter keys are altered with UNALLOWED_DIFF_REJECTED', () => {
  const original = [
    '---',
    'title: Test',
    'category: daemons',
    'author: Alice',
    '---',
    '',
    '# Body',
    'Unchanged body.'
  ].join('\n');

  const repaired = [
    '---',
    'title: Test',
    'category: manifest',
    'author: Bob',
    '---',
    '',
    '# Body',
    'Unchanged body.'
  ].join('\n');

  const diagnostics = [
    { rule_id: 'CATEGORY_ENUM_INVALID', field: 'category' }
  ];

  assert.throws(
    () => validateAllowedDiff(original, repaired, diagnostics),
    (err) => {
      assert.equal(err.code, 'UNALLOWED_DIFF_REJECTED');
      return true;
    },
    'Should throw UNALLOWED_DIFF_REJECTED when unlisted frontmatter key author is modified'
  );
});

test('RepairProvider base class throws error on unimplemented repair', async () => {
  const provider = new RepairProvider();
  await assert.rejects(
    async () => await provider.repair('doc', []),
    /must be implemented/i
  );
});

test('OfflineDeterministicRepairProvider patches frontmatter deterministically', async () => {
  const provider = new OfflineDeterministicRepairProvider({
    CATEGORY_ENUM_INVALID: { category: 'pipeline' }
  });

  const doc = [
    '---',
    'category: invalid',
    '---',
    '',
    '# Header',
    'Body text.'
  ].join('\n');

  const repaired = await provider.repair(doc, [{ rule_id: 'CATEGORY_ENUM_INVALID' }]);
  assert.ok(repaired.includes('category: pipeline'));
  assert.ok(repaired.includes('# Header\nBody text.'));
});

test('OllamaRepairProvider formats prompt with XML delimiters and sends POST request', async () => {
  let capturedUrl = '';
  let capturedBody = null;

  const mockFetch = async (url, options) => {
    capturedUrl = url;
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ response: 'repaired output' })
    };
  };

  const provider = new OllamaRepairProvider({
    endpoint: 'http://localhost:11434',
    model: 'llama3.1:70b',
    fetchFn: mockFetch
  });

  const result = await provider.repair('doc content', [{ rule_id: 'CATEGORY_ENUM_INVALID' }]);
  assert.equal(result, 'repaired output');
  assert.equal(capturedUrl, 'http://localhost:11434/api/generate');
  assert.equal(capturedBody.model, 'llama3.1:70b');
  assert.ok(capturedBody.prompt.includes('<DETERMINISTIC_VALIDATOR_DIAGNOSTICS>'));
  assert.ok(capturedBody.prompt.includes('<UNTRUSTED_DOCUMENT_CONTENT>'));
});
