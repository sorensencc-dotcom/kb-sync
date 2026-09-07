import fs from 'node:fs';
import path from 'node:path';
import { computeSha256, extractL0Abstract } from './sync-cache.mjs';
import { storeVector, deterministicHeuristicVector } from './vector-store.mjs';

/**
 * Sanitize a topic id to kebab-case-ish (lowercase, alphanumeric, hyphens/underscores).
 * @param {string} topic
 * @returns {string}
 */
export function sanitizeTopic(topic) {
  if (topic == null) return '';
  return String(topic)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Normalize a relative path to forward-slash form used as document id.
 * @param {string} relPath
 * @returns {string}
 */
export function normalizeRelPath(relPath) {
  return String(relPath).replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Resolve a relative file_path under repoRoot with path-traversal rejection.
 * Rejects absolute paths and any `..` segments. Ensures the resolved path
 * remains inside repoRoot.
 *
 * @param {string} repoRoot
 * @param {string} filePath
 * @returns {{ relPath: string, absPath: string }}
 */
export function resolveSafeWorkspacePath(repoRoot, filePath) {
  if (filePath == null || typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('file_path must be a non-empty relative path');
  }

  const raw = filePath.trim();
  if (path.isAbsolute(raw)) {
    throw new Error(`Absolute paths are not allowed: ${raw}`);
  }

  const normalizedInput = normalizeRelPath(raw);
  if (normalizedInput.split('/').some((seg) => seg === '..')) {
    throw new Error(`Path traversal is not allowed: ${raw}`);
  }

  const root = path.resolve(repoRoot);
  const absPath = path.resolve(root, normalizedInput);
  const relToRoot = path.relative(root, absPath);

  if (
    relToRoot.startsWith('..') ||
    path.isAbsolute(relToRoot) ||
    relToRoot.split(path.sep).includes('..')
  ) {
    throw new Error(`Resolved path escapes repository root: ${raw}`);
  }

  const relPath = normalizeRelPath(relToRoot);
  return { relPath, absPath };
}

/**
 * Disk-first write-through upsert: write markdown to the physical workspace,
 * then upsert into kb_documents (+ vector). Relies on existing AFTER INSERT/UPDATE
 * triggers for kb_fts — does not touch FTS directly.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {Object} params
 * @param {string} params.topic
 * @param {string} params.category
 * @param {string} params.content
 * @param {string} [params.file_path]
 * @param {string} params.repoRoot
 * @returns {{ ok: true, id: string, file_path: string, sha256: string, abstract: string, action: 'inserted'|'updated' }}
 */
export function upsertDocumentToDiskAndCache(db, params = {}) {
  const { content, repoRoot } = params;
  const category = params.category != null ? String(params.category).trim() : '';
  const topic = sanitizeTopic(params.topic);

  if (!topic) {
    throw new Error('topic is required and must sanitize to a non-empty kebab-case id');
  }
  if (!category) {
    throw new Error('category is required');
  }
  if (content == null || typeof content !== 'string') {
    throw new Error('content must be a string');
  }
  if (!repoRoot || typeof repoRoot !== 'string') {
    throw new Error('repoRoot is required');
  }

  const defaultPath = `wiki/${category}/${topic}.md`;
  const requestedPath =
    params.file_path != null && String(params.file_path).trim()
      ? String(params.file_path).trim()
      : defaultPath;

  const { relPath, absPath } = resolveSafeWorkspacePath(repoRoot, requestedPath);

  // Disk-as-truth: write first. On failure, do not touch SQLite.
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, 'utf8');

  const sha256 = computeSha256(content);
  const abstract = extractL0Abstract(content, relPath);
  const id = relPath;

  const existing = db.prepare('SELECT id FROM kb_documents WHERE id = ?').get(id);
  const action = existing ? 'updated' : 'inserted';

  const upsertStmt = db.prepare(`
    INSERT INTO kb_documents (id, category, topic, file_path, abstract, content, sha256, last_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      category = excluded.category,
      topic = excluded.topic,
      file_path = excluded.file_path,
      abstract = excluded.abstract,
      content = excluded.content,
      sha256 = excluded.sha256,
      last_updated = CURRENT_TIMESTAMP
  `);
  upsertStmt.run(id, category, topic, id, abstract, content, sha256);

  const vec = deterministicHeuristicVector(`${topic} ${abstract} ${content.slice(0, 2000)}`);
  storeVector(db, id, topic, vec);

  return {
    ok: true,
    id,
    file_path: id,
    sha256,
    abstract,
    action
  };
}
