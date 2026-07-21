# Pack-Based Knowledge Management

**Type**: System Design Pattern  
**Domain**: kb-sync architecture  
**Status**: Active

---

## Problem

How do you capture a snapshot of an entire repository (source code, docs, configs) at a point in time and make it available to LLMs without requiring real-time API access to version control or network calls?

**Naive approach**: Feed each file individually to the LLM as separate uploads. Result: Fragmented context, no relationships, manual updates required.

**kb-sync approach**: Flatten the entire repository into a single knowledge pack — a concatenated text file with delimiters separating files — then reference that pack by file path. Update the pack on each sync run.

---

## Solution

### Architecture

**Knowledge Pack**: A single `.txt` file (`.nlm_pack/repo_knowledge_pack.txt`) containing:
- All repository files concatenated with delimiters (`--- START FILE: path/to/file ---`)
- File extension filtering (configurable in `configs/`)
- Exclusion patterns applied (globs from `configs/global.yaml`)
- Optional chunking for size management (splits kept intact via `chunk.sh`)

### Usage Pattern

1. Run `npm run kb:sync` → generates `.nlm_pack/repo_knowledge_pack.txt`
2. Pass pack path to LLM or wiki synthesis process
3. Reference specific file delimiters within the pack for context
4. Re-run sync on next update cycle → new pack generated

### Advantages

- **Deterministic**: Same repo state → same pack content (bit-identical)
- **Offline-capable**: No network calls required during synthesis
- **Auditable**: Pack is immutable; changes tracked via staging timestamps
- **Selective**: Skip patterns and extension filters reduce noise
- **Scalable**: Chunking handles large repos

---

## Examples

**Example Pack Structure** (conceptual):

```
--- START FILE: .github/workflows/validate-staging.yml ---
[YAML content]
--- END FILE: .github/workflows/validate-staging.yml ---

--- START FILE: core/flatten.sh ---
[Bash script content]
--- END FILE: core/flatten.sh ---

--- START FILE: README.md ---
[Markdown content]
--- END FILE: README.md ---
```

**LLM Usage**: "In `.nlm_pack/repo_knowledge_pack.txt`, search for `--- START FILE: core/flatten.sh ---` to see the flattening logic."

---

## Integration with Other Concepts

- [[immutable-staging]] — Pack sources come from immutable staging layer
- [[deterministic-sync-pipeline]] — Pack generation is deterministic and reproducible
- [[manifest-mode]] — Alternative to pack: generate manifest-only for file discovery

---

## Related Entities

- [[flatten.sh]] — Generates packs
- [[chunk.sh]] — Handles pack size management
- [[validate.sh]] — Validates pack integrity

---

## Configuration

Defined in `configs/` per sync target:

| Setting | Example | Purpose |
|---------|---------|---------|
| `include_extensions` | `[".ts", ".md", ".yaml"]` | Only include these files |
| `skip_patterns` | `["*node_modules/*", "*.png"]` | Exclude patterns |
| `chunk_size` | `4M` | Split size if exceeded |

---

## Metadata

- **Introduced**: kb-sync v1.0  
- **Format**: Plain text with delimiters (human-readable, LLM-friendly)  
- **Ingest Date**: 2026-07-20  
- **Last Updated**: [TBD]
