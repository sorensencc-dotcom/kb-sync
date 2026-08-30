---
title: Manifest Mode
category: concepts
status: active
sourceRepository: kb-sync
lastUpdated: "2026-08-30"
---

# Manifest Mode

**Manifest Mode** is an operational execution mode where KB-Sync processes only explicitly declared files listed in a target manifest file (`FILES.manifest.txt`), rather than walking entire directory trees.

---

## 🎯 Purpose & Capabilities

- **Scoped Ingestion:** Restricts processing to specific files undergoing changes.
- **Batch Processing:** Allows orchestration scripts to stage subsets of files for synthesis.
- **Idempotency:** Computes cryptographic hashes over manifest contents to bypass redundant runs.

---

## 🔗 Related Concepts
- [[immutable-staging]] — Staging directory contracts
- [[deterministic-sync-pipeline]] — Deterministic sync pipeline
