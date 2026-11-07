---
title: Pack chunker missing from main left 10/5 parts in sync
author: Chris
date: 2026-11-07
branch: fix/restore-pack-chunker
cost: { minutes: 1, tokens: 986 }
id: l-5f5381b9
scope: repo
status: active
src: agent
touches:
  - trm-research-gaps.md
  - wiki/index-gap.md
---

decided: consolidate-pack.mjs shards every thematic pack through core/nlm-chunker.mjs and deletes any pack-family file (pack_X.txt or pack_X_partN.txt) the current build did not write.
why: the chunker landed in 68ad9d5f on feat/notebook-cluster-question-manifests and never reached main, so main wrote only the unsplit pack_master_kb.txt (6.1 MB). The sync runner always prefers _partN files for multipart notebooks, so master-kb and daily kept re-uploading parts left on disk on 2026-10-05.
watch out: two source files (trm-research-gaps.md ~1 MB, wiki/index-gap.md ~415 KB) are bigger than the 380 KiB ceiling alone; the chunker splits them into "(segment k of n)" pieces on line boundaries. Never re-add an unsplit pack beside its parts.
ruled out: the 3.5s upload pacing idea for status 3. Uploads run one at a time already.
