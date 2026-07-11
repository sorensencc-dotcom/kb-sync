# [ConceptName]

**Type:** [Pattern | Principle | Architecture | Rule | Workflow | Design Pattern | Governance Rule | etc.]  
**Domain:** [kb-sync | wiki | notebooklm | obsidian | general | etc.]  
**Status:** [Active | Deprecated | Proposed | etc.]  
**Last Updated:** [YYYY-MM-DD] via Log entry [[SemanticUpdateDate]]

---

## Definition

[Formal, precise definition of this concept. 2–5 sentences. Should be understandable without reading the rest of the page.]

Example:
> The fail-soft orchestration pattern is a multi-target execution strategy where the orchestrator invokes each target independently, continues execution even if one target fails, and reports per-target outcomes in a final summary. Failure of target A does not block target B.

---

## Why It Matters

[Context and motivation: What problem does this concept solve? What's the cost of ignoring it? What benefits come from following it?]

One paragraph explaining the value proposition and decision drivers.

---

## Subconcepts

[If this is a compound concept, list its parts.]

- **Subconcept1:** Brief definition
- **Subconcept2:** Brief definition
- **Subconcept3:** Brief definition

[If this concept has no subconcepts, write "None."]

---

## Related Concepts

[Other concepts this one connects to, depends on, or contrasts with.]

- [[Concept1]] — relationship (e.g., "builds on", "complements", "conflicts with")
- [[Concept2]] — relationship
- [[Concept3]] — relationship

[If no related concepts, write "None."]

---

## Examples

[Real, concrete examples from the codebase or workflows.]

**Example 1: [[Entity1]] implements this concept**
- Entity implements fail-soft by [specific mechanism]
- Result: [outcome]
- Code reference: `path/to/file.sh` line 45–55

**Example 2: [[Entity2]] violates this concept**
- Entity does [something that violates the concept]
- Consequence: [what went wrong]
- Notes: [any context or explanation]

**Example 3: [[Concept2]] depends on this concept**
- [[Concept2]] assumes [[ConceptName]] is in place
- If violated: [failure mode]

[At least 2 examples; up to 4. Examples should be specific (name actual entities/files), not generic.]

---

## Cross-References

### Entities That Use This Concept
[Which entities implement or depend on this concept?]

- [[Entity1]] — primary implementation
- [[Entity2]] — secondary usage
- [[Entity3]] — orchestrates usage

### Concepts This Concept Depends On
[Which other concepts must be understood first?]

- [[Concept1]] — foundational
- [[Concept2]] — prerequisite

### Backlinks From
[Which entities or concepts reference this one?]

- [[Entity4]]
- [[Concept5]]

---

## Source Citations

**Primary Source:** `docs/targets/obsidian.md` (wiki schema doc)  
**Implementation:** `modules/obsidian/ingest-obsidian.sh` (staging-only pattern)  
**Concept Origin:** [Link to where this concept was first documented or decided]  
**Pack Reference:** `--- START FILE: modules/obsidian/ingest-obsidian.sh ---` (Karpathy pattern implementation)

---

## Governance & Rules

[If this concept is part of governance, decision gates, or operational rules, document them here.]

**Enforcement:**
- [Rule 1] — who enforces, when, consequences
- [Rule 2] — who enforces, when, consequences

**Decision Gates:**
- [Gate 1] — when this rule is applied, who decides, criteria

**Exceptions:**
- [Exception 1] — condition, approval process

[If no governance rules apply, write "None — this is a descriptive pattern, not a constraint."]

---

## Rationale & History

[Why was this concept introduced? What problem did it solve? Any history or evolution?]

One or two paragraphs explaining the design decision and trade-offs.

Example:
> The three-layer wiki architecture was chosen to separate concerns: raw sources (immutable, source of truth), the wiki layer (LLM-maintained semantic structure, human-synthesized), and schema (configuration, not versioned per session). This avoids coupling the wiki to implementation details while maintaining auditability through the Log.md append-only audit trail. Trade-off: requires manual ingest sessions (not automated), but gains human review and oversight of synthesis quality.

---

## Related Pages

- See [[Concept1]] for the foundational pattern
- See [[Entity1]] for the primary implementation
- See [[Workflow1]] for this concept's role in practice
- See the [[Log.md]] for historical decisions about this concept

