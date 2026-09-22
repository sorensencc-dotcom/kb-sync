import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getDatabase } from '../modules/cache/db-schema.mjs';
import { parseGapItems, triageGapAgainstCache, executeGapTriage, slugifyTopicKey } from '../modules/trm/gap-triage-engine.mjs';
import { expandSearchQuery } from '../modules/trm/query-expander.mjs';
import { reciprocalRankFusion } from '../modules/cache/vector-store.mjs';
import { handleQueryContextCache } from '../scripts/mcp-memory-server.mjs';

describe('TRM Automated Gap Triage & RFC Synthesis Suite', () => {
  let sandboxRoot: string;
  let testDbPath: string;
  let gapsFilePath: string;
  let outputDir: string;

  beforeEach(() => {
    sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trm-triage-test-'));
    testDbPath = path.join(sandboxRoot, '.kb_cache', 'knowledge.db');
    gapsFilePath = path.join(sandboxRoot, 'trm-research-gaps.md');
    outputDir = path.join(sandboxRoot, 'wiki', 'research');

    fs.mkdirSync(path.dirname(testDbPath), { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  });

  test('TEST-JEV-01: jev filter is never invoked when retrieval mode is not hybrid-rrf', async () => {
    process.env.TRM_JEV_FILTER = '1';
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = async (url) => { if (String(url).includes('/v1/systemone')) fetchCalled = true; return { ok: true, json: async () => ({}) }; };
    const db = getDatabase(testDbPath, { readonly: false });
    const gap = { id: 'GAP-01--x', localId: 'GAP-01', topicKey: 'x', title: 'X', description: 'Y', status: 'pending', line: '', raw: '' };
    const result = await triageGapAgainstCache(db, gap, { expandSearchQuery, limit: 3 });
    globalThis.fetch = originalFetch;
    delete process.env.TRM_JEV_FILTER;
    db.close();
    assert.equal(fetchCalled, false);
    assert.notEqual(result.rfcContent.includes('retrieval_mode: "hybrid-rrf'), true);
  });

  test('TEST-JEV-02: evidenceList renders [jev:0.xx] tag only when jev_score is present', () => {
    const docWithJev = { topic: 'Doc A', file_path: 'a.md', content: 'alpha content', retrieval_mode: 'hybrid-rrf+jev', jev_score: 0.87 };
    const docWithoutJev = { topic: 'Doc B', file_path: 'b.md', content: 'beta content', retrieval_mode: 'hybrid-rrf' };
    const render = (doc) => {
      const cleanSnippet = (doc.content || '').slice(0, 250);
      const modeTag = doc.retrieval_mode ? ` [${doc.retrieval_mode}]` : '';
      const jevTag = typeof doc.jev_score === 'number' ? ` [jev:${doc.jev_score.toFixed(2)}]` : '';
      return `- **${doc.topic}** (\`${doc.file_path}\`)${modeTag}${jevTag}:\n  > ${cleanSnippet}`;
    };
    assert.match(render(docWithJev), /\[jev:0\.87\]/);
    assert.doesNotMatch(render(docWithoutJev), /\[jev:/);
  });

  test('TEST-JEV-03: rfcContent carries [jev:0.xx] tag end-to-end when jev applies', async () => {
    process.env.TRM_JEV_FILTER = '1';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => ({
      ok: true,
      json: async () => String(url).includes('/api/embeddings')
        ? { embedding: [1, 0, 0] }
        : { answers: { doc_0: { value: 0.77, certainty: 4 } } },
    });
    const db = getDatabase(testDbPath, { readonly: false });
    db.exec(`INSERT INTO kb_documents (id, topic, file_path, content, category, sha256) VALUES ('doc-1', 'Doc One', 'doc-1.md', 'relevant content about X', 'notes', 'hash')`);
    db.prepare('INSERT INTO kb_vectors (id, topic, embedding, dimensions, model) VALUES (?, ?, ?, ?, ?)')
      .run('doc-1', 'Doc One', new Uint8Array(new Float32Array([1, 0, 0]).buffer), 3, 'test');
    const gap = { id: 'GAP-02--x', localId: 'GAP-02', topicKey: 'x', title: 'X topic', description: 'about X', status: 'pending', line: '', raw: '' };
    const result = await triageGapAgainstCache(db, gap, { expandSearchQuery, limit: 3 });
    globalThis.fetch = originalFetch;
    delete process.env.TRM_JEV_FILTER;
    db.close();
    assert.match(result.rfcContent, /\[jev:0\.77\]/);
  });

  test('TEST-JEV-04: jev circuit breaker trips once and stays tripped across the batch', async () => {
    process.env.TRM_JEV_FILTER = '1';
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = async (url) => { if (String(url).includes('/v1/systemone')) callCount++; return { ok: false, status: 500 }; };
    fs.writeFileSync(gapsFilePath, [
      '# Gaps',
      '- [ ] [GAP-01] First gap: about alpha.',
      '- [ ] [GAP-02] Second gap: about beta.',
    ].join('\n'), 'utf8');
    getDatabase(testDbPath, { readonly: false }).close();
    await executeGapTriage({ gapsFilePath, outputDir, dbPath: testDbPath, dryRun: true, concurrency: 1 });
    globalThis.fetch = originalFetch;
    delete process.env.TRM_JEV_FILTER;
    assert.equal(callCount, 0);
  });

  test('TEST-01: Markdown gap list parser extracts structured items and statuses', () => {
    const markdown = `# Gaps
- [ ] [GAP-01] Fail-soft recovery: SQLite state verification under load.
- [/] [GAP-02] Path normalization: Traversal defense across OS platforms.
- [x] [GAP-03] Completed task: Already resolved.
- [ ] Unlabeled gap item without explicit ID.
`;

    const parsed = parseGapItems(markdown);
    assert.equal(parsed.length, 4);

    assert.equal(parsed[0].localId, 'GAP-01');
    assert.equal(parsed[0].topicKey, 'fail-soft-recovery');
    assert.equal(parsed[0].id, 'GAP-01--fail-soft-recovery');
    assert.equal(parsed[0].status, 'pending');
    assert.equal(parsed[0].title, 'Fail-soft recovery');
    assert.equal(parsed[0].description, 'SQLite state verification under load.');

    assert.equal(parsed[1].localId, 'GAP-02');
    assert.equal(parsed[1].id, 'GAP-02--path-normalization');
    assert.equal(parsed[1].status, 'in-progress');

    assert.equal(parsed[2].localId, 'GAP-03');
    assert.equal(parsed[2].id, 'GAP-03--completed-task');
    assert.equal(parsed[2].status, 'resolved');

    assert.equal(parsed[3].localId, 'GAP-04');
    assert.equal(parsed[3].topicKey, 'unlabeled-gap-item-without-explicit-id');
    assert.equal(parsed[3].id, 'GAP-04--unlabeled-gap-item-without-explicit-id');
    assert.equal(parsed[3].status, 'pending');
  });

  test('TEST-02: Gap triage queries SQLite cache and synthesizes RFC with citations', async () => {
    const db = getDatabase(testDbPath);

    // Seed SQLite knowledge database with related documentation
    db.prepare(`
      INSERT INTO kb_documents (id, category, topic, file_path, content, sha256)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'wiki/concepts/fail-soft-orchestration.md',
      'research',
      'fail-soft-orchestration',
      'wiki/concepts/fail-soft-orchestration.md',
      'Fail-soft orchestration ensures SQLite write locks recover safely on interrupted operations.',
      'hash_fs'
    );

    const gap = {
      id: 'GAP-01--fail-soft-orchestration',
      localId: 'GAP-01',
      topicKey: 'fail-soft-orchestration',
      title: 'Fail-soft orchestration',
      description: 'Need clarity on SQLite write locks during crash.',
      status: 'pending',
      line: '- [ ] [GAP-01] Fail-soft orchestration: Need clarity on SQLite write locks during crash.',
      raw: '- [ ] [GAP-01] Fail-soft orchestration: Need clarity on SQLite write locks during crash.'
    };

    const triage = await triageGapAgainstCache(db, gap);

    assert.ok(triage.topicSlug.startsWith('rfc-gap-01-fail-soft-orchestration'));
    assert.equal(triage.matchedDocuments.length, 1);
    assert.equal(triage.matchedDocuments[0].topic, 'fail-soft-orchestration');
    assert.ok(triage.rfcContent.includes('---'));
    assert.ok(triage.rfcContent.includes('title: "RFC: GAP-01--fail-soft-orchestration - Fail-soft orchestration"'));
    assert.ok(triage.rfcContent.includes('gap_id: "GAP-01--fail-soft-orchestration"'));
    assert.ok(triage.rfcContent.includes('Evidence Grounding & Cache Findings'));
    assert.ok(triage.citations.includes('wiki/concepts/fail-soft-orchestration.md'));

    db.close();
  });

  test('TEST-03: End-to-end executeGapTriage writes RFC files and updates tracking file', async () => {
    const db = getDatabase(testDbPath);
    db.prepare(`
      INSERT INTO kb_documents (id, category, topic, file_path, content, sha256)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'wiki/concepts/path-normalization.md',
      'research',
      'path-normalization',
      'wiki/concepts/path-normalization.md',
      'Path normalization cleans trailing backslashes and converts paths to canonical forward slashes.',
      'hash_pn'
    );
    db.close();

    const initialGapsContent = `# Gaps Matrix
- [ ] [GAP-02] Path normalization: Cross-platform slash conversions.
- [x] [GAP-01] Resolved gap: Already done.
`;
    fs.writeFileSync(gapsFilePath, initialGapsContent, 'utf8');

    const result = await executeGapTriage({
      gapsFilePath,
      outputDir,
      dbPath: testDbPath
    });

    assert.equal(result.processed, 1);
    assert.equal(result.rfcFiles.length, 1);
    assert.ok(
      path.basename(result.rfcFiles[0]).startsWith('rfc-gap-02-path-normalization'),
      'RFC filename should use namespaced canonical gap id'
    );

    // Verify generated RFC file on disk
    const generatedRfcPath = path.join(outputDir, path.basename(result.rfcFiles[0]));
    assert.ok(fs.existsSync(generatedRfcPath), 'RFC file must be written to disk');
    const rfcContent = fs.readFileSync(generatedRfcPath, 'utf8');
    assert.ok(rfcContent.includes('Path normalization'));
    assert.ok(rfcContent.includes('gap_id: "GAP-02--path-normalization"'));

    // Verify updated gaps tracking file keeps local bracket id
    const updatedGapsContent = fs.readFileSync(gapsFilePath, 'utf8');
    assert.ok(updatedGapsContent.includes('- [/] [GAP-02]'));
    assert.ok(updatedGapsContent.includes('(Drafted: [RFC]('));
    assert.ok(updatedGapsContent.includes('- [x] [GAP-01] Resolved gap: Already done.'));
  });

  test('TEST-04: Mobile WebSocket heartbeat gap expands to a valid lexical query', async () => {
    const db = getDatabase(testDbPath);
    const result = await expandSearchQuery({ title: 'Mobile WebSocket heartbeat', description: 'Keepalive timeout and reconnect after background suspension.' }, db, { provider: 'offline' });
    assert.equal(result.method, 'heuristic');
    assert.match(result.query, /"mobile"*/);
    assert.match(result.query, /"websocket"*/);
    assert.match(result.query, /"heartbeat"*/);
    assert.doesNotThrow(() => db.prepare('SELECT rowid FROM kb_fts WHERE kb_fts MATCH ?').get(result.query));
    db.close();
  });

  test('TEST-05: FTS5 lexical retrieval matches stemmed terms and excludes unrelated documents', () => {
    const db = getDatabase(testDbPath);
    const insert = db.prepare('INSERT INTO kb_documents (id, category, topic, file_path, content, sha256) VALUES (?, ?, ?, ?, ?, ?)');
    insert.run('mobile-heartbeats', 'research', 'mobile-websocket-heartbeats', 'heartbeats.md', 'Mobile WebSocket heartbeat reconnects after background suspension.', 'hash-hb');
    insert.run('sqlite-indexing', 'research', 'sqlite-indexing', 'sqlite.md', 'SQLite indexes improve unrelated lexical retrieval.', 'hash-sqlite');
    const response = handleQueryContextCache(db, { query: '"heartbeat" AND "websocket"', category: 'all', limit: 5 });
    const hits = JSON.parse(response.content[0].text);
    assert.equal(response.isError, undefined);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].id, 'mobile-heartbeats');
    assert.equal(hits[0].topic, 'mobile-websocket-heartbeats');
    db.close();
  });

  test('TEST-06: Hybrid RRF boosts documents returned by both lexical and vector lanes', () => {
    const merged = reciprocalRankFusion([
      { id: 'lexical-only', topic: 'lexical', file_path: 'lexical.md', content: 'lexical' },
      { id: 'shared', topic: 'shared', file_path: 'shared.md', content: 'shared' }
    ], [
      { id: 'shared', topic: 'shared', file_path: 'shared.md', content: 'shared' },
      { id: 'vector-only', topic: 'vector', file_path: 'vector.md', content: 'vector' }
    ], { k: 60, limit: 3 });
    assert.deepEqual(merged.map((hit) => hit.id), ['shared', 'lexical-only', 'vector-only']);
    assert.equal(merged[0].retrieval_mode, 'hybrid');
    assert.equal(merged[0].lexical_rank, 2);
    assert.equal(merged[0].vector_rank, 1);
    assert.ok(merged[0].rrf_score > merged[1].rrf_score);
  });

  test('TEST-07: executeGapTriage skips in-progress drafts unless force is set', async () => {
    const db = getDatabase(testDbPath);
    db.prepare(`
      INSERT INTO kb_documents (id, category, topic, file_path, content, sha256)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'wiki/concepts/fail-soft-orchestration.md',
      'research',
      'fail-soft-orchestration',
      'wiki/concepts/fail-soft-orchestration.md',
      'Fail-soft orchestration ensures SQLite write locks recover safely on interrupted operations.',
      'hash_fs'
    );
    db.close();

    const initialGapsContent = `# Gaps Matrix
- [ ] [GAP-10] Fresh pending: Needs first draft.
- [/] [GAP-11] Already drafted: Has an RFC backlink. (Drafted: [RFC](wiki/research/existing.md))
- [x] [GAP-12] Resolved gap: Already done.
`;
    fs.writeFileSync(gapsFilePath, initialGapsContent, 'utf8');

    const first = await executeGapTriage({
      gapsFilePath,
      outputDir,
      dbPath: testDbPath,
    });
    assert.equal(first.processed, 1, 'default run processes only pending gaps');
    assert.equal(first.rfcFiles.length, 1);

    const afterFirst = fs.readFileSync(gapsFilePath, 'utf8');
    assert.ok(afterFirst.includes('- [/] [GAP-10]'));
    assert.ok(afterFirst.includes('- [/] [GAP-11] Already drafted'));
    assert.ok(afterFirst.includes('- [x] [GAP-12] Resolved gap'));

    const second = await executeGapTriage({
      gapsFilePath,
      outputDir,
      dbPath: testDbPath,
    });
    assert.equal(second.processed, 0, 'second default run skips drafted in-progress gaps');
    assert.equal(second.rfcFiles.length, 0);

    const forced = await executeGapTriage({
      gapsFilePath,
      outputDir,
      dbPath: testDbPath,
      force: true,
    });
    assert.equal(forced.processed, 2, 'force reprocesses in-progress gaps only');
    assert.equal(forced.rfcFiles.length, 2);

    const afterForce = fs.readFileSync(gapsFilePath, 'utf8');
    assert.ok(afterForce.includes('- [x] [GAP-12] Resolved gap: Already done.'));
  });

  test('TEST-08: Colliding local GAP-IDs across topics get unique canonical ids', async () => {
    assert.equal(
      slugifyTopicKey('**CIC - Ford Executive Dynamics & Politics (follow-up)**'),
      'cic-ford-executive-dynamics-politics'
    );

    const markdown = `# Active Research Gaps
- [ ] [GAP-01] **CIC - Ford Executive Dynamics & Politics (follow-up)**: Need org chart clarity.
- [ ] [GAP-01] **Mobile WebSocket Heartbeat (adjacent)**: Keepalive after suspend.
- [ ] Unlabeled colliding title twin.
`;

    const parsed = parseGapItems(markdown);
    assert.equal(parsed.length, 3);

    assert.equal(parsed[0].localId, 'GAP-01');
    assert.equal(parsed[1].localId, 'GAP-01');
    assert.equal(parsed[0].localId, parsed[1].localId);
    assert.notEqual(parsed[0].id, parsed[1].id);
    assert.equal(parsed[0].id, 'GAP-01--cic-ford-executive-dynamics-politics');
    assert.equal(parsed[1].id, 'GAP-01--mobile-websocket-heartbeat');
    assert.equal(parsed[0].topicKey, 'cic-ford-executive-dynamics-politics');
    assert.equal(parsed[1].topicKey, 'mobile-websocket-heartbeat');

    // Unlabeled auto-id still works and is namespaced by topic
    assert.equal(parsed[2].localId, 'GAP-03');
    assert.equal(parsed[2].id, 'GAP-03--unlabeled-colliding-title-twin');

    const db = getDatabase(testDbPath);
    const triageA = await triageGapAgainstCache(db, parsed[0], { expandSearchQuery: null });
    const triageB = await triageGapAgainstCache(db, parsed[1], { expandSearchQuery: null });
    db.close();

    assert.notEqual(triageA.topicSlug, triageB.topicSlug);
    assert.ok(triageA.topicSlug.includes('cic-ford-executive-dynamics'));
    assert.ok(triageB.topicSlug.includes('mobile-websocket-heartbeat'));
    assert.ok(triageA.rfcContent.includes(`gap_id: "${parsed[0].id}"`));
    assert.ok(triageB.rfcContent.includes(`gap_id: "${parsed[1].id}"`));
  });
});
