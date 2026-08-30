### **KB-Sync Wiki**

* [[Home]]
* [[Index]]
* [[Log]]

---

### **📐 Architecture & Concepts**
* [[deterministic-sync-pipeline]]
* [[karpathy-llm-wiki-pattern]]
* [[local-context-cache]]
* [[fail-soft-orchestration]]
* [[pack-based-knowledge-management]]
* [[trm-closed-loop-research]]

---

### **🔬 Research RFCs**
* [[rfc-gap-01--cast-iron-charlie-research-lo]]
* [[rfc-gap-02--cast-iron-charlie-research-lo]]
* [[rfc-gap-03--cast-iron-charlie-research-lo]]
* [[rfc-gap-04--cast-iron-charlie-research-lo]]

---

### **🛠️ Core Modules**
* [[fleet-wiki-reconciler.ts]]
* [[cross-repo-drift-scanner.ts]]
* [[autoheal-sweeper.mjs]]
* [[entity-synthesizer.ts]]
* [[detect-drift.ts]]
* [[sync-github-wiki.mjs]]

---

### **ℹ️ Quick Instructions**
1. **Check Drift:**  
   `npm run kb:drift`
2. **Publish Wiki:**  
   `npm run wiki:publish`
3. **Reconcile Fleet:**  
   `npm run fleet:wiki:reconcile`
4. **Run Autoheal:**  
   `node modules/wiki/autoheal-sweeper.mjs --dry-run`
5. **TRM Triage:**  
   `npm run trm:triage`
