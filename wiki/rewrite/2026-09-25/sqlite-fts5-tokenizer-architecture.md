---
source: copilot
skill: drive-it
topic: rewrite
title: "SQLite FTS5 Tokenizer Architecture Guidelines"
created: 2026-09-25T20:06:49Z
folder_id: 1Faya0q0j3S62NGq_U-nxrefwbwfGQq0g
status: drop
---

## Findings Summary

SQLite's official FTS5 documentation defines tokenizers as a pluggable subsystem specified at
`CREATE VIRTUAL TABLE` time via the `tokenize=` option. Four tokenizers ship built-in: `unicode61` (the
default, full Unicode-aware tokenization with configurable diacritic removal), `ascii`, `porter` (adds
English stemming on top of another tokenizer), and `trigram` (an experimental fixed-width tokenizer aimed at
substring/`LIKE`-style matching rather than word matching). Tokenizers are also invoked in different contexts
(document indexing vs. query parsing), and FTS5 exposes an API for registering fully custom tokenizers,
including built-in synonym support.

## Primary Citations & Specifications

- [SQLite FTS5 Extension — official documentation](https://sqlite.org/fts5.html) — Section 4.3 "Tokenizers" defines the four built-in tokenizers (`unicode61`, `ascii`, `porter`, `trigram`) and their configuration options; Section 7 "Extending FTS5" documents the custom tokenizer registration API and synonym support (7.1.1).
- [SQLite FTS5 Tokenizers: `unicode61` and `ascii` — audrey.feldroy.com](https://audrey.feldroy.com/articles/2025-01-13-SQLite-FTS5-Tokenizers-unicode61-and-ascii) — practical worked comparison (via the APSW Python binding) of the two tokenizers' handling of case, diacritics, CJK text, and emoji, citing the SQLite source file `fts5_tokenize.c` directly.

## Contradictions or Open Gaps

- The official `sqlite.org/fts5.html` page documents tokenizer *behavior and configuration* but not the
  internal module layout. A reverse-engineered breakdown (module-by-module: `fts5_tokenize.c` for built-in
  tokenizers, `fts5_hash.c` for the in-memory pending-token table, etc.) is only available from a third-party,
  auto-generated source (DeepWiki), not from SQLite's own documentation — that structural detail should be
  cross-checked against the actual `ext/fts5/` source tree before being treated as authoritative, since it
  wasn't corroborated by an official SQLite source in this pass.
- The `trigram` tokenizer is still marked experimental in the official docs — worth confirming its current
  stability before depending on it for a production tokenizer architecture decision.
