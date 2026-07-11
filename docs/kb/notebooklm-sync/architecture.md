# NotebookLM Sync Pipeline: Architecture

This document describes the architectural layout and component flow for the deterministic synchronization loop between the Rewrite Labs / CIC monorepo and Google NotebookLM.

## Component Topology

The Ingestion loop connects our filesystem state directly to our NotebookLM instances using the following flow:

```
[Local Codebase] ──> [pyragify] ──> [Combined Pack] ──> [NotebookLM MCP] ──> [NotebookLM API] 
                                                                                   │
                                                                                   ▼
[Claude Desktop / Cursor] <────────────────────────────────────────────────────────┘
```

1. **Local Codebase**: The source of truth containing code (`.ts`, `.py`, etc.) and docs (`.md`).
2. **pyragify**: A repository flattener that filters, chunks, and processes files according to exclusion rules.
3. **Combined Pack (`repo_knowledge_pack.txt`)**: A single consolidated text file containing all codebases with file delimiters. This avoids NotebookLM's 50-source limit and ensures a clean retrieval target.
4. **NotebookLM MCP / CLI**: The bridge that programmatically invokes the Google NotebookLM backend to purge old sources and upload the fresh pack.
5. **NotebookLM API**: Serves the updated model/notebook content.
6. **MCP Clients (Claude Desktop / Cursor / Windsurf)**: Consume the refreshed notebook directly as a live knowledge base.

## Integration with Agent Mesh

By exposing the monorepo to NotebookLM dynamically, we provide our autonomous agent mesh (CIC agents) with a version-controlled, up-to-date, and groundable memory layer. The agents can query NotebookLM via the `notebooklm-mcp` client, ensuring they are always executing instructions using the latest codebase and documentation standards.

## See Also
- [Pipeline Execution Guide](./pipeline.md)
- [Operator Rules](./operator-rules.md)
