---
title: Post-war and Willys-Overland notebooks got empty packs because their notes are tagged as research
author: Chris
date: 2026-11-07
branch: fix/pack-topic-bucket-fallback
id: l-401b9757
scope: repo
status: active
src: agent
touches:
  - ".sync-status.json"
  - TODOS.md
  - "_status-feed/chat_injection_audit.json"
  - core/harvest_registry.json
  - modules/wiki/daily_status.json
  - obsidian/vault/wiki/Index.md
  - obsidian/vault/wiki/Log.md
  - obsidian/vault/wiki/kb-sync/wiki/.Catalog.md
  - obsidian/vault/wiki/kb-sync/wiki/.CoverageReport.md
  - obsidian/vault/wiki/kb-sync/wiki/.CrossRepoDriftReport.md
---

In the code: scripts/consolidate-pack.mjs (resolveFilenameBuckets, bucketing loop), tests/consolidate-pack-filename-buckets.test.mjs, core/config.mjs resolveCategoryKey.

## Decided
Pack buckets for post-war and willys-overland now also match on the note's file name (post-war / post_war / willys), added on top of the frontmatter category. A note naming both topics lands in both packs. Notes keep their existing daily and master-kb placement.

## Tried and ruled out
Treating the empty packs as a replace-gate bug. The gate was right to refuse: both packs were built with FILE COUNT: 0, so it kept the existing sources. Retagging notes by hand was the other option; it was passed over because the research-gap notes are generated.

## Watch out
resolveCategoryKey('research') returns 'daily', so research-tagged notes were already in the daily pack and never reached a topic pack. A fallback that skips daily notes matches nothing. Real build after the change: 119 post-war and 121 willys-overland files. The live sync has not run, so those notebooks have not received them yet.
