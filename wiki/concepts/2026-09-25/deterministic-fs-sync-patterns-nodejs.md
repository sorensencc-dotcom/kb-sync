---
source: copilot
skill: drive-it
topic: kb
title: "Deterministic File System Sync Patterns in Node.js"
created: 2026-09-25T20:06:50Z
folder_id: 1Faya0q0j3S62NGq_U-nxrefwbwfGQq0g
status: drop
---

## Findings Summary

Node's official `fs` module documents synchronous, callback, and promise-based forms of every file operation;
`fs.writeFileSync` blocks the event loop, creates the file if absent, and overwrites/truncates by default.
None of this is "deterministic" under interruption on its own: a plain truncate-then-write leaves a window
where a crash or power loss produces a corrupted or empty file, because the write is happening in place on the
target inode over a nonzero span of time. The standard fix — documented consistently across the Node ecosystem
though not inside Node's own API reference — is the temp-file-plus-rename pattern: write full content to a
temp file in the *same directory* as the target, optionally `fsync` that file descriptor for durability, then
rename the temp file over the target in one step. POSIX `rename()` is a single directory-entry metadata update,
so any reader of the target path sees either the fully-old or fully-new content, never a partial write — but
only when source and destination share a filesystem; a cross-filesystem rename either fails with `EXDEV` or
silently falls back to copy-then-delete in higher-level tools, which reintroduces the exact corruption window
the pattern exists to avoid.

## Primary Citations & Specifications

- [File system | Node.js v26.10.0 Documentation](https://nodejs.org/api/fs.html) — official Node.js API reference; documents `fs.writeFileSync`, `fs.renameSync`, and the sync/callback/promise API surface, but does not itself document an atomic-write recipe.
- [`write-file-atomic` — npm](https://www.npmjs.com/package/write-file-atomic) — the de facto standard implementation of the pattern (1,650+ dependent packages): writes to a uniquely-named temp file beside the target, fsyncs by default, then renames over the target filename; documents that concurrent writes to the same file are serialized.
- [Is `rename()` atomic? — clarified via the Linux `rename(2)` semantics discussion](https://stackoverflow.com/questions/7054844/is-rename-atomic) — corroborates that `rename()` guarantees a reader sees either the old or new file content and never a mix, conditioned on same-filesystem rename and barring an OS crash mid-operation; used here only to confirm kernel-level rename semantics, not as a design recommendation.

## Contradictions or Open Gaps

- Node.js's own official documentation does not describe the temp-file+rename atomic-write pattern or the
  fsync-before-rename durability requirement anywhere in the `fs` module reference — this is a real gap in
  primary-source coverage. The pattern is universally used in practice but is only documented by third-party
  packages and community write-ups, not by Node.js itself.
- Atomicity and durability are frequently conflated: `rename()` alone guarantees atomicity (no torn/partial
  file) but not durability (surviving power loss), which requires an explicit `fsync`/`fdatasync` call on the
  temp file before the rename — a distinction the community sources are consistent on, but which has no
  single authoritative Node.js statement to cite.
