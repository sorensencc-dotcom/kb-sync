# [EntityName]

**Type:** [Function | Class | Module | System | Script | Config | File | etc.]  
**Location:** [File path in repo, e.g., `modules/obsidian/ingest-obsidian.sh`, or N/A if abstract]  
**Status:** [Active | Deprecated | In Development | Archived]  
**Last Updated:** [YYYY-MM-DD] via Log entry [[SemanticsUpdateDate]]

---

## Summary

[One sentence: What is this entity? What role does it play?]

[One paragraph: Expand on purpose, design intent, and context. Why does it exist? Who uses it? What problem does it solve?]

---

## Attributes

### Input
[What does this entity accept as input? Parameters, file paths, environment variables, stream data, etc.]

### Output
[What does this entity produce or emit? Return values, files written, state changes, log output, etc.]

### Side Effects
[Any effects beyond primary input→output flow? Files modified, state changed, external systems called, etc. If none, write "None."]

### Performance Characteristics
[Speed (O(n), constant-time?), memory usage, scaling limits, throughput, latency expectations. If not applicable, write "N/A."]

### Constraints & Limits
[What can't this entity do? Preconditions, invariants, things that would break it. If none, write "None."]

---

## Relationships

### Called By
[Which other entities call/invoke this one? List: [[Entity1]], [[Entity2]]]

### Calls / Depends On
[Which other entities does this entity call/invoke/depend on? List: [[Entity3]], [[Entity4]]]

### Related Concepts
[Which concepts or patterns does this entity implement/use? List: [[Concept1]], [[Concept2]]]

### Participates In Workflows
[Which workflows or operations use this entity? List: [[Workflow1]], [[Workflow2]]]

---

## Cross-References

### Bidirectional Links
[Links appear here automatically during Cross-Reference Phase. LLM: ensure reciprocals exist.]

- Related entities: [[Entity5]], [[Entity6]]
- Related concepts: [[Concept3]]
- Backlinks from: [[Entity7]], [[Concept4]]

---

## Source Citations

**Primary Source:** `path/to/file.sh` lines 10–45  
**Secondary Source:** `path/to/related-file.md` lines 5–20  
**Pack Reference:** `--- START FILE: path/to/file.sh ---` to `--- END FILE: path/to/file.sh ---`

[If multiple sources, list them all with line ranges if known. If this is a conceptual entity (not directly in source), write "N/A — derived from multiple sources" and list them.]

---

## Implementation Notes

[Non-obvious architectural decisions, gotchas, design rationale, or behavioral nuances that aren't clear from code alone. Examples:
- "Fails gracefully if X is missing (doesn't crash the pipeline)"
- "Uses mapfile instead of while-read to avoid subshell issues"
- "Path normalization handles both Windows backslashes and Unix forward slashes"
- "Manifest mode is used by Obsidian; default mode used by NotebookLM"

If no special notes, write "None."]

---

## Related Pages

- See [[Concept1]] for the design pattern this entity implements
- See [[Entity3]] for how this entity is orchestrated
- See [[Workflow1]] for this entity's role in the broader workflow

