import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_DB_PATH = path.resolve(process.cwd(), '.kb_cache/knowledge.db');

export const SCHEMA_SQL = `
-- Core document metadata and content
CREATE TABLE IF NOT EXISTS kb_documents (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,         -- 'research', 'gap', 'audit', 'source'
  topic TEXT NOT NULL,            -- kebab-case topic identifier
  file_path TEXT NOT NULL,        -- path relative to repository root
  abstract TEXT,                  -- L0 abstract / summary for zero-hop resolution
  content TEXT NOT NULL,          -- raw markdown or JSON payload
  sha256 TEXT NOT NULL,           -- content hash for cache invalidation
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Full-Text Search (FTS5) index for lexical keyword retrieval
CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts USING fts5(
  id UNINDEXED,
  topic,
  content,
  tokenize = 'porter unicode61'
);

-- Triggers to maintain FTS synchronization
CREATE TRIGGER IF NOT EXISTS trg_kb_docs_ai AFTER INSERT ON kb_documents BEGIN
  INSERT INTO kb_fts(id, topic, content) VALUES (new.id, new.topic, new.content);
END;

CREATE TRIGGER IF NOT EXISTS trg_kb_docs_ad AFTER DELETE ON kb_documents BEGIN
  DELETE FROM kb_fts WHERE id = old.id;
  DELETE FROM kb_vectors WHERE id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_kb_docs_au AFTER UPDATE ON kb_documents BEGIN
  DELETE FROM kb_fts WHERE id = old.id;
  INSERT INTO kb_fts(id, topic, content) VALUES (new.id, new.topic, new.content);
END;

-- Dense Vector Embedding Store for Hybrid Semantic Search (Path B)
CREATE TABLE IF NOT EXISTS kb_vectors (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  embedding BLOB NOT NULL,
  dimensions INTEGER NOT NULL,
  model TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Remote NotebookLM grounded-answer cache (L2 fallback write-back).
-- Keyed by normalized query hash; invalidated whenever pack_generation_sha
-- no longer matches the currently active knowledge pack (see
-- modules/notebooklm/ingest-notebooklm.sh last_sync_pack_sha), or by ttl_ms.
--
-- NOTE: this table + scripts/mcp-memory-server.mjs's invalidateStaleCache()
-- are prep infrastructure only (RFC-NLM-05 Phase 4 as locked). Nothing yet
-- writes a row here on an nlm_chat_json call or reads one back to serve a
-- cached answer -- that L1/L2 read/write-back wiring is deliberately out of
-- scope for this phase and needs its own design pass (cache-check point in
-- the MCP tool handler, write-back point after a chat call, per-request
-- staleness re-check rather than only-at-startup) before it does anything.
CREATE TABLE IF NOT EXISTS nlm_grounded_cache (
  query_hash TEXT PRIMARY KEY,       -- SHA-256(normalized_query)
  query_text TEXT NOT NULL,
  answer_markdown TEXT NOT NULL,
  citations_json TEXT NOT NULL,      -- JSON string of structured citations
  pack_generation_sha TEXT NOT NULL, -- Pack SHA active when this was cached
  created_at INTEGER NOT NULL,       -- Epoch ms
  ttl_ms INTEGER NOT NULL DEFAULT 86400000 -- 24 hours
);

CREATE INDEX IF NOT EXISTS idx_nlm_cache_pack
  ON nlm_grounded_cache (pack_generation_sha);
`;

/**
 * Initializes and connects to the SQLite database.
 * Ensures the target directory exists and executes migration schema.
 *
 * @param {string} [dbPath] - Path to SQLite database file.
 * @param {Object} [options] - Database options.
 * @param {boolean} [options.readonly=false] - Open database in read-only mode.
 * @returns {DatabaseSync}
 */
export function getDatabase(dbPath = DEFAULT_DB_PATH, options = {}) {
  const resolvedPath = path.resolve(dbPath);
  const dbDir = path.dirname(resolvedPath);

  if (!fs.existsSync(dbDir) && !options.readonly) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const db = new DatabaseSync(resolvedPath, {
    readOnly: !!options.readonly,
  });

  if (!options.readonly) {
    try {
      db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA busy_timeout = 5000;
      `);
    } catch {}
    db.exec(SCHEMA_SQL);
    try {
      const cols = db.prepare("PRAGMA table_info(kb_documents)").all();
      const hasAbstract = cols.some((c) => c.name === 'abstract');
      if (!hasAbstract) {
        db.exec("ALTER TABLE kb_documents ADD COLUMN abstract TEXT");
      }
    } catch {}
  } else {
    try {
      db.exec("PRAGMA busy_timeout = 5000;");
    } catch {}
  }

  return db;
}

/**
 * Runs a SQLite WAL checkpoint on the database.
 * @param {DatabaseSync} db
 * @param {'PASSIVE'|'FULL'|'RESTART'|'TRUNCATE'} [mode='PASSIVE']
 * @returns {{ busy: number, log: number, checkpointed: number }}
 */
export function walCheckpoint(db, mode = 'PASSIVE') {
  const valid = new Set(['PASSIVE', 'FULL', 'RESTART', 'TRUNCATE']);
  const normalized = valid.has(String(mode).toUpperCase()) ? String(mode).toUpperCase() : 'PASSIVE';
  const row = db.prepare(`PRAGMA wal_checkpoint(${normalized})`).get();
  return {
    busy: row?.busy ?? 0,
    log: row?.log ?? 0,
    checkpointed: row?.checkpointed ?? 0
  };
}

/**
 * Executes a full database compaction: WAL truncate checkpoint, VACUUM, and final checkpoint.
 * @param {DatabaseSync} db
 */
export function compactDatabase(db) {
  walCheckpoint(db, 'TRUNCATE');
  db.exec('VACUUM;');
  walCheckpoint(db, 'TRUNCATE');
}

