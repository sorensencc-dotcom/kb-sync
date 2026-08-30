---
title: Raw Source Staging
category: concepts
status: active
sourceRepository: kb-sync
lastUpdated: "2026-08-30"
---

# Raw Source Staging

**Raw Source Staging** is the initial data capture phase where unformatted external documents, declassified logs, audio transcripts, and media files are captured and assigned immutable source IDs before distillation.

---

## 📐 Ingestion Workflow

1. **Source Capture:** Ingests external files into a standardized staging workspace.
2. **Digest Computation:** Computes SHA-256 digests for every ingested artifact.
3. **Catalog Registration:** Records source provenance, timestamp, and MIME types in `source_catalog.json`.

---

## 🔗 Related Concepts
- [[immutable-staging]] — Immutable staging directory rules
- [[pack-based-knowledge-management]] — Pack architecture
