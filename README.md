# Knowledge Base Sync Pipeline (`kb-sync`)

The `kb-sync` pipeline provides automated knowledge management, synthesis, and real-time retrieval for engineering artifacts, architecture decision records, and deep research matrices across local workspaces and external targets.

---

## Core systems

### 1. Topic Research Matrix (TRM) closed-loop pipeline
The TRM pipeline ingests structured research payloads, enforces strict semantic validation (checksum verification, directory traversal protection, and orphan file rejection), and synthesizes structured wiki nodes and conceptual linkage graphs.

- **Staging directory**: `_kb-sync-staging/trm/`
- **Output directories**: `wiki/research/`, `wiki/concepts/`, and `obsidian/vault/wiki/`
- **Execution command**: `npm run kb:pipeline:trm`

### 2. Competitor Watchlist & Drift Monitoring (`watch-competitors-v2.mjs`)
Automated daemon for monitoring competitor codebases and upstream specifications (e.g., Google SAM, Volcengine OpenViking) against local Layer 2 reference baselines.

- **Security & SSRF mitigation**: Pins DNS queries directly to socket connections, blocking private IP ranges, cloud metadata endpoints, loopback addresses, and unauthorized schemes.
- **Drift detection**: Performs SHA-256 target hash comparison, triggering zero token spend on cache hits and executing longest common subsequence (LCS) line diffs on drift.
- **Sigil governance gate**: Constructs RFC 8785 canonicalized, Ed25519-signed Sigil v1.0.0 envelopes persisted into SQLite `local_approvals` for human-in-the-loop review.
- **Execution commands**:
  - Run monitor: `npm run trm:watch`
  - Run integration validation: `npm run test:watchlist`
  - Run test suite: `npm run test:trm:watch`

### 3. Local SQLite context cache
An embedded SQLite database utilizing `fts5` full-text search with BM25 ranking and Unicode tokenization. Provides sub-millisecond lexical search and snippet extraction without network latency.

- **Database path**: `.kb_cache/knowledge.db`
- **Schema tables**:
  - `kb_documents`: Primary document repository storing category, topic slug, relative file path, content, SHA-256 hash, and timestamps.
  - `kb_fts`: Virtual FTS5 table synchronized via database triggers (`AFTER INSERT`, `AFTER UPDATE`, and `AFTER DELETE`).
- **Sync script**: `npm run kb:cache:sync`

### 4. Model Context Protocol (MCP) server
Exposes the local SQLite context cache directly to interactive coding agents (e.g., Antigravity, Claude Desktop, Cursor) via stdio JSON-RPC.

- **Server entrypoint**: `scripts/mcp-memory-server.mjs`
- **Protocol**: JSON-RPC 2.0 over stdio (supports standard MCP handshake: `initialize`, `tools/list`, `tools/call`, `ping`).
- **Exposed tools**:
  - `query_context_cache`: BM25 lexical keyword search across cached research nodes with highlight snippets.
  - `fetch_topic_note`: Direct retrieval of full markdown documents and metadata by topic identifier.

---

## Operating commands

### Competitor watchlist monitoring
```bash
# Monitor competitor targets and evaluate drift
npm run trm:watch

# Execute SQLite foreign-key and Sigil approval integration test
npm run test:watchlist

# Run complete watcher unit & vitest suites
npm run test:trm:watch
```

### Cache management & MCP server
```bash
# Ingest and update the local SQLite FTS5 cache from disk
npm run kb:cache:sync

# Run the MCP memory server in stdio mode
npm run kb:cache:server

# Execute context cache & MCP test suite
npm run test:cache
```

### TRM closed-loop synthesis
```bash
# Validate staged TRM batch payloads
npm run wiki:validate-staging:trm

# Synthesize staged TRM notes into wiki nodes
npm run wiki:ingest:trm:offline

# Execute end-to-end TRM pipeline (validation -> ingest -> contract validation -> cache sync)
npm run kb:pipeline:trm

# Run TRM verification test suite
npm run test:trm
```

### Vault contract & integrity checks
```bash
# Validate vault formatting, frontmatter, and absolute wiki-link contracts
npm run wiki:validate-contract

# Run complete test suite
npm run test:all
```

---

## MCP agent configuration

Add the following definition to your MCP client configuration (`.gemini/antigravity/mcp_config.json` or `mcp_config.json`):

```json
{
  "mcpServers": {
    "kb-context-cache": {
      "command": "node",
      "args": ["C:/dev/kb-sync/scripts/mcp-memory-server.mjs"],
      "env": {
        "KB_CACHE_DB": "C:/dev/kb-sync/.kb_cache/knowledge.db"
      }
    }
  }
}
```
