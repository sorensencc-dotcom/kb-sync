import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadQuarantine } from '../scripts/pipeline/cluster-sync-runner.mjs';
import { replacePackFamilyAtomic } from '../scripts/nlm-pack-replace-gate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CLUSTER = pathToFileURL(path.join(REPO_ROOT, 'scripts/pipeline/cluster-sync-runner.mjs')).href;
const TX = pathToFileURL(path.join(REPO_ROOT, 'modules/trm/storage/transaction-manager.mjs')).href;
const INGEST = pathToFileURL(path.join(REPO_ROOT, 'scripts/notebooklm/ingest-nlm-runner.mjs')).href;

function spawnNode(scriptPath, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, stderr }));
  });
}

function writeWorker(dir, name, source) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, source);
  return file;
}

test('two processes recording different quarantine ids keep every entry', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-sync-q-race-'));
  const qFile = path.join(tmp, 'quarantine.json');
  fs.writeFileSync(qFile, JSON.stringify({ quarantined: {} }));
  const worker = writeWorker(tmp, 'worker.mjs', `
    import { recordQuarantine } from ${JSON.stringify(CLUSTER)};
    const prefix = process.env.PREFIX;
    const file = process.env.Q;
    for (let i = 0; i < 40; i++) {
      recordQuarantine(prefix + '-' + i, prefix, 'err', file);
    }
  `);
  const [a, b] = await Promise.all([
    spawnNode(worker, { PREFIX: 'daily', Q: qFile }),
    spawnNode(worker, { PREFIX: 'ops', Q: qFile }),
  ]);
  assert.equal(a.code, 0, a.stderr);
  assert.equal(b.code, 0, b.stderr);
  const data = loadQuarantine(qFile);
  const ids = Object.keys(data.quarantined || {});
  const expected = [];
  for (let i = 0; i < 40; i++) expected.push(`daily-${i}`, `ops-${i}`);
  assert.equal(ids.length, 80, `lost update dropped ${80 - ids.length} quarantine ids`);
  for (const id of expected) {
    assert.ok(data.quarantined[id], `missing ${id}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('overlapping replacePackFamilyAtomic uploads once when the notebook lock is held', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-sync-replace-lock-'));
  const lockPath = path.join(tmp, 'nb.lock');
  const packFile = path.join(tmp, 'pack_master_kb.txt');
  fs.writeFileSync(packFile, 'FILE COUNT: 1\n');
  let uploads = 0;
  const runUpload = async () => {
    uploads += 1;
    await new Promise((r) => setTimeout(r, 250));
    return { source_id: `fresh-${uploads}` };
  };
  let listCall = 0;
  const runList = async () => {
    listCall += 1;
    if (listCall <= 2) return [{ id: 'old-1', title: 'pack_master_kb.txt', status: 2 }];
    return [
      { id: 'old-1', title: 'pack_master_kb.txt', status: 2 },
      { id: `fresh-${uploads}`, title: 'pack_master_kb.txt', status: 2 },
    ];
  };
  const opts = {
    notebookId: '679b8bab-2d87-42cb-a726-6dc54c83acc2',
    packFiles: [packFile],
    expectedPartCount: 1,
    runList,
    runUpload,
    runDelete: async () => true,
    logInfo: () => {},
    logWarn: () => {},
    waitMs: 1,
    lockPath,
    lockTimeoutMs: 80,
  };
  const results = await Promise.allSettled([
    replacePackFamilyAtomic(opts),
    replacePackFamilyAtomic(opts),
  ]);
  const wins = results.filter((r) => r.status === 'fulfilled' && r.value?.success);
  const losses = results.filter((r) => r.status === 'rejected');
  assert.equal(uploads, 1, `both sweeps uploaded (${uploads})`);
  assert.equal(wins.length, 1);
  assert.equal(losses.length, 1);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('cluster telemetry merge keeps pack SHA and stamps FAILED when failed > 0', async () => {
  const { persistClusterTelemetry } = await import('../scripts/pipeline/cluster-sync-runner.mjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-sync-status-'));
  const statusFile = path.join(tmp, '.sync-status.json');
  fs.writeFileSync(statusFile, JSON.stringify({ last_sync_pack_sha: 'abc123', status: 'SUCCESS' }));
  persistClusterTelemetry(
    { target: 'cluster_sync_ops', succeeded: 0, failed: 2, mode: 'ops', total: 2, results: [] },
    statusFile,
  );
  const after = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
  assert.equal(after.last_sync_pack_sha, 'abc123');
  assert.equal(after.status, 'FAILED');
  assert.equal(after.failed, 2);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('wiki success stamp refuses to overwrite a FAILED cluster status', async () => {
  const { applyWikiSyncStatus } = await import('../scripts/sync-github-wiki.mjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-sync-wiki-status-'));
  const statusFile = path.join(tmp, '.sync-status.json');
  fs.writeFileSync(statusFile, JSON.stringify({ last_sync_pack_sha: 'abc123', status: 'FAILED', failed: 2 }));
  applyWikiSyncStatus(statusFile);
  const after = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
  assert.equal(after.status, 'FAILED');
  assert.equal(after.last_sync_pack_sha, 'abc123');
  assert.ok(after.last_sync_timestamp);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('two processes demoting different cadence notebooks keep both entries', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-sync-cadence-'));
  const cadencePath = path.join(tmp, 'cadence_state.json');
  fs.writeFileSync(cadencePath, JSON.stringify({ daily: { cadence: 'idle' }, master: { cadence: 'idle' } }));
  const worker = writeWorker(tmp, 'cadence-worker.mjs', `
    import { writeNotebookCadence } from ${JSON.stringify(pathToFileURL(path.join(REPO_ROOT, 'scripts/run-closed-loop-research-v2.mjs')).href)};
    writeNotebookCadence(process.env.FILE, process.env.NB, {
      cadence: 'PASSIVE_WEEKLY',
      last_source_delta_utc: '2026-01-01T00:00:00.000Z',
      consecutive_idle_days: 4
    });
  `);
  const [a, b] = await Promise.all([
    spawnNode(worker, { FILE: cadencePath, NB: 'daily' }),
    spawnNode(worker, { FILE: cadencePath, NB: 'master' }),
  ]);
  assert.equal(a.code, 0, a.stderr);
  assert.equal(b.code, 0, b.stderr);
  const data = JSON.parse(fs.readFileSync(cadencePath, 'utf8'));
  assert.equal(data.daily.cadence, 'PASSIVE_WEEKLY');
  assert.equal(data.master.cadence, 'PASSIVE_WEEKLY');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('two processes cannot both hold the ingest lock', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-sync-ingest-lock-'));
  const lockPath = path.join(tmp, '.nlm-sync.lock');
  const gate = path.join(tmp, 'go');
  const worker = writeWorker(tmp, 'lock-worker.mjs', `
    import fs from 'node:fs';
    import { acquireIngestLock } from ${JSON.stringify(INGEST)};
    const gate = process.env.GATE;
    while (!fs.existsSync(gate)) {}
    const result = acquireIngestLock(process.env.LOCK);
    fs.writeFileSync(process.env.OUT, JSON.stringify(result));
  `);
  const outA = path.join(tmp, 'a.json');
  const outB = path.join(tmp, 'b.json');
  const pA = spawnNode(worker, { GATE: gate, LOCK: lockPath, OUT: outA });
  const pB = spawnNode(worker, { GATE: gate, LOCK: lockPath, OUT: outB });
  await new Promise((r) => setTimeout(r, 80));
  fs.writeFileSync(gate, 'go');
  const [a, b] = await Promise.all([pA, pB]);
  assert.equal(a.code, 0, a.stderr);
  assert.equal(b.code, 0, b.stderr);
  const ra = JSON.parse(fs.readFileSync(outA, 'utf8'));
  const rb = JSON.parse(fs.readFileSync(outB, 'utf8'));
  const holders = [ra, rb].filter((r) => r.ok);
  const blocked = [ra, rb].filter((r) => !r.ok);
  assert.equal(holders.length, 1);
  assert.equal(blocked.length, 1);
  assert.match(blocked[0].error, /CONCURRENT_RUN_IN_PROGRESS/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('updateJsonLocked concurrent key writes keep both keys', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-sync-json-lock-'));
  const file = path.join(tmp, 'state.json');
  fs.writeFileSync(file, JSON.stringify({}));
  const worker = writeWorker(tmp, 'json-worker.mjs', `
    import { updateJsonLocked } from ${JSON.stringify(TX)};
    const key = process.env.KEY;
    for (let i = 0; i < 30; i++) {
      updateJsonLocked(process.env.FILE, (data) => {
        data[key] = (data[key] || 0) + 1;
        return data;
      });
    }
  `);
  const [a, b] = await Promise.all([
    spawnNode(worker, { FILE: file, KEY: 'daily' }),
    spawnNode(worker, { FILE: file, KEY: 'ops' }),
  ]);
  assert.equal(a.code, 0, a.stderr);
  assert.equal(b.code, 0, b.stderr);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(data.daily, 30);
  assert.equal(data.ops, 30);
  fs.rmSync(tmp, { recursive: true, force: true });
});
