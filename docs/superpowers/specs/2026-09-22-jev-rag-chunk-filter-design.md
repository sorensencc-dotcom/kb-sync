# Design: jev RAG chunk filter for gap-triage retrieval

**Date:** 2026-09-22
**Repo:** `C:\dev\kb-sync`
**Depends on:** `cic-jev` (`C:\dev\cic-jev`), v1 core, closed 2026-09-22
(`docs/superpowers/HANDOFF-2026-09-22.md` in that repo).
**Status:** draft, awaiting approval

## Problem

`triageGapAgainstCache()` (`modules/trm/gap-triage-engine.mjs`) retrieves up to
`limit` (default 5) candidate documents per research gap via hybrid RRF
(`modules/cache/vector-store.mjs`: lexical FTS5 + dense cosine, blended by
`reciprocalRankFusion`). Every surviving document goes straight into the
generated RFC's evidence section and `citations` frontmatter — RRF rank is
the only relevance signal. There is no semantic check of whether a
top-ranked chunk actually addresses the gap; RRF only knows term/vector
overlap, not judged relevance.

`cic-jev` (local HTTP wrapper around Ollama, TypeSafe System One-compatible
`noul`/`choice`/`score` contract) can supply that judgment: given a gap and
a candidate doc, ask a `score` question ("how relevant is this doc to this
gap, 0.0-1.0") and use the answer to rerank.

## Non-goals

- Not a new retrieval stage — no new candidates are found, only the
  existing RRF survivors are rescored.
- Not a hard filter — nothing is dropped based on jev's opinion alone. jev's
  confidence heuristic is unvalidated beyond one 10-item eval set (cic-jev
  spec §2.3); treating it as ground truth would risk silently deleting real
  evidence on a false negative.
- Not default-on. Opt-in via env flag until real usage data justifies
  promotion (mirrors `TRM_WEB_FALLBACK`).
- Not a shared/generic reranker module for other kb-sync consumers yet —
  scoped to gap-triage only. Generalize later if a second caller appears.

## Design

### New module: `modules/trm/jev-filter.mjs`

Single export:

```js
export async function filterMatchedDocuments(gap, matchedDocuments, options = {})
// returns { matchedDocuments, applied: boolean }
```

Behavior:

1. **Gate.** No-op (`applied: false`, `matchedDocuments` returned unchanged)
   unless `options.jevFilter ?? process.env.TRM_JEV_FILTER === '1'` is true,
   or `matchedDocuments.length === 0` (nothing to score).
2. **Circuit breaker.** Reuse `createCircuitBreaker` from
   `./query-expander.mjs` rather than duplicating it. If
   `options.circuitBreaker?.isOpen()`, no-op.
3. **Request.** One POST to
   `${options.jevBaseUrl ?? process.env.JEV_BASE_URL ?? 'http://127.0.0.1:4173'}/v1/systemone`:
   - `state`: `{ title: gap.title, description: gap.description }`.
   - One `score`-type question per doc, id `doc_0..doc_{n-1}` (index-based,
     not doc id, to sidestep `RESERVED_QUESTION_IDS` collisions and keep ids
     short), `instructions` embeds that doc's `topic` and first ~200 chars of
     `content`/`snippet`.
   - `n` bounded by existing `limit` (default 5) — always well under
     cic-jev's `MAX_QUESTIONS` (20), no new cap needed.
   - Timeout via `AbortController`, `options.timeoutMs ?? 3000` (matches the
     embedding-call timeout already used in `triageGapAgainstCache`).
4. **On success:** for each doc, attach `jev_score` (the `score` question's
   `value`) and `jev_certainty` (its `certainty`, 1-5). Re-sort
   `matchedDocuments` by `rrf_score * 0.6 + jev_score * 0.4` (documented
   inline as a starting weight, not exposed as a public option — tune later
   from real data, YAGNI now). Truncate to the same `limit` already applied
   upstream (re-sort only, no new truncation point). Record success on the
   circuit breaker. Return `{ matchedDocuments: reranked, applied: true }`.
5. **On any failure** (fetch error, timeout, non-2xx, malformed/missing
   fields in response): record failure on the circuit breaker, return
   `{ matchedDocuments, applied: false }` unchanged — identical fail-soft
   shape to the existing vector-search try/catch in
   `triageGapAgainstCache`. Never throws.

### Call site: `gap-triage-engine.mjs`

One new step in `triageGapAgainstCache`, immediately after the RRF block
(current ~L144-169) and **before** the web-fallback block (~L171-186) — not
after it. Web-fallback only runs when `matchedDocuments.length === 0`, so
placing jev's call first means it only ever sees actual RRF survivors, never
web-fallback or pure-lexical fallback docs, matching the "RRF survivors only"
scope in Non-goals. As defense in depth against a future reordering of these
blocks, the gate also checks `retrievalMode === 'hybrid-rrf'` explicitly
rather than relying on placement alone:

```js
// Placed here, before web-fallback (~L171), so jev only ever scores
// actual RRF survivors — never web-fallback or lexical-only fallback docs.
if (retrievalMode === 'hybrid-rrf') {
  const { matchedDocuments: filtered, applied } = await filterMatchedDocuments(
    gap, matchedDocuments, { circuitBreaker: jevCircuitBreaker }
  );
  matchedDocuments = filtered;
  if (applied) retrievalMode = `${retrievalMode}+jev`;
}
```

`retrievalMode` gaining the `+jev` suffix only when actually applied means
RFC frontmatter (`retrieval_mode: "hybrid-rrf+jev"` vs `"hybrid-rrf"`) shows
whether jev ran for that gap, without a separate boolean field to keep in
sync with the suffix.

`jevCircuitBreaker` is created once per `executeGapTriage()` batch run
(same lifetime pattern as the existing query-expander circuit breaker),
passed down alongside it.

### Tests: `tests/jev-filter.test.mjs`

Mocked `fetchImpl` (matches cic-jev's own test convention), covering:

- Flag off → no-op, `applied: false`, docs unchanged.
- Empty `matchedDocuments` → no-op without a network call.
- Call-site: `retrievalMode !== 'hybrid-rrf'` (lexical-only or web-fallback) →
  `filterMatchedDocuments` never called at all (covers `gap-triage-engine.mjs`
  call site, not the module itself).
- Success → scores attached, re-sort order matches the weighted formula.
- Timeout / non-2xx / malformed response body → fail-soft, `applied: false`,
  circuit breaker records failure.
- Circuit breaker already open → no network call made.

## Open questions

None blocking — rerank weight (0.6/0.4) is a starting point to revisit once
there's real triage-run data to compare against, not a design gap.
