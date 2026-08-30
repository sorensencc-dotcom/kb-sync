---
title: Fail-Soft Orchestration
category: concepts
status: active
sourceRepository: kb-sync
lastUpdated: "2026-08-30"
---

# Fail-Soft Orchestration

**Fail-Soft Orchestration** is the operational safety pattern governing all automated background daemons, scheduled tasks, and Git hooks across KB-Sync and the wider Toolforge ecosystem.

---

## 🛡️ Core Philosophy

Automated maintenance tasks (autoheal sweepers, background indexing, telemetry collection) should **never block or corrupt primary developer workflows** when non-critical anomalies arise, while strictly failing closed on safety and security boundaries.

```mermaid
flowchart TD
    classDef safeStyle fill:#064e3b,stroke:#34d399,stroke-width:2px,color:#f8fafc;
    classDef softStyle fill:#1e293b,stroke:#fbbf24,stroke-width:2px,color:#f8fafc;
    classDef hardStyle fill:#7f1d1d,stroke:#f87171,stroke-width:2px,color:#f8fafc;

    OP["Hook / Scheduled Trigger"] --> EVAL{"Evaluate Boundary"}
    
    EVAL -- "Security / Git Remote Boundary" --> HARD["FAIL-CLOSED (Exit 1)<br/>• assertSafeRoot<br/>• Secret scan failure<br/>• Disallowed path write"]:::hardStyle
    
    EVAL -- "Telemetry / Drift Anomaly" --> SOFT["FAIL-SOFT (Log & Continue)<br/>• Append task to TODOS.md<br/>• Emit .drift-report.json<br/>• Exit 0 to permit commit"]:::softStyle
    
    EVAL -- "Clean State" --> PASS["PASS (Exit 0)<br/>• All checks verified"]:::safeStyle
```

---

## 🚦 Tier Classification & Behavior

| Tier | Boundary Type | Failure Behavior | Example |
|---|---|---|---|
| **Tier 1 (Security & Isolation)** | Git remotes, path escapes, credential safety | **Fail-Closed (Exit 1)** | `assertSafeRoot` blocking git pushes from research vaults; path traversal rejections. |
| **Tier 2 (Integrity & Schema)** | Markdown contract validation, schema conformity | **Fail-Closed (Exit 1)** in CI, **Warning** in local hook | Missing required frontmatter fields during pull request review. |
| **Tier 3 (Drift & Background Sync)** | Telemetry collection, sibling documentation sync | **Fail-Soft (Exit 0)** + `TODOS.md` logging | Code file modified without immediate doc sibling; logs task to `TODOS.md` without halting commit. |

---

## 🔗 Related Concepts
- [[deterministic-sync-pipeline]] — Deterministic pipeline invariants
- [[karpathy-llm-wiki-pattern]] — Automated distillation workflows
