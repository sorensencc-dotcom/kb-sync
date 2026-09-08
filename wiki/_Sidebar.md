---
title: _Sidebar
category: wiki
status: draft
sourceRepository: kb-sync
---
### **KB-Sync Knowledge Base**

* [[kb-sync/wiki/research/Home]]

---

### **📐 Architecture & Concepts**
* [[concepts/pack-based-knowledge-management.md|Pack-Based Knowledge Management]]
* [[concepts/deterministic-sync-pipeline.md|Deterministic Sync Pipeline]]
* [[concepts/karpathy-llm-wiki-pattern.md|Karpathy LLM-Wiki Pattern]]
* [[concepts/local-context-cache.md|Local Context Cache]]
* [[concepts/fail-soft-orchestration.md|Fail-Soft Orchestration]]
* [[kb-sync/wiki/ImmutableStaging.md,concepts/immutable-staging.md|Immutable Staging]]
* [[concepts/trm-closed-loop-research.md|TRM Closed-Loop Research]]

---

### **🔬 Research RFCs**
* [[research/rfc-gap-01--cast-iron-charlie-research-lo.md|GAP-01 Provenance Extraction]]
* [[research/rfc-gap-02--cast-iron-charlie-research-lo.md|GAP-02 Contradictory Claims]]
* [[research/rfc-gap-03--cast-iron-charlie-research-lo.md|GAP-03 Cuban Land Seizures]]
* [[research/rfc-gap-04--cast-iron-charlie-research-lo.md|GAP-04 Photographic Archive]]

---

### **🛠️ Core Modules**
* [[entities/fleet-wiki-reconciler.ts.md|Fleet Wiki Reconciler]]
* [[entities/cross-repo-drift-scanner.ts.md|Cross-Repo Drift Scanner]]
* [[entities/autoheal-sweeper.mjs.md|Autoheal Sweeper]]
* [[entities/entity-synthesizer.ts.md|Entity Synthesizer]]
* [[entities/detect-drift.ts.md|Drift Detector]]
* [[entities/sync-github-wiki.mjs.md|GitHub Wiki Publisher]]

---

### **ℹ️ Quick Instructions**
1. **Check Drift:**  
   `npm run kb:drift`
2. **Publish Wiki:**  
   `npm run wiki:publish`
3. **Reconcile Fleet:**  
   `npm run fleet:wiki:reconcile`
4. **Autoheal:**  
   `node modules/wiki/autoheal-sweeper.mjs`
5. **TRM Triage:**  
   `npm run trm:triage`
