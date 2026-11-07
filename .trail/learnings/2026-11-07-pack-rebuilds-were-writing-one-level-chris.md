---
title: "Pack rebuilds were writing one level above the repo, so syncs kept uploading old parts"
author: Chris
date: 2026-11-07
branch: fix/pack-root-default
cost: { minutes: 1, tokens: 1489 }
id: l-ecbd97a2
scope: repo
status: active
src: agent
touches:
  - scripts/consolidate-pack.mjs
  - scripts/pipeline/cluster-sync-runner.mjs
  - scripts/nlm-pack-replace-gate.mjs
---

## Decided
- Packs build from the kb-sync research wiki (about 3,300 notes) and go to the pack folder inside the repo, the first folder the sync runner reads. The workspace-level wiki and pack folder were the wrong source: they held about 450 mostly stale notes.
- An atomic replace now skips a notebook when every staged pack has zero source files. This keeps its existing sources instead of swapping in a header-only pack.
- The obsidian vault is generated output (repo-file pages, conversations), not a research source and not a copy of the wiki. You don't need to open Obsidian for the pipelines to run.

## Tried and ruled out
- Re-running the live sync after the auth error. The failure was the agent sandbox blocking the NotebookLM cookie file, not a corrupt profile. With auth working, that run would have uploaded stale parts and could have emptied four notebooks.

## Watch out
- Green CI did not prove the rebuild fix worked. The tests injected their own paths, so the broken default never ran. Before a live sync, check which files the runner will actually pick and how old they are.
- A dry run skips the rebuild step, so it can't catch a wrong-folder bug.
- An auth failure quarantines each notebook it hits. After a failed run, clear only the entries that run created.
- Live syncs need to run outside the agent sandbox, after the user says yes, or in the user's own terminal.

In the code:
- `scripts/consolidate-pack.mjs` `DEFAULT_ROOT_DIR` was `path.resolve(__dirname, '../..')` and is now `'..'`.
- `scripts/pipeline/cluster-sync-runner.mjs` `DEFAULT_PACK_CANDIDATE_DIRS` reads `<repo>/.nlm_pack` first, then `../.nlm_pack`. The second is a fallback still to be removed.
- Before a live run, check what will upload: `findStagedPackFiles(notebook)`.
- Clear a quarantine entry with `clearQuarantine(notebookId)`. Entries live in `.nlm-quarantine.json`.
- `scripts/nlm-pack-replace-gate.mjs`: `readPackFileCount()` reads the `FILE COUNT: N` header line, and the replace returns `EMPTY_PACK_CONTENT` when every pack reports 0.
