### **KB-Sync Knowledge Base**

* [[Home]]

---

### **📐 Architecture & Concepts**
* [[pack-based-knowledge-management|Pack-Based Knowledge Management]]
* [[deterministic-sync-pipeline|Deterministic Sync Pipeline]]
* [[karpathy-llm-wiki-pattern|Karpathy LLM-Wiki Pattern]]
* [[local-context-cache|Local Context Cache]]
* [[fail-soft-orchestration|Fail-Soft Orchestration]]
* [[immutable-staging|Immutable Staging]]
* [[trm-closed-loop-research|TRM Closed-Loop Research]]

---

### **🔬 Research RFCs**
* [[rfc-gap-01--cast-iron-charlie-research-lo|GAP-01 Provenance Extraction]]
* [[rfc-gap-02--cast-iron-charlie-research-lo|GAP-02 Contradictory Claims]]
* [[rfc-gap-03--cast-iron-charlie-research-lo|GAP-03 Cuban Land Seizures]]
* [[rfc-gap-04--cast-iron-charlie-research-lo|GAP-04 Photographic Archive]]

---

### **🛠️ Core Modules**
* [[fleet-wiki-reconciler.ts|Fleet Wiki Reconciler]]
* [[cross-repo-drift-scanner.ts|Cross-Repo Drift Scanner]]
* [[autoheal-sweeper.mjs|Autoheal Sweeper]]
* [[entity-synthesizer.ts|Entity Synthesizer]]
* [[detect-drift.ts|Drift Detector]]
* [[sync-github-wiki.mjs|GitHub Wiki Publisher]]

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
