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
    db.exec(SCHEMA_SQL);
  }

  return db;
}
