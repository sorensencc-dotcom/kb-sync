# Knowledge Base Index

**Last Updated:** [YYYY-MM-DD HH:MM UTC]  
**Pack Hash:** [abc1234]  
**Total Entities:** [N]  
**Total Concepts:** [M]

---

## Entities

### Core Infrastructure
- [[Entity1]] — One-line summary of what this entity is/does
- [[Entity2]] — One-line summary
- [[Entity3]] — One-line summary

### Modules & Orchestration
- [[Entity4]] — One-line summary
- [[Entity5]] — One-line summary

### Configuration & Rules
- [[Entity6]] — One-line summary
- [[Entity7]] — One-line summary

---

## Concepts

### Architecture & Design
- [[Concept1]] — One-line summary of principle/pattern
- [[Concept2]] — One-line summary
- [[Concept3]] — One-line summary

### Operations & Workflows
- [[Concept4]] — One-line summary
- [[Concept5]] — One-line summary

### Data Structures & Formats
- [[Concept6]] — One-line summary
- [[Concept7]] — One-line summary

---

## Cross-Reference Map

### By Entity Type

#### Functions
- [[FunctionEntity1]], [[FunctionEntity2]], [[FunctionEntity3]]
- Depends on: [[Concept1]], [[Concept2]]

#### Classes/Modules
- [[ClassEntity1]], [[ClassEntity2]]
- Depends on: [[Concept3]]

#### Scripts
- [[ScriptEntity1]], [[ScriptEntity2]]
- Depends on: [[Concept4]], [[Concept5]]

#### Configuration
- [[ConfigEntity1]]
- Applies to: [[FunctionEntity1]], [[ScriptEntity1]]

### By Concept Domain

#### kb-sync Domain
- **Entities:** [[Entity1]], [[Entity2]], [[Entity3]]
- **Concepts:** [[Concept1]], [[Concept2]], [[Concept3]]
- **Relationships:** Entities implement concepts

#### wiki Domain
- **Entities:** [[Entity4]], [[Entity5]]
- **Concepts:** [[Concept4]], [[Concept5]]
- **Relationships:** Entities support wiki synthesis workflows

#### notebooklm Domain
- **Entities:** [[Entity6]], [[Entity7]]
- **Concepts:** [[Concept6]]
- **Relationships:** Entities orchestrate NotebookLM sync

#### obsidian Domain
- **Entities:** [[Entity8]], [[Entity9]]
- **Concepts:** [[Concept7]]
- **Relationships:** Entities stage content for human wiki synthesis

### Inter-Concept Dependencies

```
Concept1 (Manifest Mode)
  └─ depends on ─> Concept2 (Flatten Pipeline)
                    └─ depends on ─> Concept3 (Selective Inclusion)

Concept4 (Fail-Soft Orchestration)
  ├─ depends on ─> Concept5 (Independent Module Execution)
  └─ depends on ─> Concept6 (Error Isolation)

Concept7 (Three-Layer Wiki)
  ├─ depends on ─> Concept8 (Raw Sources, Immutable)
  ├─ depends on ─> Concept9 (Synthesis, LLM-Maintained)
  └─ depends on ─> Concept10 (Schema, Config-Driven)
```

---

## Recent Changes

See [[Log.md]] for complete audit trail of all semantic updates.

**Last 3 updates:**
- [YYYY-MM-DD HH:MM] [Brief summary of changes]
- [YYYY-MM-DD HH:MM] [Brief summary of changes]
- [YYYY-MM-DD HH:MM] [Brief summary of changes]
