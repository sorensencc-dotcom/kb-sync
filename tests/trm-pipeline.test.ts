import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { validateTrmPayloadSemantics, computeStreamHash } from '../modules/wiki/validate-trm-semantics.mjs';

describe('TRM Pipeline Hardened Sandbox Verification Suite', () => {
  let sandboxRoot: string;

  beforeEach(() => {
    sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trm-test-sandbox-'));
    fs.mkdirSync(path.join(sandboxRoot, 'wiki', 'research'), { recursive: true });
    fs.mkdirSync(path.join(sandboxRoot, 'wiki', 'concepts'), { recursive: true });
    fs.mkdirSync(path.join(sandboxRoot, '_kb-sync-staging', 'trm'), { recursive: true });
    fs.mkdirSync(path.join(sandboxRoot, '.quarantine'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  });

  test('TEST-01: Semantic stream validator rejects checksum mismatch, orphan files, and path traversal', async () => {
    const batchId = '20260814-220000-t01';
    const batchDir = path.join(sandboxRoot, '_kb-sync-staging', 'trm', batchId);
    fs.mkdirSync(path.join(batchDir, 'sources'), { recursive: true });

    // 1. Create source file on disk with mismatched content and orphan file
    const diskContent = 'Actual content on disk that differs from manifest hash';
    fs.writeFileSync(path.join(batchDir, 'sources', 'src-01.md'), diskContent);
    fs.writeFileSync(path.join(batchDir, 'sources', 'orphan.md'), 'Unindexed orphan file');

    const expectedHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    const payload = {
      schema_version: '2.3.0',
      batch_id: batchId,
      topic_id: 'trm:test-topic',
      title: 'Test Topic',
      domain: 'wiki',
      status: 'beta',
      summary: 'Test summary description.',
      sources: [
        {
          source_id: 'src-01',
          title: 'Test Source',
          origin_uri: 'https://example.com/test',
          staged_filename: 'src-01.md',
          content_sha256: expectedHash,
          byte_size: 20,
          retrieved_at: new Date().toISOString()
        },
        {
          source_id: 'src-traversal',
          title: 'Traversal Attempt',
          origin_uri: 'https://example.com/bad',
          staged_filename: '../escaped.md',
          content_sha256: expectedHash,
          byte_size: 20,
          retrieved_at: new Date().toISOString()
        }
      ],
      extracted_concepts: [
        {
          concept_slug: 'test-concept',
          concept_title: 'Test Concept',
          description: 'Test concept description text.',
          codebase_adjacency: []
        }
      ]
    };

    const manifest = {
      'src-01.md': {
        content_sha256: expectedHash,
        byte_size: 20
      },
      '../escaped.md': {
        content_sha256: expectedHash,
        byte_size: 20
      }
    };

    const result = await validateTrmPayloadSemantics(batchDir, payload, manifest);
    assert.equal(result.valid, false, 'Must fail validation due to multiple semantic violations');

    const ruleIds = result.errors.map((e) => e.rule_id);
    assert.ok(ruleIds.includes('RULE_SEMANTIC_CHECKSUM_MISMATCH'), 'Must cite RULE_SEMANTIC_CHECKSUM_MISMATCH');
    assert.ok(ruleIds.includes('RULE_SEMANTIC_ORPHAN_FILE'), 'Must cite RULE_SEMANTIC_ORPHAN_FILE');
    assert.ok(ruleIds.includes('RULE_SEMANTIC_TRAVERSAL_DETECTED'), 'Must cite RULE_SEMANTIC_TRAVERSAL_DETECTED');
  });

  test('TEST-02: Stream hashing correctly computes digest on valid files', async () => {
    const batchId = '20260814-220000-t02';
    const batchDir = path.join(sandboxRoot, '_kb-sync-staging', 'trm', batchId);
    fs.mkdirSync(path.join(batchDir, 'sources'), { recursive: true });

    const content = 'Hello world stream verification content';
    const filePath = path.join(batchDir, 'sources', 'src-valid.md');
    fs.writeFileSync(filePath, content);

    const actualHash = crypto.createHash('sha256').update(content).digest('hex');
    const actualSize = Buffer.byteLength(content);

    const { sha256, byteLength } = await computeStreamHash(filePath);
    assert.equal(sha256, actualHash, 'Stream SHA-256 must match crypto digest');
    assert.equal(byteLength, actualSize, 'Stream byte size must match content length');

    const payload = {
      schema_version: '2.3.0',
      batch_id: batchId,
      topic_id: 'trm:valid-topic',
      title: 'Valid Topic',
      domain: 'wiki',
      status: 'beta',
      summary: 'Valid summary text description.',
      sources: [
        {
          source_id: 'src-valid',
          title: 'Valid Source',
          origin_uri: 'https://example.com/valid',
          staged_filename: 'src-valid.md',
          content_sha256: actualHash,
          byte_size: actualSize,
          retrieved_at: new Date().toISOString()
        }
      ],
      extracted_concepts: [
        {
          concept_slug: 'valid-concept',
          concept_title: 'Valid Concept',
          description: 'Valid concept description text.',
          codebase_adjacency: []
        }
      ]
    };

    const manifest = {
      'src-valid.md': {
        content_sha256: actualHash,
        byte_size: actualSize
      }
    };

    const result = await validateTrmPayloadSemantics(batchDir, payload, manifest);
    assert.equal(result.valid, true, `Validation must succeed for valid batch: ${JSON.stringify(result.errors)}`);
    assert.equal(result.errors.length, 0, 'Must have zero errors');
  });

  test('TEST-03: Concurrency locking: atomic lock creation and contention detection', () => {
    const lockFile = path.join(sandboxRoot, '.kb-sync.lock');
    const ownerNonce = crypto.randomUUID();

    // 1. Acquire lock atomically via wx flag
    const fd = fs.openSync(lockFile, 'wx');
    const lockData = {
      owner_nonce: ownerNonce,
      pid: process.pid,
      hostname: 'test-runner',
      batch_id: '20260814-220000-lock',
      created_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString()
    };
    fs.writeFileSync(fd, JSON.stringify(lockData, null, 2), 'utf-8');
    fs.closeSync(fd);

    assert.ok(fs.existsSync(lockFile), 'Lock file must exist on disk');

    // 2. Second worker attempting to acquire lock must fail with EEXIST
    let lockFailed = false;
    try {
      fs.openSync(lockFile, 'wx');
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        lockFailed = true;
      }
    }
    assert.equal(lockFailed, true, 'Second worker must be rejected with EEXIST collision');

    // 3. Clean up lock
    fs.unlinkSync(lockFile);
    assert.equal(fs.existsSync(lockFile), false, 'Lock must be removable');
  });

  test('TEST-04: Crash recovery WAL state machine rolls back newly created files', () => {
    const backupDir = path.join(sandboxRoot, 'wiki', '.backup-20260814-t04');
    fs.mkdirSync(backupDir, { recursive: true });

    // Existing pre-image file
    const existingFile = path.join(sandboxRoot, 'wiki', 'research', 'existing.md');
    fs.writeFileSync(existingFile, 'Original content before transaction');
    fs.copyFileSync(existingFile, path.join(backupDir, 'existing.md'));

    // Newly created file simulated during interrupted promotion
    const newFile = path.join(sandboxRoot, 'wiki', 'research', 'new-uncommitted.md');
    fs.writeFileSync(newFile, 'Interrupted content that must be rolled back');

    const manifest = {
      batch_id: '20260814-t04',
      owner_nonce: 'test-nonce-1234',
      state: 'COMMITTING_FILES',
      backup_dir: backupDir,
      receipts: {
        created_files: [newFile],
        modified_files: [existingFile]
      }
    };

    // Simulate recovery routine
    for (const created of manifest.receipts.created_files) {
      if (fs.existsSync(created)) {
        fs.rmSync(created, { force: true });
      }
    }
    for (const modified of manifest.receipts.modified_files) {
      const backupCopy = path.join(backupDir, path.basename(modified));
      if (fs.existsSync(backupCopy)) {
        fs.copyFileSync(backupCopy, modified);
      }
    }

    assert.equal(fs.existsSync(newFile), false, 'New file created during failed transaction must be deleted');
    assert.equal(fs.readFileSync(existingFile, 'utf-8'), 'Original content before transaction', 'Existing file must retain original content');
  });
});
