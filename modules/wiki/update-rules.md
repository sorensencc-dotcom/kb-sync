# Wiki Update Rules

Rules for rewriting entity and concept pages during semantic ingest.

---

## Phase: Ingest (Reading the Pack)

### I1: Identify all new entities
- Scan pack for new files/functions/classes not yet in `entities/`
- For each new entity, note: name, type (Function/Class/Module/etc.), file location, purpose

### I2: Identify all new concepts
- Scan pack for architectural decisions, patterns, principles not yet in `concepts/`
- For each new concept, note: name, type (Pattern/Principle/Architecture/etc.), domain, definition

### I3: Identify changed relationships
- Compare current pack against Log.md's last pack hash
- For each entity, note: new callers, new callees, changed attributes, updated side effects
- For each concept, note: new examples, new dependencies, refined definition

### I4: Identify stale pages
- Scan existing entity/concept pages for references to old code
- Flag for review in update phase

### Output of Ingest Phase
- List of new entities (name, type, location, summary)
- List of new concepts (name, type, definition)
- List of updated entities (page file, what changed)
- List of stale pages (page file, why stale)
- List of changed relationships (from entity, to entity, relationship type)

---

## Phase: Update (Rewriting Pages)

### U1: Create new entity pages
For each new entity:
1. Create file `entities/kebab-case-name.md`
2. Fill template: Name, Type, Location, Status (Active), Summary (one sentence + paragraph), Attributes (Input/Output/Side Effects), Relationships (initially empty, filled in cross-ref phase), Cross-References (initially empty), Source Citations (pack file location + line ranges)
3. Add to Index.md under Entities section

### U2: Create new concept pages
For each new concept:
1. Create file `concepts/kebab-case-name.md`
2. Fill template: Name, Type, Domain, Status (Active), Definition (2–5 sentences), Why It Matters (paragraph), Subconcepts (list), Related Concepts (initially empty, filled in cross-ref phase), Examples (pull from pack or existing entities), Cross-References (initially empty), Source Citations
3. Add to Index.md under Concepts section

### U3: Update existing entity pages
For each modified entity:
1. Open file `entities/kebab-case-name.md`
2. Update: Summary (if behavior changed), Attributes (if Input/Output/Side Effects changed), Relationships (if callers/callees changed), Source Citations (add new file references)
3. Do NOT change: Name, Type, Location (unless entity moved in repo)
4. Update "Last Updated" timestamp
5. Status remains Active unless pack indicates deprecated

### U4: Update existing concept pages
For each modified concept:
1. Open file `concepts/kebab-case-name.md`
2. Update: Definition (if concept refined), Examples (add new examples from pack), Related Concepts (if new related concepts exist), Source Citations
3. Do NOT change: Name, Type, Domain (unless concept moved)
4. Update "Last Updated" timestamp
5. Status remains Active unless concept is deprecated

### U5: Remove stale pages
For each stale entity/concept:
1. Flag for operator review (do NOT auto-delete)
2. If operator approves deletion:
   - Remove from Index.md
   - Delete file from `entities/` or `concepts/`
   - Add deprecation entry to Log.md with reason
3. If operator defers:
   - Update page with [Deprecated] status and deprecation reason
   - Add note in Log.md: "Entity/Concept deprecated (deferred deletion)"

### U6: Update Index.md
After all entity/concept updates:
1. Rebuild entity list (alphabetical, with one-line summaries)
2. Rebuild concept list (alphabetical, with one-line summaries)
3. Rebuild cross-reference map (by category and domain)
4. Update "Last Updated" timestamp to current time
5. Update "Pack Hash" to first 7 chars of current pack's SHA256

---

## Phase: Cross-Reference (Linking)

### X1: Add "Related Entities" and "Related Concepts" sections
For each entity/concept page:
1. Scan its Relationships, Attributes, Definition for mentions of other entities/concepts
2. For each mention, add bidirectional link: `[[OtherEntity]]` or `[[OtherConcept]]`
3. Add reciprocal link to target page: target's "Backlinks from" section

### X2: Verify all links are bidirectional
For each `[[Link]]` in a page:
1. Find target page
2. Check target page has reciprocal link (in Related/Backlinks section)
3. If missing, add it

### X3: Update Index.md cross-reference map
1. Group entities by category (from "Type" field)
2. Group concepts by domain (from "Domain" field)
3. Create map: for each category/domain, list all entities/concepts in it
4. Rebuild cross-reference matrix showing category–domain relationships

---

## Phase: Lint (Verification)

After all updates:
1. Run all lint checks from lint-rules.md
2. Report violations
3. Operator approves fixes or defers

---

## Phase: Log (Audit Trail)

### L1: Prepare summary
Count:
- N entities created
- M entities updated
- P concepts created
- Q concepts updated
- R pages deleted
- S cross-refs added/updated

### L2: Record pack information
- Pack file path
- Pack hash (SHA256, first 7 chars)
- Pack modification timestamp

### L3: Append log entry
Format:
```
## [YYYY-MM-DD HH:MM UTC] Semantic update from pack [hash]

- Entities: N created, M updated, R deleted
- Concepts: P created, Q updated
- Cross-refs: S added/updated
- Lint violations: T reported, all resolved
- Operator: [Your Name]
- Notes: [Brief summary of changes, insights, decisions]

```

### L4: No editing old entries
Log.md is append-only. Never edit or delete past entries.

---

## Update Workflow Pseudocode

```
1. INGEST PHASE
   entities_new = []
   concepts_new = []
   entities_updated = []
   concepts_updated = []
   relationships_changed = []

   for file in pack:
     if not exists(entities/${file}):
       entities_new.append(file)
     elif file_changed_since_last_pack:
       entities_updated.append(file)

   for concept in identified_concepts(pack):
     if not exists(concepts/${concept}):
       concepts_new.append(concept)
     elif concept_definition_changed:
       concepts_updated.append(concept)

2. CREATE PHASE
   for entity in entities_new:
     create_file("entities/kebab-case.md", ENTITY_TEMPLATE)
     add_to_index(entity)

   for concept in concepts_new:
     create_file("concepts/kebab-case.md", CONCEPT_TEMPLATE)
     add_to_index(concept)

3. UPDATE PHASE
   for entity in entities_updated:
     update_file("entities/kebab-case.md", entity_changes)

   for concept in concepts_updated:
     update_file("concepts/kebab-case.md", concept_changes)

4. CROSS-REF PHASE
   for file in all_pages:
     links = extract_links(file)
     for link in links:
       if not exists_reciprocal(link, file):
         add_reciprocal_link(link, file)

5. LINT PHASE
   violations = lint_wiki()
   if violations:
     report_violations(violations)
     if operator_approves:
       fix_violations()

6. LOG PHASE
   log_entry = format_log_entry(changes, pack_hash, timestamp)
   append_to_log(log_entry)

7. DONE
   return success
```

---

## Safety Checks (Before Commit)

- [ ] All pages in Index.md exist on disk
- [ ] No orphan pages (all pages in Index.md)
- [ ] All `[[Links]]` are valid
- [ ] All bidirectional links are reciprocal
- [ ] No broken Source Citations
- [ ] All entity summaries match pack content
- [ ] No contradictory concept definitions
- [ ] Log.md was appended (not edited or overwritten)
- [ ] Commit message references pack hash and change counts
- [ ] No uncommitted changes outside `wiki/` directory (unless intentional)

