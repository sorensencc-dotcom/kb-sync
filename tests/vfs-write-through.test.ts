import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getDatabase } from '../modules/cache/db-schema.mjs';
import { computeSha256 } from '../modules/cache/sync-cache.mjs';
import { upsertDocumentToDiskAndCache } from '../modules/cache/vfs-upsert.mjs';
import {
  handleQueryContextCache,
  handleVfsUpsertDocument,
  processRpcMessage
} from '../scripts/mcp-memory-server.mjs';

describe('vfs_upsert_document disk-first write-through', () => {
  let sandboxRoot: string;
  let testDbPath: string;
  let db: ReturnType<typeof getDatabase>;

  beforeEach(() => {
    sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vfs-wt-'));
    testDbPath = path.join(sandboxRoot, '.kb_cache', 'knowledge.db');
    db = getDatabase(testDbPath);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {}
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  });

  test('TEST-01: upsert writes exact content to disk under repoRoot', () => {
    const content = `---
summary: Unique write-through alpha marker ZXQRPLM9
---

# Write Through Alpha

This paragraph mentions ZXQRPLM9 for discoverability.
`;

    const result = upsertDocumentToDiskAndCache(db, {
      topic: 'Write Through Alpha!',
      category: 'research',
      content,
      repoRoot: sandboxRoot
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, 'inserted');
    assert.equal(result.file_path, 'wiki/research/write-through-alpha.md');
    assert.equal(result.id, 'wiki/research/write-through-alpha.md');
    assert.equal(result.sha256, computeSha256(content));
    assert.ok(result.abstract.includes('ZXQRPLM9'));

    const abs = path.join(sandboxRoot, 'wiki', 'research', 'write-through-alpha.md');
    assert.ok(fs.existsSync(abs), 'markdown file must exist on disk');
    assert.equal(fs.readFileSync(abs, 'utf8'), content);
  });

  test('TEST-02: immediately discoverable via FTS / query_context_cache', () => {
    const token = 'FTSUNIQTOKEN42B7';
    const content = `# FTS Probe\n\nDistinctive token ${token} appears in the body for MATCH.`;

    upsertDocumentToDiskAndCache(db, {
      topic: 'fts-probe-note',
      category: 'research',
      content,
      repoRoot: sandboxRoot
    });

    const ftsRows: any[] = db
      .prepare('SELECT id, topic, content FROM kb_fts WHERE kb_fts MATCH ?')
      .all(`"${token}"`);
    assert.equal(ftsRows.length, 1);
    assert.equal(ftsRows[0].id, 'wiki/research/fts-probe-note.md');

    const mcpRes = handleQueryContextCache(db, { query: token, category: 'all', limit: 5 });
    assert.equal(mcpRes.isError, undefined);
    const parsed = JSON.parse(mcpRes.content[0].text);
    assert.ok(parsed.length >= 1);
    assert.ok(parsed.some((r: any) => r.id === 'wiki/research/fts-probe-note.md'));
  });

  test('TEST-03: path traversal and absolute paths rejected; DB unchanged', () => {
    const beforeCount: any = db.prepare('SELECT COUNT(*) AS c FROM kb_documents').get();

    assert.throws(
      () =>
        upsertDocumentToDiskAndCache(db, {
          topic: 'evil',
          category: 'research',
          content: 'should not write',
          file_path: '../../../etc/passwd',
          repoRoot: sandboxRoot
        }),
      /traversal|escape|not allowed/i
    );

    assert.throws(
      () =>
        upsertDocumentToDiskAndCache(db, {
          topic: 'evil',
          category: 'research',
          content: 'should not write',
          file_path: '/tmp/absolute-evil.md',
          repoRoot: sandboxRoot
        }),
      /absolute|not allowed/i
    );

    const afterCount: any = db.prepare('SELECT COUNT(*) AS c FROM kb_documents').get();
    assert.equal(afterCount.c, beforeCount.c);

    const mcp = handleVfsUpsertDocument(
      db,
      {
        topic: 'evil',
        category: 'research',
        content: 'nope',
        file_path: '../outside.md'
      },
      { repoRoot: sandboxRoot }
    );
    assert.equal(mcp.isError, true);
  });

  test('TEST-04: disk write failure leaves SQLite untouched', () => {
    // Make default parent path impossible: `wiki` is a file, not a directory.
    fs.writeFileSync(path.join(sandboxRoot, 'wiki'), 'not-a-directory');

    const beforeCount: any = db.prepare('SELECT COUNT(*) AS c FROM kb_documents').get();

    assert.throws(() =>
      upsertDocumentToDiskAndCache(db, {
        topic: 'disk-fail-topic',
        category: 'research',
        content: 'this must not reach sqlite',
        repoRoot: sandboxRoot
      })
    );

    const afterCount: any = db.prepare('SELECT COUNT(*) AS c FROM kb_documents').get();
    assert.equal(afterCount.c, beforeCount.c);

    const row = db
      .prepare('SELECT id FROM kb_documents WHERE topic = ?')
      .get('disk-fail-topic');
    assert.equal(row, undefined);
  });

  test('TEST-05: update same topic changes content+sha256 and remains searchable', () => {
    const token1 = 'UPDATETOKENAAA111';
    const token2 = 'UPDATETOKENBBB222';
    const content1 = `# First\n\nBody with ${token1}.`;
    const content2 = `# Second\n\nBody with ${token2} after mutation.`;

    const first = upsertDocumentToDiskAndCache(db, {
      topic: 'mutable-note',
      category: 'concepts',
      content: content1,
      repoRoot: sandboxRoot
    });
    assert.equal(first.action, 'inserted');
    assert.equal(first.sha256, computeSha256(content1));

    const second = upsertDocumentToDiskAndCache(db, {
      topic: 'mutable-note',
      category: 'concepts',
      content: content2,
      repoRoot: sandboxRoot
    });
    assert.equal(second.action, 'updated');
    assert.equal(second.sha256, computeSha256(content2));
    assert.notEqual(second.sha256, first.sha256);

    const abs = path.join(sandboxRoot, 'wiki', 'concepts', 'mutable-note.md');
    assert.equal(fs.readFileSync(abs, 'utf8'), content2);

    const row: any = db
      .prepare('SELECT content, sha256 FROM kb_documents WHERE id = ?')
      .get('wiki/concepts/mutable-note.md');
    assert.equal(row.content, content2);
    assert.equal(row.sha256, second.sha256);

    const ftsOld: any[] = db
      .prepare('SELECT id FROM kb_fts WHERE kb_fts MATCH ?')
      .all(`"${token1}"`);
    assert.equal(ftsOld.length, 0);

    const ftsNew: any[] = db
      .prepare('SELECT id FROM kb_fts WHERE kb_fts MATCH ?')
      .all(`"${token2}"`);
    assert.equal(ftsNew.length, 1);

    const viaHandler = handleVfsUpsertDocument(
      db,
      {
        topic: 'mutable-note',
        category: 'concepts',
        content: content2 + '\nextra\n',
        file_path: 'wiki/concepts/mutable-note.md'
      },
      { repoRoot: sandboxRoot }
    );
    assert.equal(viaHandler.isError, undefined);
    const payload = JSON.parse(viaHandler.content[0].text);
    assert.equal(payload.action, 'updated');
    assert.equal(payload.ok, true);

    const listed = processRpcMessage(db, {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/list',
      params: {}
    });
    const tools = listed?.result?.tools || [];
    assert.ok(tools.some((t: any) => t.name === 'vfs_upsert_document'));
  });
});
