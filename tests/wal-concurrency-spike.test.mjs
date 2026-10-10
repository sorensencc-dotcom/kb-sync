import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { getDatabase, walCheckpoint, compactDatabase } from '../modules/cache/db-schema.mjs';

test('SQLite WAL initialization and pragma verification', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-wal-init-'));
  const dbPath = path.join(tmpDir, 'test-wal.db');

  const db = getDatabase(dbPath);
  const jm = db.prepare('PRAGMA journal_mode;').get();
  assert.equal(jm.journal_mode, 'wal');

  const sync = db.prepare('PRAGMA synchronous;').get();
  assert.equal(sync.synchronous, 1); // 1 = NORMAL

  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('SQLite WAL checkpointing and database compaction behavior', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-wal-compact-'));
  const dbPath = path.join(tmpDir, 'test-compact.db');

  const db = getDatabase(dbPath);

  // Seed documents
  const insertStmt = db.prepare(`
    INSERT INTO kb_documents (id, category, topic, file_path, abstract, content, sha256)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < 200; i++) {
    insertStmt.run(
      `doc-${i}`,
      'research',
      `topic-${i}`,
      `path/to/doc-${i}.md`,
      `Abstract for document ${i}`,
      `Large payload content for document ${i} with padding `.repeat(20),
      `sha256-${i}`
    );
  }

  const cpPassive = walCheckpoint(db, 'PASSIVE');
  assert.ok(typeof cpPassive.checkpointed === 'number');

  // Verify FTS query works
  const ftsMatch = db.prepare('SELECT count(*) as count FROM kb_fts WHERE kb_fts MATCH ?').get('padding');
  assert.equal(ftsMatch.count, 200);

  // Delete half the documents
  db.exec("DELETE FROM kb_documents WHERE id LIKE 'doc-1%'");

  // Compact database
  compactDatabase(db);

  // Check integrity
  const check = db.prepare('PRAGMA integrity_check;').get();
  assert.equal(check.integrity_check, 'ok');

  // Post-compaction checkpoint truncate
  const cpTruncate = walCheckpoint(db, 'TRUNCATE');
  assert.equal(cpTruncate.busy, 0);

  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Concurrent read/write spikes under WAL mode with zero lock timeouts', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-wal-spike-'));
  const dbPath = path.join(tmpDir, 'spike.db');

  // Seed initial dataset
  const initDb = getDatabase(dbPath);
  const seedStmt = initDb.prepare(`
    INSERT INTO kb_documents (id, category, topic, file_path, abstract, content, sha256)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (let i = 0; i < 50; i++) {
    seedStmt.run(`seed-${i}`, 'research', `topic-${i}`, `wiki/${i}.md`, `Abstract ${i}`, `Initial content ${i}`, `sha-${i}`);
  }
  walCheckpoint(initDb, 'TRUNCATE');
  initDb.close();

  const workerCode = `
import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

async function run() {
  const { getDatabase } = await import(pathToFileURL(workerData.dbSchemaPath).href);
  const db = getDatabase(workerData.dbPath, { readonly: workerData.readonly });
  const opCount = workerData.opCount;
  const isWriter = !workerData.readonly;
  const latencies = [];

  try {
    if (isWriter) {
      const stmt = db.prepare(\`
        INSERT INTO kb_documents (id, category, topic, file_path, abstract, content, sha256)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET content = excluded.content
      \`);
      for (let i = 0; i < opCount; i++) {
        const t0 = performance.now();
        stmt.run('w-' + workerData.workerId + '-' + i, 'spike', 'spike-topic', 'spike.md', 'Abs', 'Spike content ' + i, 'sha' + i);
        latencies.push(performance.now() - t0);
      }
    } else {
      const stmt = db.prepare('SELECT id, abstract FROM kb_documents ORDER BY last_updated DESC LIMIT 10');
      const ftsStmt = db.prepare('SELECT count(*) as count FROM kb_fts WHERE kb_fts MATCH ?');
      for (let i = 0; i < opCount; i++) {
        const t0 = performance.now();
        stmt.all();
        ftsStmt.get('content OR Initial');
        latencies.push(performance.now() - t0);
      }
    }
    db.close();
    parentPort.postMessage({ ok: true, latencies, workerId: workerData.workerId });
  } catch (err) {
    db.close();
    parentPort.postMessage({ ok: false, error: err.message, workerId: workerData.workerId });
  }
}

run();
`;

  const workerScript = path.join(tmpDir, 'worker.mjs');
  fs.writeFileSync(workerScript, workerCode);

  const dbSchemaPath = path.resolve('modules/cache/db-schema.mjs');

  const NUM_WRITERS = 4;
  const NUM_READERS = 8;
  const OPS_PER_WORKER = 50;

  const workers = [];
  const startTime = Date.now();

  function spawnWorker(workerId, readonly) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerScript, {
        workerData: {
          workerId,
          readonly,
          dbPath,
          dbSchemaPath,
          opCount: OPS_PER_WORKER
        }
      });
      worker.on('message', resolve);
      worker.on('error', reject);
      worker.on('exit', code => {
        if (code !== 0) reject(new Error('Worker exited with code ' + code));
      });
    });
  }

  // Launch readers and writers concurrently
  for (let i = 0; i < NUM_WRITERS; i++) {
    workers.push(spawnWorker('writer-' + i, false));
  }
  for (let i = 0; i < NUM_READERS; i++) {
    workers.push(spawnWorker('reader-' + i, true));
  }

  const results = await Promise.all(workers);
  const totalDurationMs = Date.now() - startTime;

  for (const res of results) {
    assert.equal(res.ok, true, 'Worker ' + res.workerId + ' failed: ' + res.error);
  }

  // Verify final database state and perform WAL checkpoint truncate
  const verifyDb = getDatabase(dbPath);
  const countRow = verifyDb.prepare('SELECT count(*) as count FROM kb_documents').get();
  assert.equal(countRow.count, 50 + (NUM_WRITERS * OPS_PER_WORKER));

  const cpFinal = walCheckpoint(verifyDb, 'TRUNCATE');
  assert.equal(cpFinal.busy, 0);

  const walPath = dbPath + '-wal';
  const walStats = fs.existsSync(walPath) ? fs.statSync(walPath) : { size: 0 };

  console.log(`[WAL-SPIKE-PROFILE] Completed ${NUM_WRITERS * OPS_PER_WORKER} writes and ${NUM_READERS * OPS_PER_WORKER * 2} reads across ${NUM_WRITERS + NUM_READERS} workers in ${totalDurationMs}ms. WAL post-truncate size: ${walStats.size} bytes.`);

  verifyDb.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
