# Operator Workflow: Wiki Semantic Synthesis

Complete guide for running a wiki semantic ingest session via Claude Code.

---

## Prerequisites

- `npm run kb:sync` or `npm run kb:sync:all` completed (pack generated)
- Wiki initialized: `wiki/Index.md`, `wiki/Log.md`, `wiki/entities/`, `wiki/concepts/` exist
- Schema docs available: `modules/wiki/schema.md`, `modules/wiki/lint-rules.md`, `modules/wiki/update-rules.md`
- Claude Code session open with read/write access to repo

---

## Session Setup

### Step 1: Verify pack exists
```bash
ls -lh .nlm_pack/repo_knowledge_pack.txt
```

Expected: File exists, size ~3-15 MB (reasonable for repo)

### Step 2: Verify wiki root exists
```bash
ls -la wiki/
```

Expected output:
```
Index.md
Log.md
entities/
concepts/
```

### Step 3: Open wiki docs in tabs
Load these files in your editor/tabs (read-only):
- `modules/wiki/schema.md` — reference during entire session
- `modules/wiki/lint-rules.md` — reference during lint phase
- `modules/wiki/update-rules.md` — reference during update phase
- `wiki/Index.md` — reference and edit during update/log phases
- `wiki/Log.md` — reference and edit during log phase

---

## Phase 1: Ingest (Identify Changes)

**Goal:** Read pack, identify all new/updated entities and concepts.

### 1.1 Load and scan pack
```bash
head -100 .nlm_pack/repo_knowledge_pack.txt
tail -100 .nlm_pack/repo_knowledge_pack.txt
```

Skim to understand structure: you'll see file delimiters and code.

### 1.2 Identify new entities
- List all source files in pack (grep "--- START FILE:" for file names)
- For each file, note: name, type (script/module/config/doc/etc.), purpose
- Cross-check against existing `wiki/entities/` — flag files not yet documented

**Ingest prompt for Claude Code:**
```
Read .nlm_pack/repo_knowledge_pack.txt and identify all source files (functions, classes, modules, scripts).
For each one not yet in wiki/entities/, produce:
  - Filename/function name
  - Type (Function/Class/Module/Script/Config/Doc/etc.)
  - One-line summary (purpose/what it does)
  
Format output as a table: Name | Type | Location | Summary
```

### 1.3 Identify new concepts
- Scan pack for architectural decisions, design patterns, operational rules, governance principles
- Examples: "Fail-soft orchestration", "Manifest mode", "Three-layer vault architecture"
- Cross-check against existing `wiki/concepts/` — flag concepts not yet documented

**Ingest prompt for Claude Code:**
```
Based on the pack content, identify all key concepts, patterns, principles, and architectural decisions not yet in wiki/concepts/.
For each new concept, produce:
  - Concept name
  - Type (Pattern/Principle/Architecture/Rule/Workflow/etc.)
  - Domain (kb-sync/wiki/notebooklm/obsidian/etc.)
  - Definition (one sentence)
  - Which entities depend on this concept

Format as: Name | Type | Domain | Definition | Dependent Entities
```

### 1.4 Identify changed relationships
- Compare pack against Log.md's last entry (look for "pack hash" in last log entry)
- For each entity, note: new callers, new callees, changed behavior
- For each concept, note: new examples, refined definition

**Changed relationships prompt for Claude Code:**
```
For each entity that exists in wiki/entities/, check if its "Calls" or "Attributes" sections need updating based on the pack.
Produce:
  - Entity name
  - Section (Calls/Attributes/Side Effects)
  - Old value (from existing page)
  - New value (from pack)
  
Mark as [NEEDS UPDATE] if pack shows a change.
```

### 1.5 Identify stale pages
- Scan existing entity pages for references to files/functions that no longer exist in pack
- Scan existing concept pages for examples that are no longer relevant

