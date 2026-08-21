import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDatabase, DEFAULT_DB_PATH } from './db-schema.mjs';

/**
 * Computes sha256 of string content.
 * @param {string} content
 * @returns {string}
 */
export function computeSha256(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Infers category and topic from relative file path and content.
 * @param {string} relPath - Relative file path (e.g. 'wiki/research/websocket.md')
 * @param {string} content - Markdown or JSON content
 * @returns {{ category: string, topic: string }}
 */
export function inferDocumentMetadata(relPath, content) {
  const normalizedPath = relPath.replace(/\\/g, '/');
  const filename = path.basename(normalizedPath, path.extname(normalizedPath));

  let category = 'research';
  if (normalizedPath.includes('gap') || filename.includes('gap')) {
    category = 'gap';
  } else if (normalizedPath.includes('audit') || filename.includes('audit')) {
    category = 'audit';
  } else if (normalizedPath.includes('source') || normalizedPath.startsWith('_kb-sync-staging/')) {
    category = 'source';
  } else if (normalizedPath.startsWith('wiki/research/')) {
    category = 'research';
  }

  // Attempt to extract frontmatter topic if present
  let topic = filename.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (frontmatterMatch) {
    const yaml = frontmatterMatch[1];
    const topicMatch = yaml.match(/(?:topic|topic_id|id|slug):\s*["']?([^"'\r\n]+)["']?/i);
    if (topicMatch && topicMatch[1].trim()) {
      topic = topicMatch[1].trim().replace(/^trm:/, '');
    }
  }

  return { category, topic };
}

/**
 * Synchronizes directories and files into the SQLite cache.
 *
 * @param {Object} [options]
 * @param {string} [options.dbPath] - Database path.
 * @param {string} [options.repoRoot] - Root repository directory.
 * @param {string[]} [options.scanPaths] - Relative paths or globs to scan.
 * @param {boolean} [options.verbose=false] - Verbose log output.
 * @returns {{ inserted: number, updated: number, skipped: number, deleted: number, total: number }}
 */
export function syncKnowledgeCache(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const dbPath = options.dbPath || DEFAULT_DB_PATH;
  const verbose = !!options.verbose;

  const defaultScanPaths = [
    'wiki/research',
    'wiki/concepts',
    'trm-research-gaps.md',
    'docs/kb',
    '_kb-sync-staging/trm'
  ];

  const scanTargets = options.scanPaths || defaultScanPaths;
  const db = getDatabase(dbPath);

  const existingDocs = new Map();
  const selectStmt = db.prepare('SELECT id, file_path, sha256 FROM kb_documents');
  for (const row of selectStmt.all()) {
    existingDocs.set(row.id, row);
  }

  const foundDocIds = new Set();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  const upsertStmt = db.prepare(`
    INSERT INTO kb_documents (id, category, topic, file_path, content, sha256, last_updated)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      category = excluded.category,
      topic = excluded.topic,
      file_path = excluded.file_path,
      content = excluded.content,
      sha256 = excluded.sha256,
      last_updated = CURRENT_TIMESTAMP
    WHERE kb_documents.sha256 != excluded.sha256
  `);

  function processFile(absPath, relPath) {
    const content = fs.readFileSync(absPath, 'utf8');
    const sha256 = computeSha256(content);
    const { category, topic } = inferDocumentMetadata(relPath, content);
    const id = relPath.replace(/\\/g, '/');

    foundDocIds.add(id);
    const existing = existingDocs.get(id);

    if (!existing) {
      upsertStmt.run(id, category, topic, id, content, sha256);
      inserted++;
      if (verbose) console.log(`[kb-cache] Inserted: ${id}`);
    } else if (existing.sha256 !== sha256) {
      upsertStmt.run(id, category, topic, id, content, sha256);
      updated++;
      if (verbose) console.log(`[kb-cache] Updated: ${id}`);
    } else {
      skipped++;
    }
  }

  function walkDirectory(dirPath, baseRel = '') {
    if (!fs.existsSync(dirPath)) return;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relPath = path.join(baseRel, entry.name);

      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          walkDirectory(fullPath, relPath);
        }
      } else if (entry.isFile()) {
        if (/\.(md|markdown|json|txt)$/i.test(entry.name)) {
          const repoRelPath = path.relative(repoRoot, fullPath);
          processFile(fullPath, repoRelPath);
        }
      }
    }
  }

  for (const target of scanTargets) {
    const targetAbs = path.resolve(repoRoot, target);
    if (!fs.existsSync(targetAbs)) continue;

    const stat = fs.statSync(targetAbs);
    if (stat.isDirectory()) {
      walkDirectory(targetAbs, target);
    } else if (stat.isFile()) {
      processFile(targetAbs, target);
    }
  }

  // Purge removed documents if syncing whole repo context
  let deleted = 0;
  if (!options.scanPaths) {
    const deleteStmt = db.prepare('DELETE FROM kb_documents WHERE id = ?');
    for (const [id] of existingDocs) {
      if (!foundDocIds.has(id)) {
        deleteStmt.run(id);
        deleted++;
        if (verbose) console.log(`[kb-cache] Deleted: ${id}`);
      }
    }
  }

  const total = inserted + updated + skipped;
  db.close();

  return { inserted, updated, skipped, deleted, total };
}
