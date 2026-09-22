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
   `value`, 0.0-1.0) and `jev_certainty` (its `certainty`, 1-5). `rrf_score`
   is not on a 0-1 scale (RRF terms are `1/(k+rank)` with `k=60`, so values
   sit around 0.008-0.033) — blending it directly against `jev_score` would
   let `jev_score` dominate regardless of the stated 0.6/0.4 weights. Min-max
   normalize `rrf_score` across the current candidate set first
   (`(score - min) / (max - min || 1)`, single-doc set maps to `1.0`), then
   re-sort `matchedDocuments` by
   `normalizedRrf * 0.6 + jev_score * 0.4` (documented inline as a starting
   weight, not exposed as a public option — tune later from real data, YAGNI
   now). Truncate to the same `limit` already applied upstream (re-sort only,
   no new truncation point). Record success on the circuit breaker. Return
   `{ matchedDocuments: reranked, applied: true }`.
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
  // Literal, not `${retrievalMode}+jev` — the guard above already narrows
  // retrievalMode to exactly 'hybrid-rrf', so templating it implies support
  // for other input values this branch can never see.
  if (applied) retrievalMode = 'hybrid-rrf+jev';
}
```

`retrievalMode` gaining the `+jev` suffix only when actually applied means
RFC frontmatter (`retrieval_mode: "hybrid-rrf+jev"` vs `"hybrid-rrf"`) shows
whether jev ran for that gap, without a separate boolean field to keep in
sync with the suffix.

`jevCircuitBreaker` is created once per `executeGapTriage()` batch run and
threaded down exactly like the existing query-expander `circuitBreaker` is
today (`gap-triage-engine.mjs` current ~L314-320, ~L337-340). Concretely:

```js
// alongside the existing `circuitBreaker` creation in executeGapTriage()
const jevCircuitBreaker = createJevCircuitBreaker(); // from ./jev-filter.mjs

// ...in the batch.map((gap) => triageGapAgainstCache(db, gap, { ... })) call:
triageGapAgainstCache(db, gap, {
  expandSearchQuery,
  circuitBreaker,       // existing, query-expander's
  jevCircuitBreaker,    // new
  expandOptions,
})
```

`triageGapAgainstCache`'s own signature gains one destructured option,
`jevCircuitBreaker = null`, passed through to `filterMatchedDocuments`
unchanged.

### RFC evidence rendering: `gap-triage-engine.mjs` evidenceList

Today, `jev_score`/`jev_certainty` only exist in-memory for reranking and
are dropped before the RFC is written — the only surviving signal is the
`retrieval_mode` suffix. That's not enough to audit *why* a doc ranked where
it did after a jev run. The existing per-doc `modeTag` (real file,
evidenceList map, currently `` ` [${doc.retrieval_mode}]` ``) gains a second
tag when `jev_score` is present:

```js
const modeTag = doc.retrieval_mode ? ` [${doc.retrieval_mode}]` : '';
const jevTag = typeof doc.jev_score === 'number'
  ? ` [jev:${doc.jev_score.toFixed(2)}]`
  : '';
return `- **${doc.topic}** (\`${doc.file_path}\`)${modeTag}${jevTag}:\n  > ${cleanSnippet}`;
```

No new frontmatter field — the per-doc score sits next to its citation
where it's read, not in a separate list that has to stay index-aligned with
`citations`.

### Tests: `tests/jev-filter.test.mjs`

Mocked `fetchImpl` (matches cic-jev's own test convention), covering:

- Flag off → no-op, `applied: false`, docs unchanged.
- Empty `matchedDocuments` → no-op without a network call.
- Call-site: `retrievalMode !== 'hybrid-rrf'` (lexical-only or web-fallback) →
  `filterMatchedDocuments` never called at all (covers `gap-triage-engine.mjs`
  call site, not the module itself).
- Success → scores attached, re-sort order matches the normalized weighted
  formula (covers both the multi-doc min-max case and the single-doc
  `normalizedRrf = 1.0` edge case).
- Timeout / non-2xx / malformed response body → fail-soft, `applied: false`,
  circuit breaker records failure.
- Circuit breaker already open → no network call made.
- `gap-triage-engine.mjs` evidenceList rendering: doc with `jev_score` set
  renders the `[jev:0.xx]` tag; doc without it (jev not applied) doesn't.

## Open questions

None blocking — rerank weight (0.6/0.4) is a starting point to revisit once
there's real triage-run data to compare against, not a design gap.
