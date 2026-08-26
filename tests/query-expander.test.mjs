/**
 * Unit tests for modules/trm/query-expander.mjs
 * Run with: node --test kb-sync/tests/query-expander.test.mjs
 */
import { test, describe, mock, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Import under test
import {
  createCircuitBreaker,
  validateFts5Query,
  heuristicFallbackExpand,
  expandSearchQuery,
} from '../modules/trm/query-expander.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a minimal SQLite DatabaseSync stub for validation tests. */
function makeDbStub(shouldThrow = false) {
  return {
    prepare(sql) {
      return {
        all(...params) {
          if (shouldThrow) {
            throw new Error('fts5: syntax error near "BADOPERATOR"');
          }
          return [];
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// createCircuitBreaker
// ---------------------------------------------------------------------------

describe('createCircuitBreaker', () => {
  test('starts closed', () => {
    const cb = createCircuitBreaker(2);
    assert.equal(cb.isOpen(), false);
  });

  test('remains closed after fewer failures than threshold', () => {
    const cb = createCircuitBreaker(2);
    cb.recordFailure();
    assert.equal(cb.isOpen(), false);
  });

  test('trips open when failures reach threshold', () => {
    const cb = createCircuitBreaker(2);
    cb.recordFailure();
    cb.recordFailure();
    assert.equal(cb.isOpen(), true);
  });

  test('stays open after success once tripped', () => {
    const cb = createCircuitBreaker(2);
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    assert.equal(cb.isOpen(), true);
  });

  test('recordSuccess resets consecutive count while closed', () => {
    const cb = createCircuitBreaker(3);
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    cb.recordFailure(); // back to 1, should not trip at threshold 3
    assert.equal(cb.isOpen(), false);
  });
});

// ---------------------------------------------------------------------------
// validateFts5Query
// ---------------------------------------------------------------------------

describe('validateFts5Query', () => {
  test('returns true for well-formed query', () => {
    const db = makeDbStub(false);
    assert.equal(validateFts5Query(db, '"WebSocket" OR "disconnect"'), true);
  });

  test('returns false when SQLite rejects query syntax', () => {
    const db = makeDbStub(true);
    assert.equal(validateFts5Query(db, 'BADOPERATOR AND'), false);
  });

  test('returns false for empty string', () => {
    const db = makeDbStub(false);
    assert.equal(validateFts5Query(db, ''), false);
  });

  test('returns false for null input', () => {
    const db = makeDbStub(false);
    assert.equal(validateFts5Query(db, null), false);
  });

  test('returns false for whitespace-only string', () => {
    const db = makeDbStub(false);
    assert.equal(validateFts5Query(db, '   '), false);
  });
});

// ---------------------------------------------------------------------------
// heuristicFallbackExpand
// ---------------------------------------------------------------------------

describe('heuristicFallbackExpand', () => {
  test('removes English stopwords', () => {
    const result = heuristicFallbackExpand({
      title: 'the connection is dropped',
      description: 'a websocket teardown from the server',
    });
    assert.doesNotMatch(result, /\bthe\b/);
    assert.doesNotMatch(result, /\bis\b/);
    assert.doesNotMatch(result, /\ba\b/);
    assert.doesNotMatch(result, /\bfrom\b/);
  });

  test('appends wildcard * to each token', () => {
    const result = heuristicFallbackExpand({
      title: 'websocket drop',
      description: '',
    });
    assert.match(result, /"websocket"\*/);
    assert.match(result, /"drop"\*/);
  });

  test('returns a blended OR query for title + description tokens', () => {
    const result = heuristicFallbackExpand({
      title: 'connection timeout',
      description: 'heartbeat keepalive',
    });
    assert.match(result, / OR /);
  });

  test('handles empty title and description gracefully', () => {
    const result = heuristicFallbackExpand({ title: '', description: '' });
    assert.ok(typeof result === 'string' && result.length > 0);
  });

  test('handles single-word gap without crashing', () => {
    const result = heuristicFallbackExpand({ title: 'relay', description: '' });
    assert.ok(result.includes('relay'));
  });

  test('deduplicates tokens that appear in both title and description', () => {
    const result = heuristicFallbackExpand({
      title: 'reconnect',
      description: 'reconnect attempt after drop',
    });
    // "reconnect" should appear only once
    const occurrences = [...result.matchAll(/"reconnect"/g)].length;
    assert.equal(occurrences, 1);
  });
});

// ---------------------------------------------------------------------------
// expandSearchQuery — offline mode
// ---------------------------------------------------------------------------

describe('expandSearchQuery (offline)', () => {
  const db = makeDbStub(false);

  test('returns heuristic result when provider=offline', async () => {
    const gap = { title: 'relay backpressure', description: 'message queue overflow' };
    const result = await expandSearchQuery(gap, db, { provider: 'offline' });
    assert.equal(result.method, 'heuristic');
    assert.equal(result.provider, null);
    assert.ok(typeof result.query === 'string' && result.query.length > 0);
  });

  test('returns heuristic result when circuit breaker is already open', async () => {
    const gap = { title: 'ws keepalive', description: 'heartbeat interval' };
    const cb = createCircuitBreaker(1);
    cb.recordFailure(); // trip immediately
    const result = await expandSearchQuery(gap, db, { provider: 'auto', circuitBreaker: cb });
    assert.equal(result.method, 'heuristic');
    assert.equal(result.provider, null);
  });
});

// ---------------------------------------------------------------------------
// expandSearchQuery — LLM provider paths (mocked fetch)
// ---------------------------------------------------------------------------

describe('expandSearchQuery (mocked providers)', () => {
  const validFts5Query = '("WebSocket" OR "WS") AND ("disconnect" OR "drop")';
  const db = makeDbStub(false); // validateFts5Query will pass

  test('uses ollama completion when it returns valid FTS5 JSON', async () => {
    const mockCompletion = JSON.stringify({
      core_concepts: ['WebSocket'],
      synonyms: ['WS', 'disconnect'],
      fts5_query: validFts5Query,
    });

    // Mock global fetch for this test
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: mockCompletion } }],
      }),
    });

    const gap = { title: 'WS disconnect', description: 'background teardown on mobile' };
    const result = await expandSearchQuery(gap, db, { provider: 'ollama' });

    globalThis.fetch = originalFetch;

    assert.equal(result.method, 'llm');
    assert.equal(result.provider, 'ollama');
    assert.equal(result.query, validFts5Query);
  });

  test('falls back to heuristic when model returns non-JSON', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Sure! Here is your search query: WebSocket disconnect' } }],
      }),
    });

    const gap = { title: 'WS disconnect', description: 'teardown issue' };
    const result = await expandSearchQuery(gap, db, { provider: 'ollama', timeoutMs: 5000 });

    globalThis.fetch = originalFetch;

    assert.equal(result.method, 'heuristic');
    assert.equal(result.provider, null);
  });

  test('falls back to heuristic when model returns FTS5-invalid query', async () => {
    const badQuery = 'AND OR AND'; // invalid
    const mockCompletion = JSON.stringify({ fts5_query: badQuery });
    const dbThatRejects = makeDbStub(true); // always throws

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: mockCompletion } }],
      }),
    });

    const gap = { title: 'relay queue', description: 'backpressure timeout' };
    const result = await expandSearchQuery(gap, dbThatRejects, { provider: 'ollama' });

    globalThis.fetch = originalFetch;

    assert.equal(result.method, 'heuristic');
  });

  test('falls back to heuristic when fetch throws (network error)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };

    const gap = { title: 'connection reset', description: 'server close' };
    const result = await expandSearchQuery(gap, db, { provider: 'ollama' });

    globalThis.fetch = originalFetch;

    assert.equal(result.method, 'heuristic');
  });

  test('falls back to heuristic when HTTP is non-2xx', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 503 });

    const gap = { title: 'handshake failure', description: 'upgrade rejected' };
    const result = await expandSearchQuery(gap, db, { provider: 'ollama' });

    globalThis.fetch = originalFetch;

    assert.equal(result.method, 'heuristic');
  });

  test('circuit breaker trips after 2 consecutive model failures', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 500 });

    const cb = createCircuitBreaker(2);
    const gap1 = { title: 'gap one', description: 'first failure' };
    const gap2 = { title: 'gap two', description: 'second failure' };

    await expandSearchQuery(gap1, db, { provider: 'ollama', circuitBreaker: cb });
    await expandSearchQuery(gap2, db, { provider: 'ollama', circuitBreaker: cb });

    globalThis.fetch = originalFetch;

    // After 2 failures, circuit should be tripped
    assert.equal(cb.isOpen(), true);

    // Third call should short-circuit without any fetch
    let fetchCalled = false;
    globalThis.fetch = async () => { fetchCalled = true; return { ok: true }; };

    const gap3 = { title: 'gap three', description: 'bypassed' };
    const result = await expandSearchQuery(gap3, db, { provider: 'ollama', circuitBreaker: cb });

    globalThis.fetch = originalFetch;

    assert.equal(fetchCalled, false, 'fetch should not be called after circuit breaker trips');
    assert.equal(result.method, 'heuristic');
  });

  test('strips markdown fences from model output before JSON parse', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: '```json\n{"fts5_query":"' + validFts5Query.replace(/"/g, '\\"') + '"}\n```',
          },
        }],
      }),
    });

    const gap = { title: 'relay timeout', description: 'connection idle drop' };
    const result = await expandSearchQuery(gap, db, { provider: 'ollama' });

    globalThis.fetch = originalFetch;

    assert.equal(result.method, 'llm');
    assert.equal(result.query, validFts5Query);
  });
});