**Stale detection prompt for Claude Code:**
```
Check each existing wiki/entities/*.md page.
For each Source Citation (file paths, line numbers), verify that file still exists in the pack.
If a file no longer exists in pack, mark as [STALE].
Do the same for wiki/concepts/*.md pages.

Output: List of stale pages with reason (file removed, behavior obsolete, concept deprecated).
```

### 1.6 Output: Ingest Summary
Produce a summary document:
```
INGEST SUMMARY
==============

Entities to create: [N]
  - [Name] ([Type]) — [1-line summary]
  - ...

Entities to update: [M]
  - [Name] — [section to update, new value]
  - ...

Concepts to create: [P]
  - [Name] ([Type], domain: [Domain]) — [definition]
  - ...

Concepts to update: [Q]
  - [Name] — [what changed]
  - ...

Stale pages (to review): [R]
  - [Name] — [reason]
  - ...

Total changes: N new entities, M updates, P new concepts, Q concept updates
```

---

## Phase 2: Lint (Verify Current Wiki)

**Goal:** Check existing wiki for structural and semantic issues.

### 2.1 Load linting rules
Reference `modules/wiki/lint-rules.md`.

### 2.2 Structural lint
Run these checks against current wiki:

**Prompt for Claude Code:**
```
Using the lint-rules.md checklist, verify:

S1: All entities in wiki/Index.md have corresponding files in wiki/entities/
S2: All concepts in wiki/Index.md have corresponding files in wiki/concepts/
S3: All entity and concept files exist in Index.md (no orphans)
S4: All pages have required headers per template
S5: No duplicate entity/concept names

For each violation found, output:
  - Rule (S1/S2/etc.)
  - Violation (specific page or missing file)
  - Suggested fix
```

### 2.3 Referential lint
Check links and cross-references.

**Prompt for Claude Code:**
```
Check all [[ ]] links in wiki/ (all .md files):

R1: Find any [[Link]] that doesn't resolve to an existing entities/ or concepts/ page
R2: For each link A -> B, verify B has reciprocal link back to A (via Related X or Backlinks)
R3: Check for circular entity dependencies (A calls B, B calls A) — flag undocumented cycles
R4: Verify all Source Citations (file paths) exist in pack
R5: For cross-domain links, verify they're explained in "Why It Matters" or "Relationships"

Output violations: Link | Target | Issue | Fix
```

### 2.4 Semantic lint
Check for contradictions and staleness.

**Prompt for Claude Code:**
```
Check for semantic issues (SE rules):

SE1: Find contradictory concept definitions (same domain, conflicting definitions)
SE2: Check entity summaries against pack — flag summaries that don't match current code behavior
SE3: Find [Deprecated] or [Archived] pages without Log.md entry explaining why
SE4: Verify entity Attributes (Input/Output/Side Effects) match implementation in pack
SE5: Check Relationships (Called by/Calls) against actual call graph in pack

Output violations: Entity/Concept | Issue | Fix
```

### 2.5 Content quality lint
Check clarity and completeness.

**Prompt for Claude Code:**
```
Run content quality checks (C rules):

C1: Find summaries > 80 chars (too long)
C2: Find concept definitions that are unclear or too short (< 2 sentences)
C3: Find examples that are vague or generic (not tied to real code/entities)
C4: Find empty notes sections or boilerplate notes

Output: Page | Section | Issue | Suggested revision
```

### 2.6 Output: Lint Report
Produce a structured report:
```
LINT REPORT
===========

Structural violations: [N]
  - [Violation 1]: [Fix]
  - ...

Referential violations: [M]
  - [Violation 1]: [Fix]
  - ...

Semantic violations: [P]
  - [Violation 1]: [Fix]
  - ...

Content quality issues: [Q]
  - [Issue 1]: [Suggested fix]
  - ...

Total issues: [N+M+P+Q]
Blocker count: [number that must be fixed before commit]
```

### 2.7 Operator decision
Review lint report. For each issue:
- **Blocker** (structural, broken links, contradictions): must fix before proceeding
- **Warning** (stale, unclear, minor): fix if time permits, otherwise log as "deferred"
- **Info** (quality suggestions): consider but not mandatory

