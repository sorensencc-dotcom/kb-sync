---
title: "WikiEntitiesWatchCompetitorsV2Mjs"
category: "wiki"
status: "active"
citations: ["kb-sync/watch-competitors-v2.mjs"]
sourceRepository: kb-sync
---

# WikiEntitiesWatchCompetitorsV2Mjs

## Summary
Hardened competitor watchlist and semantic drift monitor for the Topic Research Mining (TRM) subsystem. Performs DNS-pinned anti-TOCTOU fetching with SSRF boundary enforcement, calculates SHA-256 target baseline hashes, executes structured line-by-line diffing against Layer 2 Wiki nodes, and constructs RFC 8785 canonicalized, Ed25519-signed Sigil v1.0.0 envelopes for human step-up approval gates.

## Key Exports
- `validateTargetUrl(url, options)`: Validates URL against protocol, host, private/loopback IP, and credentials rules.
- `secureFetchWithPinnedDns(targetUrl, options)`: Pins DNS resolution directly to verified sockets to prevent DNS rebinding attacks.
- `performStructuredDiff(localPath, newPayload)`: Calculates LCS line diffs and similarity ratios against local Layer 2 markdown baselines.
- `signSigilEnvelope(unsignedEnvelope, privateKeyPem, keyId)`: Produces Ed25519 signatures over JCS canonicalized payload bytes.
- `dispatchSigilEnvelope(db, signedEnvelope, queuePath)`: Idempotently persists approval records to SQLite `local_approvals` or JSONL queue.
- `monitorCompetitorWatchlist(watchlistPath, options)`: Main execution engine orchestrating multi-target drift scanning.

## Source Citations
- Staged: `kb-sync/watch-competitors-v2.mjs`
