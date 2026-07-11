# Fail-Soft Orchestration

**Type:** Pattern  
**Domain:** kb-sync, orchestration  
**Status:** Active  
**Last Updated:** 2026-07-11

---

## Definition

Fail-soft orchestration is a multi-target execution strategy where the orchestrator invokes each target independently, continues execution even if one target fails, and reports per-target outcomes in a final summary. Failure of target A does not block target B; partial success is accepted and reported transparently.

---

## Why It Matters

Knowledge systems have different availability and reliability profiles (NotebookLM API may be down; Obsidian vault may be unavailable; wiki system may have linting issues). Fail-soft orchestration ensures that one target's failure doesn't block synchronization of other targets. Developers can still access NotebookLM if Obsidian is unreachable, and vice versa.

Fail-soft also supports graceful degradation: the system continues to function in a degraded state rather than failing catastrophically.

---

## Subconcepts

- **Per-Target Invocation:** Each target (NotebookLM, Obsidian, wiki) is invoked independently
- **Error Isolation:** Failure in one target doesn't affect others
- **Outcome Reporting:** Operator sees clear summary of which targets succeeded/failed
- **Partial Success:** Sync is considered "partially successful" if some targets update and others fail

---

## Related Concepts

- [[Deterministic Sync Pipeline]] — coordinates multiple phases with fail-soft logic
- [[Pack-Based Knowledge Management]] — single pack is consumed by multiple targets

---

## Examples

**Example 1: [[run-all.sh]] uses fail-soft orchestration**
- Invokes [[ingest-notebooklm.sh]] for NotebookLM target
- Invokes [[ingest-obsidian.sh]] for Obsidian target
- Invokes [[ingest-wiki.sh]] for wiki target
- If NotebookLM API fails, Obsidian and wiki targets still proceed
- Final report shows: "NotebookLM ✗, Obsidian ✓, Wiki ✓"
- Result: developers have access to 2/3 knowledge systems despite API failure

**Example 2: Graceful degradation in CI/CD**
- Nightly CI run executes [[kb-sync-nightly.sh]]
- NotebookLM upload fails (service maintenance)
- Obsidian and wiki staging succeed
- CI reports partial success (warning, not error)
- Next nightly run will retry NotebookLM
- Result: CI pipeline doesn't fail just because one service is down

**Example 3: Operator recovery workflow**
- Operator notices wiki synthesis linting error in morning briefing
- NotebookLM and Obsidian already updated with fresh pack
- Operator fixes lint issues and re-runs wiki ingest
- No need to re-run flatten or other targets
- Result: targeted recovery without cascading re-execution

---

## Cross-References

### Entities That Use This Concept

- [[run-all.sh]] — coordinates multiple targets with fail-soft logic
- [[ingest-notebooklm.sh]] — one target in orchestration
- [[ingest-obsidian.sh]] — one target in orchestration
- [[ingest-wiki.sh]] — one target in orchestration

### Concepts This Concept Depends On

- [[Deterministic Sync Pipeline]] — orchestration framework

### Backlinks From

- [[Deterministic Sync Pipeline]]

---

## Source Citations

**Primary Source:** `core/run-all.sh` (multi-target invocation logic)  
**Related:** `modules/notebooklm/ingest-notebooklm.sh` (per-target script)  
**Architecture:** `docs/kb/notebooklm-sync/architecture.md`  
**Pack Reference:** Multiple scripts implement per-target logic

---

## Governance & Rules

**Enforcement:**
- Each target must report its own status (success/failure)
- Orchestrator must not block subsequent targets based on prior failures

**Decision Gates:**
- Operator can choose to re-run specific targets without affecting others

**Exceptions:**
- None; fail-soft is non-negotiable for robustness

---

## Rationale & History

Early kb-sync implementations used strict orchestration: if any target failed, the entire pipeline would abort. This created fragile deployments where a transient API failure or network hiccup would stall all synchronization. Fail-soft orchestration prioritizes robustness: continue executing other targets even if one fails, and let the operator decide whether to retry or accept partial sync.

---

## Related Pages

- See [[Deterministic Sync Pipeline]] for orchestration model
- See [[rollback.sh]] for recovery strategy