Proceed to Phase 3 only after all blockers are resolved.

---

## Phase 3: Update (Create & Modify Pages)

**Goal:** Create new entity/concept pages, update modified ones.

Reference: `modules/wiki/update-rules.md`

### 3.1 Create new entity pages
For each entity in "Entities to create" list:

**Prompt for Claude Code (per entity):**
```
Create a new entity page for: [EntityName]

Details from pack:
- Type: [Function/Class/Module/Script/etc.]
- Location: [File path]
- Summary: [What it does, why it exists]
- Input: [What it takes in]
- Output: [What it produces]
- Side Effects: [Anything else that happens]
- Source: [Pack file location, line range if known]

Using the entity.md template from modules/wiki/schema.md, generate the full page content.
Do NOT fill Relationships or Backlinks yet (will do in Phase 4).
File path should be: wiki/entities/[kebab-case-name].md

Return the complete markdown content.
```

Then:
1. Create file at `wiki/entities/[kebab-case-name].md` with generated content
2. Add entry to `wiki/Index.md` Entities section: `- [[EntityName]] — [1-line summary]`

### 3.2 Create new concept pages
For each concept in "Concepts to create" list:

**Prompt for Claude Code (per concept):**
```
Create a new concept page for: [ConceptName]

Details from pack:
- Type: [Pattern/Principle/Architecture/etc.]
- Domain: [kb-sync/wiki/notebooklm/obsidian/etc.]
- Definition: [Formal definition, 2-5 sentences]
- Why It Matters: [Problem it solves, benefit]
- Examples: [Real code examples from entities that use this]
- Related Concepts: [Other concepts this connects to, if any]

Using the concept.md template from modules/wiki/schema.md, generate the full page content.
Do NOT fill Related Concepts or Backlinks yet (will do in Phase 4).
File path should be: wiki/concepts/[kebab-case-name].md

Return the complete markdown content.
```

Then:
1. Create file at `wiki/concepts/[kebab-case-name].md` with generated content
2. Add entry to `wiki/Index.md` Concepts section: `- [[ConceptName]] — [1-line summary]`

### 3.3 Update existing entity pages
For each entity in "Entities to update" list:

**Prompt for Claude Code (per entity):**
```
Update entity page: wiki/entities/[kebab-case-name].md

Current content: [paste existing file content]

Changes needed (from ingest phase):
- [Section to update]: [old value] → [new value]
- ...

Update only the specified sections. Preserve Name, Type, Location.
Update "Last Updated" timestamp to today's date.

Return the updated markdown content (entire file).
```

Then:
1. Replace file content with updated markdown
2. If summary changed, update Index.md entry

### 3.4 Update existing concept pages
For each concept in "Concepts to update" list:

**Prompt for Claude Code (per concept):**
```
Update concept page: wiki/concepts/[kebab-case-name].md

Current content: [paste existing file content]

Changes needed (from ingest phase):
- [Section to update]: [old value] → [new value]
- ...

Update only the specified sections. Preserve Name, Type, Domain.
Update "Last Updated" timestamp to today's date.

Return the updated markdown content (entire file).
```

Then:
1. Replace file content with updated markdown
2. If definition changed, update Index.md entry

### 3.5 Handle stale pages (operator decision)
For each page in "Stale pages (to review)" list:

**Decision: Keep or delete?**

Option A: Keep with [Deprecated] status
```
Update wiki/[entities|concepts]/[name].md:
- Change Status to: [Deprecated]
- Add note: "Deprecated [YYYY-MM-DD]: [reason from pack]"
```

Option B: Delete
```
1. Remove from wiki/Index.md
2. Delete wiki/[entities|concepts]/[name].md
3. Mark for Log.md entry
```

### 3.6 Update Index.md metadata
After all updates:
```
1. Sort Entities and Concepts alphabetically
2. Ensure all entries have 1-line summaries
3. Update "Last Updated" timestamp: [YYYY-MM-DD HH:MM UTC]
4. Update "Pack Hash": [first 7 chars of pack SHA256]
```

