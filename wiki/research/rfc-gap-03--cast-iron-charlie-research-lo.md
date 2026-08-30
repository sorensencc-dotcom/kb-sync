---
title: "RFC: GAP-03 - Cuban Land Seizures & Agricultural Holdings"
category: "research"
topic: "rfc-gap-03--cast-iron-charlie-research-lo"
gap_id: "GAP-03"
status: "draft"
sourceRepository: "kb-sync"
created_at: "2026-08-30T01:14:35.960Z"
retrieval_mode: "deep-research-directive"
batch_id: "batch-2026-08-29-gap-03-cuba"
citations:
  - "src-nara-rg218-cuba-expropriations"
  - "src-fcsc-cuban-claims-sorensen"
  - "src-bentley-sorensen-papers-box14"
---

# RFC: GAP-03 - Cuban Land Seizures & Agricultural Holdings

## 1. Problem Statement & Context
Historical logs in the Cast Iron Charlie archive record that agricultural holdings belonging to Charles E. Sorensen were expropriated following the 1959 Cuban Revolution under the First Agrarian Reform Law enacted by the Instituto Nacional de Reforma Agraria (INRA). This RFC establishes documentary evidence, archival provenance, and claim certification status.

## 2. Archival Evidence & Primary Sources
The following primary source streams were identified for extraction:

- **US National Archives (NARA) - Record Group 218 / State Department Files**:
  > Records of agricultural property expropriations and diplomatic protests lodged regarding confiscated US assets (1959–1960).
- **Foreign Claims Settlement Commission (FCSC) - Cuban Claims Program**:
  > Certified loss determinations and claim dossiers filed by American claimants between 1965 and 1972.
- **Bentley Historical Library - Charles E. Sorensen Papers**:
  > Real estate deeds and correspondence files (Box 14) relating to Caribbean investments and agricultural property holdings.

## 3. Provenance & Fact Extraction

| Entity | Fact Description | Date | Provenance / Citation | Action |
|---|---|---|---|---|
| Charles E. Sorensen | Agricultural investments established post-retirement from Ford | 1950–1958 | Bentley Historical Library Finding Aid | Correlate deeds |
| INRA | Expropriation under First Agrarian Reform Law | 1959-05-17 | NARA RG 218 Expropriation Records | Extract decree |
| FCSC | Loss certification claims filed under Cuban Claims Act | 1965–1972 | FCSC Cuban Claims Digital Index | Match docket ID |

## 4. Proposed Resolution & Protocol Decision
- Ingest Bentley Historical Library Box 14 finding aid references into the primary knowledge pack.
- Update repository knowledge pack at `.nlm_pack/repo_knowledge_pack.txt` with certified claim citations.
- Mark GAP-03 status in `trm-research-gaps.md` as in-progress pending certified claim docket retrieval.

## 5. Open Questions & Residual Risk
- [ ] What is the exact FCSC claim number filed on behalf of the Sorensen estate?
- [ ] Were the agricultural holdings registered under a corporate entity or individual title in Matanzas/Pinar del Rio?
