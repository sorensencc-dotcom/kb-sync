# Issue #94 graph drift gate design

Issue #94 adds a narrow, fail-closed gate around graph-backed merges. Candidate B is the accepted shape.

## Chosen shape

`modules/graph-sync/queue.mjs` owns three boundaries.

1. Pure snapshot canonicalization and comparison.
2. A persisted queue state machine.
3. Explicit preflight and merge adapter boundaries.

`GraphSnapshot` uses `kb-sync-graph/v1`, `sourceVersion`, `targetVersion`, sorted `nodes`, sorted `edges`, and `snapshotHash`. A node map key is `id/kind/path`; its `hash` is the content evidence used to report `changed`. The full node identity remains `id/kind/path/hash`. An edge map key is `from/to/kind`. Rewrites sharing `from/kind` are reported as `rewired`.

`QueueItem` moves through `queued`, `preflighting`, `ready`, `merging`, and `merged`. `quarantined` records expected and observed hashes, a stable drift report, and retryability. `failed` records the merge error and can be retried. Enqueue, preflight, retry, and merge are idempotent at their durable boundaries.

Preflight creates a token bound to queue id, source version, target version, and snapshot hash. Merge checks that binding before changing state or calling the merge adapter. Drift, malformed snapshots, missing `.base` state, and token mismatch all fail closed. The merge adapter is the only mutation boundary.

The default file adapter reads `snapshot.json` as deterministic UTF-8 JSON. It also accepts deterministic tab-separated RDF records in `.nt`, `.nq`, `.ttl`, `.rdf`, or `.txt` files. Missing or malformed input is an explicit quarantine. The queue has no default mutating adapter. The CLI creates a safe `git merge --no-ff --no-edit <sourceVersion>` adapter only after the operator supplies `merge --apply`.

## CLI contract

The CLI emits one stable JSON object per invocation. `0` means success, `2` means usage error, `3` means blocked or quarantined, and `4` means an operational failure. The supported operations are `enqueue`, `preflight`, `retry`, `merge`, and `status`.

The CLI does not add package script wiring. Direct invocation keeps this issue isolated and avoids growing the repository command surface for one gate.

## Rejected graph-first alternative

Candidate A made Oxigraph the queue owner and treated the graph database as the source of lifecycle truth. It was rejected because it would make tests depend on a live graph service, mix graph storage with merge authorization, and make malformed `.base` recovery less explicit. Candidate B keeps immutable graph evidence in queue items, lets tests inject inspection and mutation, and leaves any future Oxigraph integration behind `preflightAdapter` without changing the gate contract.
