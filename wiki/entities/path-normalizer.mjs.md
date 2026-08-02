---
type: entity
tags: [core, path-normalization, cross-platform]
created: 2026-08-01
---

# `path-normalizer.mjs`

`core/path-normalizer.mjs` provides centralized cross-platform path normalization across Windows, Git Bash, MSYS, and Linux environments.

## Responsibilities

- **Drive Mount Conversion**: Converts Windows drive letters (`C:\dev\`) into Git Bash (`/c/dev/`) or WSL (`/mnt/c/dev/`) formats.
- **Path Sanitization**: Strips duplicate slashes and normalizes trailing separators.

## Related Entities & Tests

- [[run-all.sh]]
- [[path-normalizer-verification.ts]]
