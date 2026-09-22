import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { filterMatchedDocuments } from '../modules/trm/jev-filter.mjs';
import { createCircuitBreaker } from '../modules/trm/query-expander.mjs';

describe('filterMatchedDocuments', () => {
  test('no-op when TRM_JEV_FILTER is not set and options.jevFilter is not passed', async () => {
    const docs = [{ topic: 'a', content: 'x', rrf_score: 0.02 }];
    const result = await filterMatchedDocuments({ title: 't', description: 'd' }, docs);
    assert.equal(result.applied, false);
    assert.deepEqual(result.matchedDocuments, docs);
  });

  test('no-op when matchedDocuments is empty, even with flag on', async () => {
    const result = await filterMatchedDocuments(
      { title: 't', description: 'd' },
      [],
      { jevFilter: true }
    );
    assert.equal(result.applied, false);
    assert.deepEqual(result.matchedDocuments, []);
  });

  test('no-op when circuit breaker is already open, no network call made', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = async () => { fetchCalled = true; return { ok: true, json: async () => ({}) }; };

    const cb = createCircuitBreaker(1);
    cb.recordFailure();
    const docs = [{ topic: 'a', content: 'x', rrf_score: 0.02 }];

    const result = await filterMatchedDocuments(
      { title: 't', description: 'd' },
      docs,
      { jevFilter: true, circuitBreaker: cb }
    );

    globalThis.fetch = originalFetch;
    assert.equal(fetchCalled, false);
    assert.equal(result.applied, false);
    assert.deepEqual(result.matchedDocuments, docs);
  });
});
