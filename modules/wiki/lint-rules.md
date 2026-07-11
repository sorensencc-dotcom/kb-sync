# Wiki Linting Rules

Lint pass checks wiki for structural, semantic, and referential integrity.

---

## Structural Checks

### S1: All entities have pages
**Rule:** Every entity listed in `Index.md` must have a corresponding file in `entities/`.  
**Violation:** Missing entity page.  
**Fix:** Create page from template or remove entity from Index.md.

### S2: All concepts have pages
**Rule:** Every concept listed in `Index.md` must have a corresponding file in `concepts/`.  
**Violation:** Missing concept page.  
**Fix:** Create page from template or remove concept from Index.md.

### S3: All pages are listed in Index.md
**Rule:** Every entity or concept page must appear in `Index.md` under Entities or Concepts sections.  
**Violation:** Orphan page (exists on disk but not in Index.md).  
**Fix:** Add to Index.md, or delete page if no longer needed.

### S4: All pages have required headers
**Rule:** Entity pages must have: Name, Type, Location, Status, Summary, Attributes, Relationships, Cross-References, Source Citations.  
Concept pages must have: Name, Type, Domain, Status, Definition, Why It Matters, Examples, Cross-References, Source Citations.  
**Violation:** Missing required section.  
**Fix:** Add missing section(s) from template.

### S5: No duplicate entity/concept names
**Rule:** No two entities or concepts may have same name (case-insensitive).  
**Violation:** Duplicate name.  
**Fix:** Rename one to disambiguate, or merge into single page.

---

## Referential Integrity Checks

### R1: All `[[Links]]` are valid
**Rule:** Every markdown link in format `[[Name]]` must resolve to an existing entity or concept page.  
**Violation:** Broken link (page doesn't exist).  
**Fix:** Correct link name, or create linked page.

### R2: All bidirectional links are reciprocal
**Rule:** If page A has `[[B]]` in "Related" or "Calls" section, page B must have `[[A]]` in "Backlinks from" or "Called by" section.  
**Violation:** One-way link.  
**Fix:** Add reciprocal link to target page.

### R3: No circular entity dependencies
**Rule:** Entity A should not call Entity B if B calls A (unless explicitly documented as circular pattern).  
**Violation:** Undocumented circular dependency.  
**Fix:** Add note explaining circularity, or restructure to break cycle.

### R4: All source citations must exist in pack
**Rule:** Every `Source Citations` entry referencing a file must exist in `.nlm_pack/repo_knowledge_pack.txt`.  
**Violation:** Citation points to non-existent file.  
**Fix:** Correct file path or remove citation.

### R5: All cross-domain references must be documented
**Rule:** If entity in domain X references concept in domain Y, the relationship must be explained in "Why It Matters" or "Relationships" section.  
**Violation:** Unexplained cross-domain link.  
**Fix:** Add explanation of why domains are related.

---

## Semantic Checks

### SE1: No contradictory definitions
**Rule:** No two concept definitions may contradict each other within same domain.  
**Violation:** Contradictory definitions.  
**Fix:** Reconcile definitions, or clarify domain scope if they apply to different contexts.

### SE2: No outdated summaries
**Rule:** Entity summary (one-line + paragraph) must match current implementation in source pack.  
**Violation:** Summary describes old behavior.  
**Fix:** Update summary to match current pack content.

### SE3: No stale status markers
**Rule:** If page marked `[Deprecated]` or `[Archived]`, either remove it or document deprecation date in Log.md.  
**Violation:** Deprecated page with no log entry explaining why.  
**Fix:** Add deprecation entry to Log.md, or change status to Active/In Development.

### SE4: Attributes match implementation
**Rule:** Entity's "Attributes" section (Input, Output, Side Effects) must match source code behavior.  
**Violation:** Documented behavior differs from code.  
**Fix:** Update attributes or update source code and re-ingest.

### SE5: Relationships reflect call graph
**Rule:** Entity's "Called by" and "Calls" sections must match function/module call graph in source pack.  
**Violation:** Documented calls don't match code.  
**Fix:** Update relationships section.

---

## Content Quality Checks

### C1: All summaries are concise
**Rule:** Entity and concept one-line summaries should be ≤80 characters.  
**Violation:** Summary too long.  
**Fix:** Condense to one sentence.

### C2: All definitions are clear
**Rule:** Concept definitions should be understandable without reading rest of page (min 2 sentences, max 5).  
**Violation:** Definition unclear or incomplete.  
**Fix:** Rewrite for clarity.

### C3: All examples are specific
**Rule:** Examples should reference actual entities or code, not generic patterns.  
**Violation:** Vague or generic examples.  
**Fix:** Replace with real code examples from pack.

### C4: All notes are documented
**Rule:** If page has "Implementation Notes" or "Governance Notes", they should explain non-obvious behavior or decisions.  
**Violation:** Notes are empty or generic.  
**Fix:** Add specific, actionable notes, or remove section.

---

## Workflow for Lint Pass

1. **Load existing wiki:** Index.md, all entity and concept pages
2. **Structural checks:** Run S1–S5, report orphans/duplicates
3. **Referential checks:** Run R1–R5, report broken/one-way links
4. **Semantic checks:** Run SE1–SE5, report contradictions/staleness
5. **Content quality:** Run C1–C4, report unclear content
6. **Flag issues:** Produce list of violations with page name, violation type, and suggested fix
7. **Operator review:** Operator approves fixes or defers to next ingest cycle
8. **Log entry:** Append lint summary to Log.md

---

## Exit Criteria for Lint Pass

- [ ] No structural violations (all pages in Index.md, Index.md reflects disk)
- [ ] No broken or one-way links
- [ ] No contradictory definitions within same domain
- [ ] No stale status markers without log entry
- [ ] All entity summaries match current source behavior
- [ ] All cross-domain links are documented

