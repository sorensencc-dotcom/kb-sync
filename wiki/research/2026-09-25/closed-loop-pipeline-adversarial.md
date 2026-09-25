---
source: grok
skill: drive-it
topic: trm
title: "Closed-loop TRM pipeline: NLM pack split vs live limits"
created: Fri Sep 25 2026 15:55:29 GMT-0400 (Eastern Daylight Time)
folder_id: 1Faya0q0j3S62NGq_U-nxrefwbwfGQq0g
status: drop
provenance_type: mobile_inbox_drop
content_sha256: 592f1f8e11599147fe0766531e883132e435f833f25ae619726436f764c55e5b
---

# Closed-loop TRM pipeline — adversarial review

## Context

Proposed architecture: remote agents drop via `drive-it <slug>` into Google Drive `mobile-inbox`; Desktop `trm-ingest-drive.mjs` dispatches by frontmatter `topic` into vault paths; `kb-sync` compiles per-slug `.nlm_pack` files; domain-partitioned NotebookLM notebooks; `trm mine-notebooklm` writes `trm-research-gaps.md`; `trm-export-gaps.mjs` re-exports cards to Drive.

This drop reviews that design against live NotebookLM / Gemini Notebook limits (Sep 2026), export/API reality, and the current `drive-it` topic map.

Landing folder is `mobile-inbox` (`1Faya0q0j3S62NGq_U-nxrefwbwfGQq0g`) because it is the only mapped upload target and matches the architecture's single-buffer rule.

## Payload

### Claim under test

Scoped packs + partitioned notebooks + Drive frontmatter dispatch close the research loop without a monolithic notebook and without human gap transcription.

### Verdict

**INCONCLUSIVE** as an end-to-end automated loop.

- **SUPPORTED**: single Drive buffer + frontmatter `topic` dispatch; per-slug vault paths; scoped packs instead of one mega-pack.
- **REFUTED (automation layer)**: first-party programmatic query/chat/export of NotebookLM notebooks for gap mining. Consumer product has no self-serve API. Native export is Docs/Sheets only. Enterprise Gemini Notebook API (preview) can manage notebooks/sources and generate audio overviews; it does not expose query/chat — the two operations gap mining needs.
- **UNKNOWN**: user's Google AI plan tier (Standard 50 / Plus 100 / Pro 300 / Ultra 500–600 sources per notebook). Pack compiler must assume the lowest live cap until verified.

### Live limits (third-party compilations of Google help tables, Aug–Sep 2026)

Treat as **INFERRED** until pasted from the account's own help/upgrade page.

| Constraint | Value that does not change by plan | Value that scales by plan |
|---|---|---|
| Words per source | 500,000 | — |
| Local file size | 200 MB | — |
| PDF page count | no official page cap | — |
| Sources / notebook | — | 50 Standard, 100 Plus, 300 Pro, 500–600 Ultra |
| Notebooks / user | — | 100–500 |
| Saved notes | count toward source cap once saved | — |
| Cross-notebook retrieval | isolated; no shared memory | — |
| Consumer API | none | Enterprise preview only, no chat/query |
| Native export | Docs or Sheets from Studio notes/reports | no MD / no full notebook dump |
| AI usage | rolling ~5h refresh + weekly cap (Sep 2026 UI) | multiplier by plan |

Sources: PostToSource 2026-06-17; FileConcat Sep 2026; notebooklm-guide / notebooktoolkit / elephas / atlasworkspace / XDA / MakeUseOf / TechTudo Sep 2026; Glasp 2026-06 (enterprise API cannot query/chat).

### Direct quotes & field evidence

- DevCrea (2026-09-25): "Building automated workflows is impossible because Google provides absolutely zero API access for this tool." Consumer-facing claim; does not mention enterprise preview. Weight as community consensus, not Google primary.
- MakeUseOf (2026-03-11): native export "only sends content to Google Docs or Sheets. No PDF, no Markdown, no plain text."
- XDA (2026-01-16): "The tool begins to struggle long before you hit the cap."
- @SJE1981 (2026-09-24): Gemini Notebook UI now says limits refresh every 5 hours and heavy jobs can queue; weekly cap still applies; long chats consume more quota.
- @simonmanleyauto (2026-09-15): OCR on scans works; "Single Google Doc trick saves source limits"; server lag on live troubleshooting.

