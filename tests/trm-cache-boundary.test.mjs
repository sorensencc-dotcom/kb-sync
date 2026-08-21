import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDatabase } from '../modules/cache/db-schema.mjs';
import {
  parseGapItems,
  triageGapAgainstCache,
  executeGapTriage
} from '../modules/trm/gap-triage-engine.mjs';
import {
  handleQueryContextCache,
  handleFetchTopicNote,
  processRpcMessage
} from '../scripts/mcp-memory-server.mjs';

describe('TRM and local-cache boundary coverage', () => {
  test('parseGapItems preserves pending, in-progress, and resolved states', () => {
    const gaps = parseGapItems([
      '- [ ] [GAP-01] Pending gap: Needs evidence',
      '- [/] [GAP-02] Active gap: Work started',
      '- [x] [GAP-03] Closed gap: Resolved'
    ].join('\n'));

    assert.deepEqual(gaps.map((gap) => [gap.id, gap.status]), [
      ['GAP-01', 'pending'],
      ['GAP-02', 'in-progress'],
      ['GAP-03', 'resolved']
    ]);
    assert.equal(gaps[0].title, 'Pending gap');
    assert.equal(gaps[0].description, 'Needs evidence');
  });

  test('triageGapAgainstCache returns explicit no-match evidence', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trm-boundary-'));
    const db = getDatabase(path.join(root, 'cache.db'));
    try {
      const result = triageGapAgainstCache(db, {
        id: 'GAP-01',
        title: 'Unrepresented protocol',
        description: 'No document contains this phrase'
      });

      assert.deepEqual(result.matchedDocuments, []);
      assert.deepEqual(result.citations, []);
      assert.match(result.rfcContent, /No immediate lexical matches found/);
    } finally {
      db.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('executeGapTriage dry-run does not create RFCs or mutate gaps', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trm-dry-run-'));
    const gapsPath = path.join(root, 'trm-research-gaps.md');
    const outputDir = path.join(root, 'wiki', 'research');
    const dbPath = path.join(root, 'cache.db');
    fs.writeFileSync(gapsPath, '- [ ] [GAP-01] Missing proof: Validate runtime path\n');
    const db = getDatabase(dbPath);
    db.close();

    try {
      const result = executeGapTriage({ gapsFilePath: gapsPath, outputDir, dbPath, dryRun: true });

      assert.equal(result.processed, 1);
      assert.equal(fs.readFileSync(gapsPath, 'utf8'), '- [ ] [GAP-01] Missing proof: Validate runtime path\n');
      assert.equal(fs.existsSync(outputDir), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('MCP handlers reject blank and non-string inputs with structured errors', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-boundary-'));
    const db = getDatabase(path.join(root, 'cache.db'));
    try {
      assert.equal(handleQueryContextCache(db, { query: '  ' }).isError, true);
      assert.equal(handleFetchTopicNote(db, { topic: 42 }).isError, true);
    } finally {
      db.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('MCP JSON-RPC returns null for notifications and structured unknown-tool errors', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-boundary-'));
    const db = getDatabase(path.join(root, 'cache.db'));
    try {
      assert.equal(processRpcMessage(db, { jsonrpc: '2.0', method: 'notifications/initialized' }), null);
      const response = processRpcMessage(db, {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'not-a-real-tool', arguments: {} }
      });
      assert.equal(response?.id, 7);
      assert.equal(response?.error?.code, -32601);
    } finally {
      db.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
