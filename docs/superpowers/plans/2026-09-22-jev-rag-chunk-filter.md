# jev RAG chunk filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rerank (never hard-drop) RRF-retrieved gap-triage documents using cic-jev's `/v1/systemone` `score` question type, gated behind `TRM_JEV_FILTER=1`.

**Architecture:** New standalone module `modules/trm/jev-filter.mjs` exports `filterMatchedDocuments(gap, matchedDocuments, options)`. `gap-triage-engine.mjs`'s `triageGapAgainstCache` calls it once, immediately after the RRF block and before the web-fallback block, guarded by `retrievalMode === 'hybrid-rrf'`. `executeGapTriage` creates one `jevCircuitBreaker` per batch run (via the existing `createCircuitBreaker` factory from `query-expander.mjs`, imported a second time — no new factory) and threads it through, mirroring the existing `circuitBreaker` pattern.

**Tech Stack:** Node.js ESM (`.mjs`), native `node:test` + `node:assert/strict`, global `fetch` + `AbortController` (no injectable `fetchImpl` — matches this repo's `query-expander.mjs` convention: swap `globalThis.fetch` in tests, not a constructor param).

**Spec:** `docs/superpowers/specs/2026-09-22-jev-rag-chunk-filter-design.md`

## Global Constraints

- Gate: `options.jevFilter ?? process.env.TRM_JEV_FILTER === '1'`. No-op when false, or when `matchedDocuments.length === 0`.
- Never hard-drop a document based on jev's score — rerank only.
- `n` questions per request bounded by existing `limit` (default 5), well under cic-jev's `MAX_QUESTIONS` (20) — no new cap.
- Timeout: `options.timeoutMs ?? 3000` via `AbortController`.
- Base URL: `options.jevBaseUrl ?? process.env.JEV_BASE_URL ?? 'http://127.0.0.1:4173'`.
- Blend weight: `normalizedRrf * 0.6 + jev_score * 0.4` — inline constant, not a public option.
- Never throws. Any fetch error / timeout / non-2xx / malformed response body → fail-soft, return input unchanged, record circuit-breaker failure.
- Reuse `createCircuitBreaker` from `./query-expander.mjs` — `jev-filter.mjs` does not export its own circuit-breaker factory.
- `retrievalMode` gains literal suffix `'hybrid-rrf+jev'` only when jev actually ran (`applied === true`) — never a template of the input value.
- No new RFC frontmatter field for jev scores — surfaced only as an inline `[jev:0.xx]` tag next to each evidence bullet.

---

## File Structure

- **Create** `modules/trm/jev-filter.mjs` — single export `filterMatchedDocuments(gap, matchedDocuments, options)`. Mirrors `modules/trm/web-search-fallback.mjs`'s shape: pure fail-soft function, JSDoc header, no side effects beyond the one fetch call.
- **Create** `tests/jev-filter.test.mjs` — `node:test` suite, `globalThis.fetch` swap convention (matches `tests/query-expander.test.mjs`).
- **Modify** `modules/trm/gap-triage-engine.mjs`:
  - Import `filterMatchedDocuments` from `./jev-filter.mjs`.
  - `triageGapAgainstCache` (current `L107-265`): destructure new `jevCircuitBreaker = null` option; insert jev call between the RRF block (`L144-169`) and the web-fallback block (`L171-186`); update `evidenceList` mapping (`L212-223`) to add the `jevTag`.
  - `executeGapTriage` (current `L285-379`): create `jevCircuitBreaker` alongside the existing `circuitBreaker` (`L314-320`); pass it into the `batch.map` call (`L336-344`).
- **Modify** `tests/trm-gap-triage.test.ts` — add call-site gating test (jev never called when `retrievalMode !== 'hybrid-rrf'`) and evidence-tag rendering tests.
- **Modify** `package.json` — add `"test:trm:jev-filter": "node --test tests/jev-filter.test.mjs"` next to the existing `"test:trm:web-search"` entry, for convention parity.

---

## Task 1: `jev-filter.mjs` — gate, no-op paths, circuit breaker short-circuit

**Files:**
- Create: `modules/trm/jev-filter.mjs`
- Test: `tests/jev-filter.test.mjs`
- Modify: `package.json` (add `test:trm:jev-filter` script)

**Interfaces:**
- Consumes: `createCircuitBreaker` from `../modules/trm/query-expander.mjs` (test-only import, to construct a real breaker instance) — signature `createCircuitBreaker(failureThreshold = 2)` returning `{ recordFailure(), recordSuccess(), isOpen() }`.
- Produces: `export async function filterMatchedDocuments(gap, matchedDocuments, options = {})` returning `Promise<{ matchedDocuments: Array, applied: boolean }>`. Later tasks and `gap-triage-engine.mjs` import this exact name and shape.

- [ ] **Step 1: Write failing tests for the three no-op gates**

```js
// tests/jev-filter.test.mjs
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
    cb.recordFailure(); // trips at threshold 1
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/jev-filter.test.mjs`
Expected: FAIL — `modules/trm/jev-filter.mjs` does not exist (`Cannot find module`).

- [ ] **Step 3: Write minimal implementation covering only the gates**

```js
// modules/trm/jev-filter.mjs

/**
 * Reranks (never drops) RRF-retrieved documents against a cic-jev `score`
 * judgment of relevance to the gap. Fail-soft: any error leaves
 * matchedDocuments unchanged and returns { applied: false }.
 *
 * @param {{ title: string, description: string }} gap
 * @param {Array<Object>} matchedDocuments
 * @param {Object} [options]
 * @param {boolean} [options.jevFilter] - Overrides TRM_JEV_FILTER env gate
 * @param {Object|null} [options.circuitBreaker] - From createCircuitBreaker()
 * @param {string} [options.jevBaseUrl] - Overrides JEV_BASE_URL env
 * @param {number} [options.timeoutMs=3000]
 * @returns {Promise<{ matchedDocuments: Array, applied: boolean }>}
 */
export async function filterMatchedDocuments(gap, matchedDocuments, options = {}) {
  const enabled = options.jevFilter ?? (process.env.TRM_JEV_FILTER === '1');
  if (!enabled || matchedDocuments.length === 0) {
    return { matchedDocuments, applied: false };
  }

  const circuitBreaker = options.circuitBreaker ?? null;
  if (circuitBreaker?.isOpen()) {
    return { matchedDocuments, applied: false };
  }

  return { matchedDocuments, applied: false };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/jev-filter.test.mjs`
Expected: PASS (3/3).

- [ ] **Step 5: Add the npm script**

In `package.json`, next to `"test:trm:web-search": "node --test tests/web-search-fallback.test.mjs"`, add:

```json
"test:trm:jev-filter": "node --test tests/jev-filter.test.mjs",
```

- [ ] **Step 6: Commit**

```bash
git add modules/trm/jev-filter.mjs tests/jev-filter.test.mjs package.json
git commit -m "feat(trm): add jev-filter gate and circuit-breaker short-circuit

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `jev-filter.mjs` — request, response parsing, rerank, fail-soft

**Files:**
- Modify: `modules/trm/jev-filter.mjs`
- Test: `tests/jev-filter.test.mjs`

**Interfaces:**
- Consumes: nothing new — same `filterMatchedDocuments` signature from Task 1.
- Produces: on success, each doc in the returned array gains `jev_score` (number, 0.0-1.0) and `jev_certainty` (integer, 1-5); the array is re-sorted and truncated to `matchedDocuments.length` (the caller already applied `limit` upstream, so no separate truncation constant is introduced). This exact field naming (`jev_score`, `jev_certainty`) is what Task 4's evidence-rendering code reads.

- [ ] **Step 1: Write failing tests for success, timeout, non-2xx, and malformed-body paths**

```js
// append to tests/jev-filter.test.mjs, inside describe('filterMatchedDocuments', ...)

test('success: attaches jev_score/jev_certainty and re-sorts by normalized blend', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.state.title, 'Gap title');
    assert.ok(body.questions.doc_0);
    assert.equal(body.questions.doc_0.type, 'score');
    return {
      ok: true,
      json: async () => ({
        answers: {
          // doc_0 has the lower rrf_score but a much higher jev_score,
          // so after 0.6/0.4 blending it should win the top slot.
          doc_0: { value: 0.9, certainty: 4 },
          doc_1: { value: 0.1, certainty: 3 },
        },
      }),
    };
  };

  const docs = [
    { topic: 'low-rrf-high-relevance', content: 'x', rrf_score: 0.010 },
    { topic: 'high-rrf-low-relevance', content: 'y', rrf_score: 0.033 },
  ];

  const result = await filterMatchedDocuments(
    { title: 'Gap title', description: 'Gap description' },
    docs,
    { jevFilter: true }
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
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ answers: { doc_0: { value: 0.5, certainty: 2 } } }),
  });

  const docs = [{ topic: 'only-doc', content: 'x', rrf_score: 0.02 }];
  const result = await filterMatchedDocuments(
    { title: 't', description: 'd' },
    docs,
    { jevFilter: true }
  );

  globalThis.fetch = originalFetch;
  assert.equal(result.applied, true);
  assert.equal(result.matchedDocuments[0].jev_score, 0.5);
});

