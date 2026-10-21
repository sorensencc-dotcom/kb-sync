---
title: TRM Mobile Inbox Triage Pipeline
category: wiki
status: active
sourceRepository: icf
---

# TRM mobile inbox triage and PR staging pipeline

**Type:** Architecture, Operational Pipeline  
**Domain:** icf, trm, git-workflows  
**Status:** Active  
**Last Updated:** 2026-10-19

---

The Topic Research Mining (TRM) mobile inbox triage pipeline processes inbound action items from Google Drive through autonomous research spikes and pull request staging.

![TRM Mobile Inbox Triage & PR Staging Pipeline](trm-mobile-inbox-triage-pipeline.png)

<details><summary>Mermaid source...</summary>

```mermaid
flowchart TD
    subgraph S1["1. INGESTION & UNSTRANDING (trm-ingress-watcher.mjs)"]
        MI["Mobile Inbox: Google Drive / GDoc Pointer Stubs"] --> IW["Ingress Watcher & Unstrander"]
        IW -->|Extracts true category, priority, direction| RC["Inspects raw_content & clears false isGDocFetchFailure"]
    end

    RC --> BT["2. DUAL-LANE BATCH TRIAGE (trm-batch-triage.mjs / ICF Gateway)"]

    subgraph LaneA["LANE A: Autonomous Research Spikes (Zero Tokens)"]
        BT -->|category: RESEARCH / FEASIBILITY_SPIKE| SP["evaluateActionCard (Zero Tokens)"]
        SP --> DB["Synthesizes local knowledge.db (RRF k=60)"]
        DB --> RFC["Emits RFC to obsidian/vault/wiki/research/"]
        RFC --> REC["Writes outbox completion receipt & Drive sync"]
        REC --> DONE["Transitions ledger status to DONE"]
    end

    subgraph LaneB["LANE B: Coding & Implementation"]
        BT -->|category: IMPLEMENT / FIX / REFACTOR| GH["Promotes to GitHub Issue (gh issue create)"]
        GH --> ENR["Runs out-of-band context enricher"]
        ENR --> AST["Attaches Graft AST spans & runtime probes"]
        AST --> INP["Transitions ledger status to IN_PROGRESS"]
    end

    subgraph S3["3. PR TRIAGE BRIDGE (trm-stage-pr.mjs)"]
        INP --> BR["Creates git branch: trm/cardId"]
        BR --> TDD["Scaffolds runnable TDD test contract in target repo"]
        TDD --> TEMPL["Injects conventional commit template & PR contract"]
        TEMPL --> ICF["Surfaces live PR badge in ICF Dashboard (tab-trm)"]
    end
```

</details>

## Definition

The TRM mobile inbox triage system connects mobile thoughts, voice memos, and quick capture documents to automated execution lanes. The pipeline unstrands raw document pointers, routes research items to autonomous zero-token local spikes, and stages verified coding contracts into topic branches with TDD test files.

## Architecture and lifecycle

1. **Ingestion and unstranding:** `scripts/trm-ingress-watcher.mjs` extracts substantive intent from `.gdoc` files, resolves target repositories, and stages cards into `.harness/tasks/pending/`.
2. **Dual-lane batch triage:** `scripts/trm-batch-triage.mjs` and the ICF Gateway partition tasks into Lane A and Lane B.
3. **Autonomous research spikes (Lane A):** Research tasks run through `evaluateActionCard` with hybrid reciprocal rank fusion ($k=60$) over `.kb_cache/knowledge.db`, producing RFC notes and outbox receipts.
4. **Coding and implementation (Lane B):** Coding tasks generate GitHub issues with out-of-band Graft AST context packs.
5. **PR triage bridge:** `scripts/trm-stage-pr.mjs` branches the target repository (`trm/<cardId>`), scaffolds a runnable test contract (`tests/trm-<cardId>.test.mjs`), and reports branch telemetry to Iron Command Forge.

## Related concepts

- [[kb-sync/concepts/trm-closed-loop-research|TRM Closed Loop Research]]
- [[kb-sync/concepts/local-context-cache|Local SQLite Context Cache]]
