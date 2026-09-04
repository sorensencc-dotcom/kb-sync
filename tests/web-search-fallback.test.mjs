import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { searchWebFallback } from '../modules/trm/web-search-fallback.mjs';

describe('searchWebFallback', () => {
  test('returns empty array when query is empty or blank', () => {
    assert.deepEqual(searchWebFallback(''), []);
    assert.deepEqual(searchWebFallback('   '), []);
  });

  test('handles search gracefully without throwing', () => {
    const results = searchWebFallback('Willow Run B-24 Liberator production', { limit: 2, timeoutMs: 5000 });
    assert.ok(Array.isArray(results));
    if (results.length > 0) {
      assert.ok(results[0].id);
      assert.ok(results[0].topic);
      assert.ok(results[0].retrieval_mode.startsWith('web-'));
    }
  });
});