**Prompt for Claude Code:**
```
Generate updated Index.md:

Current Index.md content: [paste]
New entities to add: [list]
Updated entities (new summaries): [list]
Entities to remove: [list]

Return complete Index.md with:
- All entities alphabetically sorted
- All concepts alphabetically sorted
- Updated timestamp and pack hash
- Cross-reference map (by category and domain)
```

---

## Phase 4: Cross-Reference (Linking)

**Goal:** Add bidirectional links between entities and concepts.

### 4.1 Add forward links
For each entity/concept page:

**Prompt for Claude Code (per page):**
```
Page: wiki/[entities|concepts]/[name].md

Current content: [paste]

Scan the content for mentions of other entities or concepts.
For each mention, add a link in format [[EntityName]] or [[ConceptName]].

List of pages to potentially link to:
- Entities: [list of entity names]
- Concepts: [list of concept names]

Return updated content with links added.
```

### 4.2 Add reciprocal links
For each link added in 4.1:

**Prompt for Claude Code:**
```
For each [[Link]] added to pages in Phase 4:

1. Find the target page: wiki/[entities|concepts]/[target-name].md
2. Check if it has a "Backlinks from" or "Related X" section
3. If not, add section: "Backlinks from:"
4. Add entry: "- [[SourcePage]]"

For each reciprocal link:
- Source page: [name]
- Target page: [name]
```

### 4.3 Rebuild cross-reference map
Update Index.md "Cross-Reference Map" section:

**Prompt for Claude Code:**
```
Analyze all entity and concept pages.
Build cross-reference map:

1. Group entities by Type (Function, Class, Module, Script, etc.)
2. Group concepts by Domain (kb-sync, wiki, notebooklm, obsidian, etc.)
3. For each group, list all members: entities, concepts
4. Show category-domain relationships (e.g., kb-sync functions depend on [X concepts])

Return updated "Cross-Reference Map" section for Index.md.
```

---

## Phase 5: Lint Again (Safety Check)

**Goal:** Re-run lint to verify Phase 3-4 changes didn't introduce new issues.

Run abbreviated lint:

**Prompt for Claude Code:**
```
Quick lint check (post-update):

R1: All [[Links]] in updated pages resolve to existing files
R2: All bidirectional links are reciprocal
R3: No pages missing from Index.md
R4: No orphan pages on disk not in Index.md
S5: No duplicate entity/concept names

Report any violations. If found, flag for fix before proceeding to Phase 6.
```

If any violations found, fix before proceeding.

---

## Phase 6: Log Entry

**Goal:** Record semantic update in Log.md (append-only).

### 6.1 Gather statistics
Count changes:
- Entities created: [N]
- Entities updated: [M]
- Entities deleted: [D]
- Concepts created: [P]
- Concepts updated: [Q]
- Concepts deleted: [R]
- Total cross-refs added/updated: [S]

### 6.2 Calculate pack hash
```bash
sha256sum .nlm_pack/repo_knowledge_pack.txt | cut -c1-7
```

Copy first 7 characters.

### 6.3 Generate log entry

**Prompt for Claude Code:**
```
Generate a log entry for Log.md:

Date/time: [YYYY-MM-DD HH:MM UTC] (use current timestamp)
Pack hash: [7-char hash from above]
Entities: created N, updated M, deleted D
Concepts: created P, updated Q, deleted R
Cross-refs: S added/updated
Lint violations found: [number, all resolved]
Lint violations deferred: [number, if any]

Key insights from this semantic pass:
- [1-line summary of major change 1]
- [1-line summary of major change 2]
- [any deprecations or removals]

Using the Log.md template format, generate the complete entry.
```

### 6.4 Append to Log.md
```
1. Open wiki/Log.md
2. Go to end of file
3. Paste generated log entry
4. Save
```

---

## Phase 7: Operator Review

**Goal:** Review all changes before commit.

### 7.1 Summary review

