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

  test('success: attaches jev_score/jev_certainty and re-sorts by normalized blend', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.state.title, 'Gap title');
      assert.ok(body.questions.doc_0);
      assert.equal(body.questions.doc_0.type, 'score');
      return { ok: true, json: async () => ({ answers: {
        doc_0: { value: 0.9, certainty: 4 }, doc_1: { value: 0.1, certainty: 3 },
      } }) };
    };
    const docs = [
      { topic: 'low-rrf-high-relevance', content: 'x', rrf_score: 0.010 },
      { topic: 'high-rrf-low-relevance', content: 'y', rrf_score: 0.033 },
    ];
    const result = await filterMatchedDocuments(
      { title: 'Gap title', description: 'Gap description' }, docs, { jevFilter: true }
    );
    globalThis.fetch = originalFetch;
    assert.equal(result.applied, true);
    assert.equal(result.matchedDocuments.length, 2);
    assert.equal(result.matchedDocuments[0].topic, 'low-rrf-high-relevance');
    assert.equal(result.matchedDocuments[0].jev_score, 0.9);
    assert.equal(result.matchedDocuments[0].jev_certainty, 4);
    assert.equal(result.matchedDocuments[1].topic, 'high-rrf-low-relevance');
  });

  test('success: single-doc set normalizes rrf to 1.0 and still applies', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ answers: { doc_0: { value: 0.5, certainty: 2 } } }) });
    const result = await filterMatchedDocuments({ title: 't', description: 'd' }, [{ topic: 'only-doc', content: 'x', rrf_score: 0.02 }], { jevFilter: true });
    globalThis.fetch = originalFetch;
    assert.equal(result.applied, true);
    assert.equal(result.matchedDocuments[0].jev_score, 0.5);
  });

  test('fail-soft: non-2xx response leaves docs unchanged and records failure', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    const cb = createCircuitBreaker(1);
    const docs = [{ topic: 'a', content: 'x', rrf_score: 0.02 }];
    const result = await filterMatchedDocuments({ title: 't', description: 'd' }, docs, { jevFilter: true, circuitBreaker: cb });
    globalThis.fetch = originalFetch;
    assert.equal(result.applied, false);
    assert.deepEqual(result.matchedDocuments, docs);
    assert.equal(cb.isOpen(), true);
  });

  test('fail-soft: fetch throws (e.g. timeout/abort) leaves docs unchanged', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('AbortError'); };
    const docs = [{ topic: 'a', content: 'x', rrf_score: 0.02 }];
    const result = await filterMatchedDocuments({ title: 't', description: 'd' }, docs, { jevFilter: true });
    globalThis.fetch = originalFetch;
    assert.equal(result.applied, false);
    assert.deepEqual(result.matchedDocuments, docs);
  });

  test('fail-soft: malformed response body (missing answers) leaves docs unchanged', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
    const docs = [{ topic: 'a', content: 'x', rrf_score: 0.02 }];
    const result = await filterMatchedDocuments({ title: 't', description: 'd' }, docs, { jevFilter: true });
    globalThis.fetch = originalFetch;
    assert.equal(result.applied, false);
    assert.deepEqual(result.matchedDocuments, docs);
  });
});