### Undocumented edge cases & skepticism

1. **Gap miner cannot be a first-party script.** `trm mine-notebooklm` must be one of: (a) human paste from NLM chat into `trm-research-gaps.md`, (b) Docs-export scrape, (c) unofficial web-driver (breaks on UI churn), (d) Gemini Notebook Enterprise API if/when chat exists. Do not spec (c) as production.
2. **Partitioning helps token focus and hurts cross-domain questions.** A CIC fact that answers a TRM schema gap will not be visible to the TRM notebook. Need an explicit "bridge card" path in `default`/`kb`, not implicit NLM memory.
3. **Pack size vs per-source cap.** One `.nlm_pack` that concatenates a domain will hit 500k words / 200 MB before it hits source-count. Compiler must split packs (`cic.nlm_pack.01`, `.02`) and keep a manifest. Notes saved inside NLM steal source slots.
4. **Quality degrades with source count.** Prefer fewer, denser sources (concat related MD) over one file per drop. Contradicts "drop every investigation as its own NLM source."
5. **drive-it map is incomplete.** VERIFIED from `references/topics.md`:
   - `cic` → `1Faya0q0j3S62NGq_U-nxrefwbwfGQq0g` (`mobile-inbox`) — only live ID
   - `trm`, `spec`, `rewrite`, `kb`, `default` → `UNSET` — upload blocked if those slugs are used as destination folders
   Architecture correctly says: land everything in `mobile-inbox`, sort locally by frontmatter. Do **not** create sibling Drive folders per slug until ingest proves it needs them. Creating `trm-ingest` on Drive now would fork the buffer.
6. **Dual-agent collision.** Grok + Copilot writing the same inbox needs: unique `YYYY-MM-DDTHHMMSSZ__<topic>__<slug>.md`, ingest debounce, and `source:` field (`grok`|`copilot`) so catalog_ingest can attribute. Filename protocol already does uniqueness if clocks are UTC.
7. **CIC archival PDFs.** Scanned estate/FCSC packets can fail copy-protection or silent truncate at 500k words. Keep raw PDFs in vault; send NLM a text extract + citation pointer, not the 200 MB scan as the pack body.
8. **No official "token budget" for NotebookLM.** Architecture language "token budgets remain under NotebookLM's source file limits" is sloppy. The hard caps are **source count** and **words/MB per source**, plus rolling AI-usage quota. Pack compiler should budget words, not tokens.
9. **Inbox observed empty** at drop time (`google_drive_list_folder` on mobile-inbox returned zero items). First live drop after this review will test ingest debounce.

### What to implement vs what to park

**Implement now (SUPPORTED)**
- Keep one Drive landing folder: `mobile-inbox`.
- Require YAML: `source`, `skill`, `topic`, `title`, `created`, `folder_id`, `status`, `verdict`.
- Local dispatcher routes `topic:` to the vault table in the architecture doc.
- `kb-sync` emits scoped packs with a hard word cap per file (recommend 80k–120k words, well under 500k, so NLM retrieval stays sharp).
- Gap registry stays a git-tracked markdown file (`trm-research-gaps.md`), not an NLM note.

**Park until a human or enterprise API exists (REFUTED as automation)**
- Unattended `trm mine-notebooklm` against consumer Gemini Notebook.
- Assuming NLM will emit structured gap cards.

**Decide (UNKNOWN — needs one fact from Desktop)**
- Google AI plan tier on the NotebookLM account.
- Whether `trm-ingest-drive.mjs` already keys off `topic:` or only filename slug.
- Whether packs are uploaded as one concatenated source or as a folder of MD files (folder-of-files burns source slots 1:1).

## Next

Desktop `catalog_ingest` / morning pipeline: ingest this drop as topic `trm`. Do not treat the mermaid diagram as a shipped spec. Open two follow-up gaps:

1. `trm`: confirm live Gemini Notebook plan + source/usage quotas from the account UI (primary evidence).
2. `spec`: define pack compiler contract — max words per pack file, split rule, whether NLM source = one pack file or many.

Grok will not create extra Drive topic folders. Map `trm` folder_id only if ingest must read a folder other than mobile-inbox.
