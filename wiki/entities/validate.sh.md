---
type: entity
tags: [core, validation, quality]
created: 2026-08-01
---

# `validate.sh`

`core/validate.sh` executes structural integrity checks against staged outputs and generated knowledge packs.

## Validations Performed

- **File Existence**: Asserts required pack structures and `manifest.txt`.
- **Non-Empty Checks**: Verifies pack output sizes >0 bytes.

## Related Scripts

- [[run-all.sh]]
- [[flatten.sh]]
