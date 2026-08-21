import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { validateTrmPayloadSemantics } from '../modules/wiki/validate-trm-semantics.mjs';
import { syncKnowledgeCache } from '../modules/cache/sync-cache.mjs';
import { getDatabase } from '../modules/cache/db-schema.mjs';
import { handleQueryContextCache, handleFetchTopicNote } from '../scripts/mcp-memory-server.mjs';

describe('TRM-to-Context-Cache End-to-End Pipeline Integration', () => {
  let sandboxRoot: string;
  let stagingDir: string;
  let vaultDir: string;
  let dbPath: string;

  beforeEach(() => {
    sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trm-e2e-pipeline-'));
    stagingDir = path.join(sandboxRoot, '_kb-sync-staging', 'trm', 'batch-20260821-001');
    vaultDir = path.join(sandboxRoot, 'vault');
    dbPath = path.join(sandboxRoot, '.kb_cache', 'knowledge.db');

    fs.mkdirSync(path.join(stagingDir, 'sources'), { recursive: true });
    fs.mkdirSync(path.join(vaultDir, 'wiki', 'research'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  });

  test('E2E-01: Full pipeline: Stage TRM -> Semantic Validation -> Vault Promotion -> Cache Sync -> FTS5 MCP Query', async () => {
    const topicId = 'trm:daemon-heartbeats';
    const sourceFilename = 'src-daemon-heartbeats.md';
    const sourceContent = `# Daemon Heartbeats & Reconnection Architecture\n\n## Overview\nThis document details the heartbeat ping mechanism, backoff schedule, and unacknowledged message recovery.`;
    const sourceSha256 = crypto.createHash('sha256').update(sourceContent).digest('hex');
    const sourceByteSize = Buffer.byteLength(sourceContent);

    // 1. Stage files on disk
    fs.writeFileSync(path.join(stagingDir, 'sources', sourceFilename), sourceContent);

    const payload = {
      schema_version: '2.3.0',
      batch_id: 'batch-20260821-001',
      topic_id: topicId,
      title: 'Daemon Heartbeats & Reconnection Architecture',
      domain: 'wiki',
      status: 'stable',
      summary: 'Details daemon heartbeat ping and reconnect behaviors.',
      sources: [
        {
          source_id: 'src-daemon-heartbeats',
          title: 'Daemon Heartbeats',
          origin_uri: 'https://specs.internal/daemon-heartbeats',
          staged_filename: sourceFilename,
          content_sha256: sourceSha256,
          byte_size: sourceByteSize,
          retrieved_at: new Date().toISOString()
        }
      ],
      extracted_concepts: []
    };

    const manifest = {
      [sourceFilename]: {
        content_sha256: sourceSha256,
        byte_size: sourceByteSize
      }
    };

    // 2. Validate semantics
    const validationResult = await validateTrmPayloadSemantics(stagingDir, payload, manifest);
    assert.equal(validationResult.valid, true, `Validation failed: ${JSON.stringify(validationResult.errors)}`);
    assert.equal(validationResult.errors.length, 0);

    // 3. Promote staged source to vault
    const destinationPath = path.join(vaultDir, 'wiki', 'research', 'daemon-heartbeats.md');
    fs.copyFileSync(path.join(stagingDir, 'sources', sourceFilename), destinationPath);
    assert.ok(fs.existsSync(destinationPath), 'Promoted file must exist in vault');

    // 4. Sync vault into SQLite context cache
    const syncStats = syncKnowledgeCache({
      dbPath,
      repoRoot: vaultDir,
      scanPaths: ['wiki/research']
    });
    assert.equal(syncStats.inserted, 1, 'Must insert 1 document into cache');
    assert.equal(syncStats.deleted, 0);

    // 5. Query context cache via MCP helper functions
    const db = getDatabase(dbPath, { readonly: true });

    // FTS query
    const searchResult = handleQueryContextCache(db, {
      query: 'heartbeat AND backoff',
      category: 'research',
      limit: 5
    });
    assert.equal(searchResult.isError, undefined);
    const hits = JSON.parse(searchResult.content[0].text);
    assert.equal(hits.length, 1, 'Must find matching research topic');
    assert.equal(hits[0].topic, 'daemon-heartbeats');
    assert.ok(hits[0].snippet.includes('[MATCH]heartbeat[/MATCH]'));

    // Fetch full topic note
    const fetchResult = handleFetchTopicNote(db, { topic: 'daemon-heartbeats' });
    assert.equal(fetchResult.isError, undefined);
    assert.equal(fetchResult.content[0].text, sourceContent);

    db.close();
  });
});