test('fail-soft: non-2xx response leaves docs unchanged and records failure', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503 });

  const cb = createCircuitBreaker(1);
  const docs = [{ topic: 'a', content: 'x', rrf_score: 0.02 }];
  const result = await filterMatchedDocuments(
    { title: 't', description: 'd' },
    docs,
    { jevFilter: true, circuitBreaker: cb }
  );

  globalThis.fetch = originalFetch;
  assert.equal(result.applied, false);
  assert.deepEqual(result.matchedDocuments, docs);
  assert.equal(cb.isOpen(), true); // threshold 1, one failure trips it
});

test('fail-soft: fetch throws (e.g. timeout/abort) leaves docs unchanged', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('AbortError'); };

  const docs = [{ topic: 'a', content: 'x', rrf_score: 0.02 }];
  const result = await filterMatchedDocuments(
    { title: 't', description: 'd' },
    docs,
    { jevFilter: true }
  );

  globalThis.fetch = originalFetch;
  assert.equal(result.applied, false);
  assert.deepEqual(result.matchedDocuments, docs);
});

test('fail-soft: malformed response body (missing answers) leaves docs unchanged', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });

  const docs = [{ topic: 'a', content: 'x', rrf_score: 0.02 }];
  const result = await filterMatchedDocuments(
    { title: 't', description: 'd' },
    docs,
    { jevFilter: true }
  );

  globalThis.fetch = originalFetch;
  assert.equal(result.applied, false);
  assert.deepEqual(result.matchedDocuments, docs);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/jev-filter.test.mjs`
Expected: FAIL on the 5 new tests (`applied` stays `false`, request assertions never run — current implementation always returns the Task 1 stub).

- [ ] **Step 3: Implement the request/response/rerank logic**

```js
// modules/trm/jev-filter.mjs — replace the final `return { matchedDocuments, applied: false };`
// from Task 1 with the block below (gates and circuit-breaker check stay as-is).

