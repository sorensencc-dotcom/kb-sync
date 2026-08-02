---
type: entity
tags: [wiki, validation, contract]
created: 2026-08-01
---

# `validate-contract.mjs`

`modules/wiki/validate-contract.mjs` enforces frontmatter schema contracts and link integrity across all markdown files in `wiki/`.

## Key Capabilities

- **Frontmatter Schema Validation**: Asserts required frontmatter fields (`type`, `tags`, `created`).
- **Link Structure Verification**: Asserts valid relative links and wikilink targets.

## Related Scripts

- [[audit-coverage.ts]]
- [[detect-drift.ts]]
