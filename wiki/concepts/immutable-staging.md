---
title: Immutable Staging
category: concepts
status: active
sourceRepository: kb-sync
lastUpdated: "2026-08-30"
---

# Immutable Staging

**Immutable Staging** is the filesystem isolation contract used by KB-Sync to separate active code trees from staged synthesis payloads.

---

## 🏛️ Staging Directory Structure

All staged source snapshots live inside timestamped subdirectories under `_kb-sync-staging/`:

```text
_kb-sync-staging/
└── kb-sync/
    └── 20260830-031500/
        ├── FILES.manifest.txt     # List of all staged files
        ├── core/                  # Copied source code files
        ├── modules/               # Copied module files
        └── .staging-meta.json     # Content hash and snapshot metadata
```

---

## 🔒 Key Invariants

1. **Write-Once Snapshots:** Once written, files inside a timestamped staging directory are never modified in place.
2. **Deterministic Manifests:** `FILES.manifest.txt` lists every staged file in canonical sort order.
3. **Content Hash Verification:** Synthesis providers compute a SHA-256 hash across all files listed in `FILES.manifest.txt` to verify state before running extraction.
4. **Git Exclusion:** `_kb-sync-staging/` is permanently included in `.gitignore` and `agent-scan.ignore` to eliminate Git index bloat.

---

## 🔗 Related Concepts
- [[raw-source-staging]] — Ingestion of unformatted corpora
- [[manifest-mode]] — Manifest-driven processing
- [[deterministic-sync-pipeline]] — Pipeline execution rules
