import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getDatabase } from '../modules/cache/db-schema.mjs';
import { syncKnowledgeCache, computeSha256, inferDocumentMetadata } from '../modules/cache/sync-cache.mjs';
import {
  handleQueryContextCache,
  handleFetchTopicNote,
  processRpcMessage
} from '../scripts/mcp-memory-server.mjs';

describe('Local SQLite Context Cache & MCP Server Suite', () => {
  let sandboxRoot: string;
  let testDbPath: string;

  beforeEach(() => {
    sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-cache-test-'));
    testDbPath = path.join(sandboxRoot, '.kb_cache', 'knowledge.db');
  });

  afterEach(() => {
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  });

  test('TEST-01: SQLite Schema initialization and FTS5 triggers', () => {
    const db = getDatabase(testDbPath);

    // 1. Verify tables exist
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const tableNames = tables.map((t: any) => t.name);
    assert.ok(tableNames.includes('kb_documents'), 'kb_documents table must exist');
    assert.ok(tableNames.includes('kb_fts'), 'kb_fts virtual table must exist');

    // 2. Insert document and verify trigger population
    const docId = 'wiki/research/websocket.md';
    const insertStmt = db.prepare(`
      INSERT INTO kb_documents (id, category, topic, file_path, content, sha256)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertStmt.run(
      docId,
      'research',
      'websocket-heartbeats',
      docId,
      'Document on websocket heartbeat timers and resilience protocols.',
      'sha1'
    );

    const ftsRow: any = db.prepare('SELECT * FROM kb_fts WHERE id = ?').get(docId);
    assert.ok(ftsRow, 'Trigger must have inserted record into kb_fts');
    assert.equal(ftsRow.topic, 'websocket-heartbeats');

    // 3. Update document and verify trigger updates FTS
    const updateStmt = db.prepare(`
      UPDATE kb_documents SET content = ?, sha256 = ? WHERE id = ?
    `);
    updateStmt.run('Updated content mentioning distributed backoff algorithms.', 'sha2', docId);

    const updatedFts: any = db.prepare('SELECT * FROM kb_fts WHERE id = ?').get(docId);
    assert.ok(updatedFts.content.includes('distributed backoff'), 'Trigger must update FTS content');

    // 4. Delete document and verify trigger removes from FTS
    db.prepare('DELETE FROM kb_documents WHERE id = ?').run(docId);
    const deletedFts = db.prepare('SELECT * FROM kb_fts WHERE id = ?').get(docId);
    assert.equal(deletedFts, undefined, 'Trigger must delete record from kb_fts');

    db.close();
  });

  test('TEST-02: Document metadata inference & SHA-256 calculation', () => {
    const contentWithFrontmatter = `---
topic: mobile-websocket-heartbeats
domain: protocol
---
# Mobile Websocket Heartbeats
Content here...`;

    const meta1 = inferDocumentMetadata('wiki/research/websocket.md', contentWithFrontmatter);
    assert.equal(meta1.category, 'research');
    assert.equal(meta1.topic, 'mobile-websocket-heartbeats');

    const meta2 = inferDocumentMetadata('docs/kb/gap-analysis.md', '# Gaps');
    assert.equal(meta2.category, 'gap');
    assert.equal(meta2.topic, 'gap-analysis');

    const hash = computeSha256('test content');
    assert.equal(hash, '6ae8a75555209fd6c44157c0aed8016e763ff435a19cf186f76863140143ff72');
  });

  test('TEST-03: Incremental cache synchronization', () => {
    const researchDir = path.join(sandboxRoot, 'wiki', 'research');
    fs.mkdirSync(researchDir, { recursive: true });

    const file1 = path.join(researchDir, 'heartbeats.md');
    fs.writeFileSync(file1, 'Initial heartbeats specification');

    // Initial sync
    const stats1 = syncKnowledgeCache({
      dbPath: testDbPath,
      repoRoot: sandboxRoot,
      scanPaths: ['wiki/research']
    });

    assert.equal(stats1.inserted, 1);
    assert.equal(stats1.updated, 0);

    // Second sync without changes (must skip)
    const stats2 = syncKnowledgeCache({
      dbPath: testDbPath,
      repoRoot: sandboxRoot,
      scanPaths: ['wiki/research']
    });
    assert.equal(stats2.inserted, 0);
    assert.equal(stats2.skipped, 1);

    // Modify file
    fs.writeFileSync(file1, 'Updated heartbeats specification with retry logic');
    const stats3 = syncKnowledgeCache({
      dbPath: testDbPath,
      repoRoot: sandboxRoot,
      scanPaths: ['wiki/research']
    });
    assert.equal(stats3.updated, 1);
  });

  test('TEST-04: MCP tool query_context_cache execution', () => {
    const db = getDatabase(testDbPath);
    const insertStmt = db.prepare(`
      INSERT INTO kb_documents (id, category, topic, file_path, content, sha256)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    insertStmt.run(
      'doc-1',
      'research',
      'mobile-heartbeats',
      'wiki/research/mobile-heartbeats.md',
      'Detailed findings on mobile websocket keepalive and battery life.',
      'h1'
    );
    insertStmt.run(
      'doc-2',
      'gap',
      'offline-queue-gaps',
      'wiki/research/gaps.md',
      'Known gaps in offline message queuing during network disconnects.',
      'h2'
    );

    // Search for websocket
    const res1 = handleQueryContextCache(db, { query: 'websocket', category: 'all', limit: 5 });
    assert.equal(res1.isError, undefined);
    const parsed1 = JSON.parse(res1.content[0].text);
    assert.equal(parsed1.length, 1);
    assert.equal(parsed1[0].topic, 'mobile-heartbeats');
    assert.ok(parsed1[0].snippet.includes('[MATCH]websocket[/MATCH]'));

    // Category filter
    const res2 = handleQueryContextCache(db, { query: 'disconnects', category: 'gap', limit: 5 });
    const parsed2 = JSON.parse(res2.content[0].text);
    assert.equal(parsed2.length, 1);
    assert.equal(parsed2[0].topic, 'offline-queue-gaps');

    db.close();
  });

  test('TEST-05: MCP tool fetch_topic_note execution', () => {
    const db = getDatabase(testDbPath);
    const docContent = '# Full Spec\nExact protocol details for mobile heartbeats.';
    db.prepare(`
      INSERT INTO kb_documents (id, category, topic, file_path, content, sha256)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('doc-1', 'research', 'mobile-heartbeats', 'wiki/research/doc-1.md', docContent, 'h1');

    // Fetch existing
    const res = handleFetchTopicNote(db, { topic: 'mobile-heartbeats' });
    assert.equal(res.isError, undefined);
    assert.equal(res.content[0].text, docContent);

    // Fetch non-existing
    const missingRes = handleFetchTopicNote(db, { topic: 'non-existent' });
    assert.equal(missingRes.isError, true);
    assert.ok(missingRes.content[0].text.includes('not found'));

    db.close();
  });

  test('TEST-06: MCP JSON-RPC protocol message processor', () => {
    const db = getDatabase(testDbPath);

    // 1. Test initialize
    const initRes = processRpcMessage(db, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {}
    });
    assert.equal(initRes?.id, 1);
    assert.equal(initRes?.result.serverInfo.name, 'local-context-cache');

    // 2. Test tools/list
    const listRes = processRpcMessage(db, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {}
    });
    assert.equal(listRes?.id, 2);
    assert.equal(listRes?.result.tools.length, 2);
    assert.equal(listRes?.result.tools[0].name, 'query_context_cache');
    assert.equal(listRes?.result.tools[1].name, 'fetch_topic_note');

    // 3. Test tools/call query_context_cache
    const callRes = processRpcMessage(db, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'query_context_cache',
        arguments: { query: 'test' }
      }
    });
    db.close();
  });

  test('TEST-07: Stale record purging when markdown files are removed from vault', () => {
    const researchDir = path.join(sandboxRoot, 'wiki', 'research');
    fs.mkdirSync(researchDir, { recursive: true });

    const file1 = path.join(researchDir, 'keep.md');
    const file2 = path.join(researchDir, 'remove-me.md');
    fs.writeFileSync(file1, '# Keep\nThis file stays.');
    fs.writeFileSync(file2, '# Temporary\nThis file will be deleted.');

    // 1. Initial sync across whole sandboxRoot
    const res1 = syncKnowledgeCache({
      dbPath: testDbPath,
      repoRoot: sandboxRoot
    });
    assert.equal(res1.inserted, 2);

    let db = getDatabase(testDbPath);
    let count = db.prepare('SELECT COUNT(*) as c FROM kb_documents').get() as { c: number };
    assert.equal(count.c, 2);
    db.close();

    // 2. Remove one file on disk
    fs.rmSync(file2);

    // 3. Re-sync whole sandboxRoot and verify stale record deletion
    const res2 = syncKnowledgeCache({
      dbPath: testDbPath,
      repoRoot: sandboxRoot
    });
    assert.equal(res2.deleted, 1, 'Must report 1 deleted record');

    db = getDatabase(testDbPath);
    count = db.prepare('SELECT COUNT(*) as c FROM kb_documents').get() as { c: number };
    assert.equal(count.c, 1, 'Database must only contain 1 document after purge');

    // FTS check
    const ftsCheck = db.prepare("SELECT * FROM kb_fts WHERE kb_fts MATCH 'Temporary'").all();
    assert.equal(ftsCheck.length, 0, 'FTS index must be purged of deleted file');
    db.close();
  });

  test('TEST-08: MCP JSON-RPC error handling for malformed messages, unknown methods, and unknown tools', () => {
    const db = getDatabase(testDbPath);

    // 1. Unknown method
    const unknownMethodRes = processRpcMessage(db, {
      jsonrpc: '2.0',
      id: 10,
      method: 'non_existent_method',
      params: {}
    });
    assert.equal(unknownMethodRes?.id, 10);
    assert.equal(unknownMethodRes?.error.code, -32601);
    assert.ok(unknownMethodRes?.error.message.includes('Method not found'));

    // 2. tools/call with unknown tool name
    const unknownToolRes = processRpcMessage(db, {
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: {
        name: 'unregistered_tool',
        arguments: {}
      }
    });
    assert.equal(unknownToolRes?.id, 11);
    assert.equal(unknownToolRes?.error.code, -32601);
    assert.ok(unknownToolRes?.error.message.includes('Unknown tool'));

    // 3. Notification message (no id) returns null
    const notifRes = processRpcMessage(db, {
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    });
    assert.equal(notifRes, null);

    // 4. Malformed message object (missing method)
    const malformedRes = processRpcMessage(db, {
      jsonrpc: '2.0',
      id: 12
    });
    assert.equal(malformedRes?.id, 12);
    assert.equal(malformedRes?.error.code, -32601);

    db.close();
  });
});