**Questions to answer:**
- [ ] Do all new pages match schema.md template?
- [ ] Do all updated pages reflect pack content?
- [ ] Are all links bidirectional?
- [ ] Is Index.md up-to-date with all entities/concepts?
- [ ] Is Log.md entry complete and accurate?
- [ ] Did lint pass (no blockers)?

### 7.2 Spot-check pages

**Prompt for Claude Code (optional):**
```
Spot-check these pages for quality:
- [List 3-5 pages created/updated this session]

For each, verify:
- Summary is accurate and concise
- Attributes/Definition match pack content
- Source citations are correct
- Links are meaningful (not generic)

Report any issues.
```

### 7.3 Approve or reject
If all checks pass: proceed to Phase 8 (Commit)
If issues found: return to Phase 3-4 (Update) to fix, then Phase 5 (Lint) again

---

## Phase 8: Commit

**Goal:** Record semantic changes to git.

### 8.1 Check git status
```bash
git status
```

Expected: Only `wiki/` directory changes, plus possibly `modules/wiki/` if templates were updated.

### 8.2 Stage changes
```bash
git add wiki/
git add modules/wiki/  # if docs were updated
```

### 8.3 Commit message
```
Commit message format:

feat(wiki): semantic synthesis from pack [hash]

- Created N entities, M concepts
- Updated P entities, Q concepts
- Added S cross-references
- Lint: [number] violations resolved, [number] deferred

Pack hash: [7-char hash]
Source: .nlm_pack/repo_knowledge_pack.txt
Session: [date, operator name (Claude Code supervised by Chris Sorensen)]
```

Example:
```
feat(wiki): semantic synthesis from pack abc1234

- Created 3 entities (ingest-obsidian.sh, core/flatten.sh, core/validate.sh)
- Created 1 concept (Manifest Mode)
- Updated 2 entities (kb-sync integration points)
- Added 8 cross-references
- Lint: 2 violations resolved (missing backlinks), 1 deferred (stale example)

Pack hash: abc1234
Source: .nlm_pack/repo_knowledge_pack.txt
Session: 2026-07-11, operated by Chris Sorensen (Claude Code)
```

### 8.4 Commit
```bash
git commit -m "$(cat <<'EOF'
feat(wiki): semantic synthesis from pack [hash]

- Created N entities, M concepts
- Updated P entities, Q concepts
- Added S cross-references
- Lint: [number] violations resolved, [number] deferred

Pack hash: [hash]
Source: .nlm_pack/repo_knowledge_pack.txt
Session: [date], Chris Sorensen
EOF
)"
```

### 8.5 Verify
```bash
git log --oneline -1  # should show new commit
git diff HEAD~1 -- wiki/  # should show only wiki changes
```

---

## Session Checklist

- [ ] Prerequisites verified (pack exists, wiki initialized, docs available)
- [ ] Phase 1: Ingest complete (new/updated entities/concepts identified)
- [ ] Phase 2: Lint complete (current wiki issues identified and resolved)
- [ ] Phase 3: Update complete (all pages created/updated)
- [ ] Phase 4: Cross-reference complete (all links bidirectional)
- [ ] Phase 5: Lint pass complete (no new violations introduced)
- [ ] Phase 6: Log entry appended to Log.md
- [ ] Phase 7: Operator review approved all changes
- [ ] Phase 8: Commit created and pushed

---

## Common Issues & Solutions

### Issue: "Page references non-existent file"
Fix: Either update Source Citations to point to correct file in pack, or remove dead citation.

### Issue: "Broken [[Link]]"
Fix: Check target page file name (should match kebab-case-name in link), or create missing page.

### Issue: "Stale concept definition"
Fix: Update Definition section to match current understanding of pack. Add note in Implementation/Governance section explaining change.

### Issue: "Two entities with conflicting behavior description"
Fix: Re-read pack, reconcile descriptions, add Implementation Note explaining difference.

### Issue: "Circular dependency A ↔ B"
Fix: Add note to each page explaining circularity, or restructure to break cycle (only if design allows).