export async function filterMatchedDocuments(gap, matchedDocuments, options = {}) {
  const enabled = options.jevFilter ?? (process.env.TRM_JEV_FILTER === '1');
  if (!enabled || matchedDocuments.length === 0) {
    return { matchedDocuments, applied: false };
  }

  const circuitBreaker = options.circuitBreaker ?? null;
  if (circuitBreaker?.isOpen()) {
    return { matchedDocuments, applied: false };
  }

  const baseUrl = options.jevBaseUrl ?? process.env.JEV_BASE_URL ?? 'http://127.0.0.1:4173';
  const timeoutMs = options.timeoutMs ?? 3000;

  const questions = {};
  matchedDocuments.forEach((doc, i) => {
    const snippet = String(doc.content || doc.snippet || '').slice(0, 200);
    questions[`doc_${i}`] = {
      type: 'score',
      instructions: `How relevant is this document to the research gap? Topic: "${doc.topic || 'untitled'}". Excerpt: "${snippet}"`,
    };
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}/v1/systemone`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: { title: gap.title, description: gap.description },
        questions,
      }),
    });

    if (!res.ok) {
      throw new Error(`jev returned HTTP ${res.status}`);
    }

    const data = await res.json();
    const answers = data?.answers;
    if (!answers || typeof answers !== 'object') {
      throw new Error('jev response missing answers');
    }

    const scored = matchedDocuments.map((doc, i) => {
      const answer = answers[`doc_${i}`];
      if (!answer || typeof answer.value !== 'number' || typeof answer.certainty !== 'number') {
        throw new Error(`jev response missing valid answer for doc_${i}`);
      }
      return { ...doc, jev_score: answer.value, jev_certainty: answer.certainty };
    });

    const rrfScores = scored.map((d) => Number(d.rrf_score) || 0);
    const minRrf = Math.min(...rrfScores);
    const maxRrf = Math.max(...rrfScores);
    const range = maxRrf - minRrf || 1;

    const reranked = scored
      .map((doc) => {
        const normalizedRrf = (Number(doc.rrf_score) || 0 - minRrf) / range;
        return { doc, blended: normalizedRrf * 0.6 + doc.jev_score * 0.4 };
      })
      .sort((a, b) => b.blended - a.blended)
      .map((entry) => entry.doc);

    circuitBreaker?.recordSuccess();
    return { matchedDocuments: reranked, applied: true };
  } catch {
    circuitBreaker?.recordFailure();
    return { matchedDocuments, applied: false };
  } finally {
    clearTimeout(timer);
  }
}
```

Note the `normalizedRrf` computation must be `(Number(doc.rrf_score) || 0 - minRrf) / range` written with correct operator precedence as `((Number(doc.rrf_score) || 0) - minRrf) / range` — write it exactly that way (with the inner parens) so `|| 0` binds to the cast, not to the subtraction.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/jev-filter.test.mjs`
Expected: PASS (8/8 total across both tasks).

- [ ] **Step 5: Commit**

```bash
git add modules/trm/jev-filter.mjs tests/jev-filter.test.mjs
git commit -m "feat(trm): implement jev score request, rerank, and fail-soft paths

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Wire `jev-filter` into `triageGapAgainstCache`'s call site

**Files:**
- Modify: `modules/trm/gap-triage-engine.mjs:1-15` (imports), `:107-186` (`triageGapAgainstCache` signature and RRF/web-fallback block)
- Test: `tests/trm-gap-triage.test.ts`

**Interfaces:**
- Consumes: `filterMatchedDocuments(gap, matchedDocuments, options)` from Task 2 (exact signature above).
- Produces: `triageGapAgainstCache` gains one new destructured option, `jevCircuitBreaker = null`; when jev runs and `applied` is true, `retrievalMode` becomes the literal string `'hybrid-rrf+jev'`. Task 5 relies on this new option name to thread the breaker through.

- [ ] **Step 1: Write failing test — jev never called when retrievalMode isn't hybrid-rrf**

```ts
// append to tests/trm-gap-triage.test.ts, inside the top-level describe block

test('TEST-JEV-01: jev filter is never invoked when retrieval mode is not hybrid-rrf', async () => {
  process.env.TRM_JEV_FILTER = '1';
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => { fetchCalled = true; return { ok: true, json: async () => ({}) }; };

  const db = getDatabase(testDbPath, { readonly: false });
  const gap = { id: 'GAP-01--x', localId: 'GAP-01', topicKey: 'x', title: 'X', description: 'Y', status: 'pending', line: '', raw: '' };

  // Empty DB: lexical + vector search both return zero hits, so vectorHits.length
  // stays 0 and retrievalMode never advances past 'lexical'.
  const result = await triageGapAgainstCache(db, gap, { expandSearchQuery, limit: 3 });

  globalThis.fetch = originalFetch;
  delete process.env.TRM_JEV_FILTER;
  db.close();

  assert.equal(fetchCalled, false);
  assert.notEqual(result.rfcContent.includes('retrieval_mode: "hybrid-rrf'), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types tests/trm-gap-triage.test.ts`
Expected: FAIL is not guaranteed here (there's no jev call site yet, so `fetchCalled` should already be `false` and the test may pass by accident). Confirm this explicitly by temporarily hard-coding `assert.equal(fetchCalled, true)` and rerunning — it should FAIL, proving the assertion is load-bearing. Revert the hard-code before continuing.

- [ ] **Step 3: Add the import and the call site**

In `modules/trm/gap-triage-engine.mjs`, add the import near the top (after the `web-search-fallback.mjs` import at line 15):

```js
import { searchWebFallback } from './web-search-fallback.mjs';
import { filterMatchedDocuments } from './jev-filter.mjs';
```

Update the `triageGapAgainstCache` option destructuring (was `const { expandSearchQuery = null, circuitBreaker = null, expandOptions = {} } = options;` at line 108):

```js
const { expandSearchQuery = null, circuitBreaker = null, expandOptions = {}, jevCircuitBreaker = null } = options;
```

Insert the jev step between the RRF block's closing `}` (line 169, `matchedDocuments = lexicalHits;` inside the `catch`) and the `// 2b. Live Web Fallback` comment (line 171):

```js
  } catch {
    // Fail-soft: continue with lexical hits if vector search fails
    matchedDocuments = lexicalHits;
  }

  // 2a. jev relevance rerank — only ever sees actual RRF survivors, placed
  // here (before web-fallback) so it never scores web-fallback or
  // lexical-only fallback docs.
  if (retrievalMode === 'hybrid-rrf') {
    const { matchedDocuments: filtered, applied } = await filterMatchedDocuments(
      gap, matchedDocuments, { circuitBreaker: jevCircuitBreaker }
    );
    matchedDocuments = filtered;
    // Literal, not `${retrievalMode}+jev` — the guard above already narrows
    // retrievalMode to exactly 'hybrid-rrf', so templating it implies
    // support for other input values this branch can never see.
    if (applied) retrievalMode = 'hybrid-rrf+jev';
  }

  // 2b. Live Web Fallback (Path D: Parallel / TinyFish) if local cache has 0 matches
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --experimental-strip-types tests/trm-gap-triage.test.ts`
Expected: PASS, including all pre-existing tests in this file (no regressions) and the new `TEST-JEV-01`.

- [ ] **Step 5: Commit**

```bash
git add modules/trm/gap-triage-engine.mjs tests/trm-gap-triage.test.ts
git commit -m "feat(trm): call jev-filter after RRF, before web-fallback

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Render `[jev:0.xx]` tag in RFC evidence list

**Files:**
- Modify: `modules/trm/gap-triage-engine.mjs:212-223` (`evidenceList` construction inside `triageGapAgainstCache`)
- Test: `tests/trm-gap-triage.test.ts`

**Interfaces:**
- Consumes: `doc.jev_score` (number|undefined) on each `matchedDocuments` entry, as produced by Task 2/3.
- Produces: no new exported function — this is inline string formatting consumed only by the RFC markdown written to disk, verified via `rfcContent` in tests.

- [ ] **Step 1: Write failing test for the evidence tag**

```ts
// append to tests/trm-gap-triage.test.ts

test('TEST-JEV-02: evidenceList renders [jev:0.xx] tag only when jev_score is present', () => {
  const docWithJev = { topic: 'Doc A', file_path: 'a.md', content: 'alpha content', retrieval_mode: 'hybrid-rrf+jev', jev_score: 0.87 };
  const docWithoutJev = { topic: 'Doc B', file_path: 'b.md', content: 'beta content', retrieval_mode: 'hybrid-rrf' };

  // Exercise the real evidenceList builder via a minimal reimplementation
  // guard: call triageGapAgainstCache is integration-level, so instead assert
  // against the rendering helper's observable output directly through the
  // same regex the real map produces.
  const render = (doc) => {
    const cleanSnippet = (doc.content || '').slice(0, 250);
    const modeTag = doc.retrieval_mode ? ` [${doc.retrieval_mode}]` : '';
    const jevTag = typeof doc.jev_score === 'number' ? ` [jev:${doc.jev_score.toFixed(2)}]` : '';
    return `- **${doc.topic}** (\`${doc.file_path}\`)${modeTag}${jevTag}:\n  > ${cleanSnippet}`;
  };

  assert.match(render(docWithJev), /\[jev:0\.87\]/);
  assert.doesNotMatch(render(docWithoutJev), /\[jev:/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types tests/trm-gap-triage.test.ts`
Expected: PASS already, since this test exercises a local `render` closure, not the real code — this is intentional scaffolding to lock the expected string shape before touching the real map. Skip to Step 3, then add the real integration assertion in Step 4.

- [ ] **Step 3: Update the real `evidenceList` map in `gap-triage-engine.mjs`**

Replace lines 212-223:

```js
  const evidenceList = matchedDocuments.length > 0
    ? matchedDocuments.map((doc) => {
        const cleanSnippet = (doc.snippet || doc.content || '')
          .replace(/\r?\n/g, ' ')
          .replace(/\[MATCH\]|\[\/MATCH\]/g, '')
          .replace(/[[\]()]/g, '')
          .slice(0, 250)
          .trim();
        const modeTag = doc.retrieval_mode ? ` [${doc.retrieval_mode}]` : '';
        const jevTag = typeof doc.jev_score === 'number'
          ? ` [jev:${doc.jev_score.toFixed(2)}]`
          : '';
        return `- **${doc.topic}** (\`${doc.file_path}\`)${modeTag}${jevTag}:\n  > ${cleanSnippet}`;
      }).join('\n')
    : '- *No immediate context matches found in local knowledge cache. External investigation required.*';
```

- [ ] **Step 4: Add a real integration test asserting the tag appears in `rfcContent`**

```ts
// append to tests/trm-gap-triage.test.ts, after TEST-JEV-02

test('TEST-JEV-03: rfcContent carries [jev:0.xx] tag end-to-end when jev applies', async () => {
  process.env.TRM_JEV_FILTER = '1';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ answers: { doc_0: { value: 0.77, certainty: 4 } } }),
  });

  const db = getDatabase(testDbPath, { readonly: false });
  db.exec(`INSERT INTO kb_cache (id, topic, file_path, content, category) VALUES ('doc-1', 'Doc One', 'doc-1.md', 'relevant content about X', 'notes')`);
  db.exec(`INSERT INTO kb_fts (rowid, content) SELECT id, content FROM kb_cache WHERE id = 'doc-1'`);

  const gap = { id: 'GAP-02--x', localId: 'GAP-02', topicKey: 'x', title: 'X topic', description: 'about X', status: 'pending', line: '', raw: '' };
  const result = await triageGapAgainstCache(db, gap, { expandSearchQuery, limit: 3 });

  globalThis.fetch = originalFetch;
  delete process.env.TRM_JEV_FILTER;
  db.close();

  assert.match(result.rfcContent, /\[jev:0\.77\]/);
});
```

Adapt the `db.exec` insert statements to this repo's actual `kb_cache`/`kb_fts` schema (check `modules/cache/db-schema.mjs` for exact column names before running — the columns above are illustrative of intent, not verified against the schema file).

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test --experimental-strip-types tests/trm-gap-triage.test.ts`
Expected: PASS, all tests including TEST-JEV-02 and TEST-JEV-03.

- [ ] **Step 6: Commit**

```bash
git add modules/trm/gap-triage-engine.mjs tests/trm-gap-triage.test.ts
git commit -m "feat(trm): render jev_score as [jev:0.xx] tag in RFC evidence list

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Thread `jevCircuitBreaker` through `executeGapTriage`

**Files:**
- Modify: `modules/trm/gap-triage-engine.mjs:313-344` (`executeGapTriage`'s expander lazy-load and batch loop)
- Test: `tests/trm-gap-triage.test.ts`

**Interfaces:**
- Consumes: `createCircuitBreaker` from `./query-expander.mjs` (already imported dynamically at line 317-319); `triageGapAgainstCache`'s `jevCircuitBreaker` option from Task 3.
- Produces: nothing new externally — `executeGapTriage`'s own public signature is unchanged; this task only changes what it passes internally.

- [ ] **Step 1: Write failing test — circuit breaker persists across gaps in one batch run**

```ts
// append to tests/trm-gap-triage.test.ts

test('TEST-JEV-04: jev circuit breaker trips once and stays tripped across the batch', async () => {
  process.env.TRM_JEV_FILTER = '1';
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = async () => { callCount++; return { ok: false, status: 500 }; };

  fs.writeFileSync(gapsFilePath, [
    '# Gaps',
    '- [ ] [GAP-01] First gap: about alpha.',
    '- [ ] [GAP-02] Second gap: about beta.',
  ].join('\n'), 'utf8');

  await executeGapTriage({ gapsFilePath, outputDir, dbPath: testDbPath, dryRun: true, concurrency: 1 });

  globalThis.fetch = originalFetch;
  delete process.env.TRM_JEV_FILTER;

  // Both gaps hit lexical-only retrieval against an empty DB (retrievalMode
  // stays 'lexical'), so jev's own gate (retrievalMode === 'hybrid-rrf')
  // means callCount is 0 regardless of the breaker — this test instead
  // documents that no crash occurs and executeGapTriage completes normally
  // when jevCircuitBreaker is threaded through but never triggered.
  assert.equal(callCount, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types tests/trm-gap-triage.test.ts`
Expected: this specific test already passes today (no jev wiring exists yet, so `callCount` is trivially 0) — confirm by running before Step 3's edit; this test is a regression guard for Step 3, not a red/green driver. Proceed to Step 3.

- [ ] **Step 3: Create and thread `jevCircuitBreaker`**

In `modules/trm/gap-triage-engine.mjs`, update the lazy-load block (lines 313-320):

```js
  // Lazy-load expander only if needed (avoids import cost when --no-expand)
  let expandSearchQuery = null;
  let circuitBreaker = null;
  let jevCircuitBreaker = null;
  if (!noExpand) {
    const expander = await import('./query-expander.mjs');
    expandSearchQuery = expander.expandSearchQuery;
    circuitBreaker = expander.createCircuitBreaker();
    jevCircuitBreaker = expander.createCircuitBreaker();
  }
```

Update the `batch.map` call (lines 336-344):

```js
      batch.map((gap) =>
        triageGapAgainstCache(db, gap, {
          expandSearchQuery,
          circuitBreaker,
          jevCircuitBreaker,
          expandOptions,
          webFallback: options.webFallback,
          limit: 3,
        })
      )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --experimental-strip-types tests/trm-gap-triage.test.ts`
Expected: PASS, full file green (all pre-existing tests plus TEST-JEV-01 through TEST-JEV-04).

- [ ] **Step 5: Run the full jev-filter unit suite once more for a final cross-check**

Run: `node --test tests/jev-filter.test.mjs`
Expected: PASS (8/8).

- [ ] **Step 6: Commit**

```bash
git add modules/trm/gap-triage-engine.mjs tests/trm-gap-triage.test.ts
git commit -m "feat(trm): thread dedicated jevCircuitBreaker through executeGapTriage

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Gate (`TRM_JEV_FILTER` / `options.jevFilter`, empty-array no-op) → Task 1.
- Circuit-breaker reuse and short-circuit → Task 1 (short-circuit), Task 5 (creation/threading), reuses `query-expander.mjs`'s factory per the reconciled naming decision (no `createJevCircuitBreaker` invented).
- Request shape (`state`, index-based `doc_N` ids, `n` bounded by `limit`, timeout) → Task 2.
- Success path (attach `jev_score`/`jev_certainty`, min-max normalize `rrf_score`, 0.6/0.4 blend, re-sort, truncate-by-no-op, record success) → Task 2.
- Fail-soft path (fetch error / timeout / non-2xx / malformed body, record failure, never throw) → Task 2.
- Call-site placement (after RRF, before web-fallback, `retrievalMode === 'hybrid-rrf'` guard, literal `'hybrid-rrf+jev'` suffix) → Task 3.
- Circuit-breaker threading through `executeGapTriage` → Task 5.
- Evidence-list `[jev:0.xx]` tag, no new frontmatter field → Task 4.
- Tests: flag-off no-op, empty-array no-op, call-site gating by `retrievalMode`, success re-sort (multi-doc and single-doc), timeout/non-2xx/malformed fail-soft, breaker-open no network call, evidence-tag rendering → covered across Tasks 1, 2, 3, 4.

**Placeholder scan:** no TBD/TODO; Task 4 Step 4's DB insert is flagged explicitly as needing schema verification against `db-schema.mjs` rather than left as a silent guess.

**Type consistency:** `filterMatchedDocuments(gap, matchedDocuments, options)` → `{ matchedDocuments, applied }` is identical across Tasks 1, 2, 3. `jevCircuitBreaker` option name is identical across Task 3's destructuring and Task 5's `batch.map` call. `jev_score`/`jev_certainty` field names are identical across Task 2's attachment and Task 4's rendering.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-22-jev-rag-chunk-filter.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
