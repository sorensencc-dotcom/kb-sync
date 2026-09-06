import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDatabase, DEFAULT_DB_PATH } from './db-schema.mjs';
import { storeVector, deterministicHeuristicVector } from './vector-store.mjs';

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
 * Automatically extracts or calculates a compact L0 abstract (<= 300 chars) for zero-hop resolution.
 * @param {string} content - Document raw text
 * @param {string} relPath - Relative file path
 * @returns {string} L0 abstract
 */
export function extractL0Abstract(content, relPath = '') {
  if (!content || typeof content !== 'string') return '';

  // 1. Check YAML frontmatter for explicit summary/abstract fields
  const frontmatterMatch = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (frontmatterMatch) {
    const yaml = frontmatterMatch[1];
    const summaryMatch = yaml.match(/(?:summary|abstract|description|tl;dr):\s*["']?([^"'\r\n]+)["']?/i);
    if (summaryMatch && summaryMatch[1].trim()) {
      return summaryMatch[1].trim().slice(0, 300);
    }
  }

  // 2. Handle JSON documents
  if (relPath.endsWith('.json') || content.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(content);
      const candidate = parsed.summary || parsed.abstract || parsed.description || parsed.title || parsed.name;
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim().slice(0, 300);
      }
    } catch {}
  }

  // 3. Extract first meaningful prose paragraph from Markdown/Text
  const body = frontmatterMatch ? content.slice(frontmatterMatch[0].length) : content;
  const lines = body.split(/\r?\n/);
  let prose = '';

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    // Skip headings, horizontal rules, code blocks, tables, lists, and quotes
    if (line.startsWith('#') || line.startsWith('---') || line.startsWith('```') || line.startsWith('|') || line.startsWith('>')) {
      continue;
    }
    // Clean markdown links, bold, italics, backticks
    const cleaned = line
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_`]/g, '')
      .replace(/^-\s+/, '')
      .trim();

    if (cleaned.length >= 20) {
      prose = cleaned;
      break;
    }
  }

  if (prose) {
    if (prose.length > 280) {
      const truncated = prose.slice(0, 277);
      const lastSpace = truncated.lastIndexOf(' ');
      return (lastSpace > 200 ? truncated.slice(0, lastSpace) : truncated) + '...';
    }
    return prose;
  }

  // 4. Fallback: clean topic / file basename
  const fallback = path.basename(relPath, path.extname(relPath)).replace(/[-_]/g, ' ');
  return `${fallback} overview document.`;
}

/**
 * Synchronizes directories and files into the SQLite cache.
 *
 * @param {Object} [options]
 * @param {string} [options.dbPath] - Database path.
 * @param {string} [options.repoRoot] - Root repository directory.
 * @param {string[]} [options.scanPaths] - Relative paths or globs to scan.
 * @param {boolean} [options.verbose=false] - Verbose log output.
 * @returns {{ inserted: number, updated: number, skipped: number, deleted: number, total: number, abstracts_injected: number }}
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
  const selectStmt = db.prepare('SELECT id, file_path, sha256, abstract FROM kb_documents');
  for (const row of selectStmt.all()) {
    existingDocs.set(row.id, row);
  }

  const foundDocIds = new Set();
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let abstractsInjected = 0;

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
    WHERE kb_documents.sha256 != excluded.sha256 OR kb_documents.abstract IS NULL
  `);

  function processFile(absPath, relPath) {
    const content = fs.readFileSync(absPath, 'utf8');
    const sha256 = computeSha256(content);
    const { category, topic } = inferDocumentMetadata(relPath, content);
    const id = relPath.replace(/\\/g, '/');
    const abstract = extractL0Abstract(content, relPath);

    foundDocIds.add(id);
    const existing = existingDocs.get(id);

    if (!existing) {
      upsertStmt.run(id, category, topic, id, abstract, content, sha256);
      const vec = deterministicHeuristicVector(`${topic} ${abstract} ${content.slice(0, 2000)}`);
      storeVector(db, id, topic, vec);
      inserted++;
      abstractsInjected++;
      if (verbose) console.log(`[kb-cache] Inserted (L0 abstract injected): ${id}`);
    } else if (existing.sha256 !== sha256 || !existing.abstract) {
      upsertStmt.run(id, category, topic, id, abstract, content, sha256);
      const vec = deterministicHeuristicVector(`${topic} ${abstract} ${content.slice(0, 2000)}`);
      storeVector(db, id, topic, vec);
      updated++;
      abstractsInjected++;
      if (verbose) console.log(`[kb-cache] Updated (L0 abstract injected): ${id}`);
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

  return { inserted, updated, skipped, deleted, total, abstracts_injected: abstractsInjected };
}
