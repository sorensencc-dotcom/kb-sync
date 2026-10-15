#!/usr/bin/env node
/**
 * scripts/notebooklm/ingest-nlm-runner.mjs
 *
 * Hardened, RPC-level NotebookLM Ingestion Runner using the native `nlm` CLI.
 * 
 * Features:
 *   - Preflight auth check (fails fast with code 2 if re-auth required)
 *   - File size budget enforcement (KIS-P <= 380 KiB)
 *   - Idempotency receipts (.nlm-sync-receipt.json per staging folder)
 *   - Micro-batch processing (1-2 sources per step)
 *   - Server-side source verification (confirms existence in NotebookLM)
 *   - Dead-letter quarantine (.dead-letter/ on individual failure without crashing sweep)
 *   - Concurrency lockfile protection
 *
 * Usage:
 *   node ingest-nlm-runner.mjs <notebookUuid> [options]
 *
 * Options:
 *   --staging-dir <path>   Directory containing staged files (default: _kb-sync-staging/<uuid>)
 *   --batch-size <number>  Max sources per batch (default: 2, max: 3)
 *   --dry-run              Verify auth and stage files without uploading
 *   --force                Re-upload files even if present in receipts
 *
 * Exit Codes:
 *   0 = Success (all items ingested or already synced)
 *   1 = Partial failures (failed items quarantined to dead-letter)
 *   2 = Auth / Session Failure (re-authentication required)
 *   3 = Environment / Parameter / Lock error
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertLiveSandbox, findActiveUploadedSource } from './sandbox-contract.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAX_PAYLOAD_BYTES = 380 * 1024; // 380 KiB KIS-P limit
const RECEIPT_FILE_NAME = '.nlm-sync-receipt.json';
const DEAD_LETTER_DIR_NAME = '.dead-letter';
const LOCK_FILE_NAME = '.nlm-sync.lock';

// --- Parse Arguments ---
const args = process.argv.slice(2);
const flags = {};
const positional = [];

for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const key = args[i].slice(2);
    if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
      flags[key] = args[++i];
    } else {
      flags[key] = true;
    }
  } else {
    positional.push(args[i]);
  }
}

const notebookUuid = positional[0] || flags['notebook'] || flags['notebook-id'] || process.env.NOTEBOOK_ID;
if (process.env.NLM_LIVE_SANDBOX === '1') assertLiveSandbox(notebookUuid);
if (!notebookUuid) {
  console.error(JSON.stringify({
    ok: false,
    error: 'MISSING_NOTEBOOK_UUID',
    message: 'Usage: node ingest-nlm-runner.mjs <notebookUuid> [--staging-dir <path>]',
    staged: 0,
    failed: []
  }, null, 2));
  process.exit(3);
}

const isDryRun = Boolean(flags['dry-run']);
const isForce = Boolean(flags['force']);
const batchSize = Math.min(Math.max(parseInt(flags['batch-size'] || '2', 10), 1), 3);

const stagingDir = flags['staging-dir']
  ? path.resolve(flags['staging-dir'])
  : path.resolve(process.cwd(), '_kb-sync-staging', notebookUuid);

const receiptPath = path.join(stagingDir, RECEIPT_FILE_NAME);
const deadLetterDir = path.join(stagingDir, DEAD_LETTER_DIR_NAME);
const lockPath = path.join(stagingDir, LOCK_FILE_NAME);

// --- Report Payload ---
const report = {
  notebookUuid,
  timestamp: new Date().toISOString(),
  staged: 0,
  ingested: 0,
  uploadedSourceIds: [],
  skippedAlreadySynced: 0,
  failed: [],
  ok: true,
  error: null
};

// --- Helper Functions ---
function computeFileHash(filePath) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.alloc(64 * 1024);
  const fd = fs.openSync(filePath, 'r');
  try {
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function resolveNlmRunner() {
  if (process.env.NLM_CLI) {
    const parts = process.env.NLM_CLI.trim().split(/\s+/);
    return { cmd: parts[0], dialect: 'nlm', prefix: parts.slice(1) };
  }

  const check = spawnSync('nlm', ['--version'], { encoding: 'utf8', timeout: 5000, shell: process.platform === 'win32' });
  if (check.status === 0) return { cmd: 'nlm', dialect: 'nlm', prefix: [] };

  const pyCheck = spawnSync('notebooklm', ['--version'], { encoding: 'utf8', timeout: 5000, shell: process.platform === 'win32' });
  if (pyCheck.status === 0) return { cmd: 'notebooklm', dialect: 'notebooklm', prefix: [] };

  const uvCheck = spawnSync('uv', ['--version'], { encoding: 'utf8', timeout: 5000 });
  const localPyproject = path.resolve(__dirname, '../../notebooklm-mcp-cli/pyproject.toml');
  if (uvCheck.status === 0 && fs.existsSync(localPyproject)) {
    return { cmd: 'uv', dialect: 'nlm', prefix: ['--directory', path.dirname(localPyproject), 'run', 'nlm'] };
  }

  return null;
}

function buildSourceAddArgs(runner, notebookUuid, filePath) {
  if (runner.dialect === 'nlm') {
    return ['source', 'add', notebookUuid, '--file', filePath, '--wait', '--json'];
  }
  return ['source', 'add', '--notebook', notebookUuid, filePath, '--wait', '--json'];
}

function buildSourceListArgs(runner, notebookUuid) {
  if (runner.dialect === 'nlm') {
    return ['source', 'list', notebookUuid, '--json'];
  }
  return ['source', 'list', '--notebook', notebookUuid, '--json'];
}

function runNlm(runner, nlmArgs, timeoutMs = 120000) {
  const fullArgs = [...runner.prefix, ...nlmArgs];
  const res = spawnSync(runner.cmd, fullArgs, {
    encoding: 'utf8',
    timeout: timeoutMs,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return res;
}

function loadReceipts() {
  if (fs.existsSync(receiptPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      return parsed?.receipts && typeof parsed.receipts === 'object' && !Array.isArray(parsed.receipts)
        ? parsed : { receipts: {} };
    } catch {
      return { receipts: {} };
    }
  }
  return { receipts: {} };
}

function listSources(runner) {
  const result = runNlm(runner, buildSourceListArgs(runner, notebookUuid), 30000);
  if (result.status !== 0) throw new Error(`SOURCE_LIST_FAILED: ${result.stderr || result.stdout}`);
  const parsed = JSON.parse(result.stdout);
  const sources = Array.isArray(parsed) ? parsed : parsed?.sources;
  if (!Array.isArray(sources)) throw new Error('SOURCE_LIST_INVALID: expected source array');
  const seenIds = new Set();
  for (const source of sources) {
    if (!source || typeof source !== 'object') throw new Error('SOURCE_LIST_INVALID: source entry must be an object');
    const id = source.id || source.sourceId || source.source_id;
    if (typeof id !== 'string' || !id) throw new Error('SOURCE_LIST_INVALID: source entry missing ID');
    if (seenIds.has(id)) throw new Error(`SOURCE_LIST_INVALID: duplicate source ID ${id}`);
    seenIds.add(id);
  }
  return sources;
}

function saveReceipt(receiptsData, key, details) {
  receiptsData.receipts[key] = {
    ...details,
    syncedAt: new Date().toISOString()
  };
  fs.writeFileSync(receiptPath, JSON.stringify(receiptsData, null, 2), 'utf8');
}

function quarantineFile(filePath, reason) {
  if (!fs.existsSync(deadLetterDir)) {
    fs.mkdirSync(deadLetterDir, { recursive: true });
  }
  const dest = path.join(deadLetterDir, path.basename(filePath));
  try {
    fs.copyFileSync(filePath, dest);
    const metaPath = `${dest}.error.json`;
    fs.writeFileSync(metaPath, JSON.stringify({
      quarantinedAt: new Date().toISOString(),
      reason,
      sourcePath: filePath
    }, null, 2), 'utf8');
  } catch (err) {
    console.error(`[-] Failed to copy to dead-letter: ${err.message}`);
  }
}

// --- Main Flow ---
function main() {
  // 1. Ensure Staging Directory Exists
  if (!fs.existsSync(stagingDir)) {
    fs.mkdirSync(stagingDir, { recursive: true });
  }

  // 2. Concurrency Lock
  if (fs.existsSync(lockPath)) {
    try {
      const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      const ageMs = Date.now() - new Date(lockData.createdAt).getTime();
      let pidAlive = false;
      try {
        process.kill(lockData.pid, 0);
        pidAlive = true;
      } catch {
        pidAlive = false;
      }

      if (!pidAlive || ageMs > 30 * 60 * 1000) {
        console.warn(`[WARN] Removing stale lockfile from ${!pidAlive ? 'dead' : 'expired'} PID ${lockData.pid}`);
        fs.unlinkSync(lockPath);
      } else {
        report.ok = false;
        report.error = `CONCURRENT_RUN_IN_PROGRESS: Lock held by live PID ${lockData.pid}`;
        console.error(JSON.stringify(report, null, 2));
        return 3;
      }
    } catch {
      fs.unlinkSync(lockPath);
    }
  }

  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), 'utf8');

  try {
    // 3. Resolve CLI Runtime
    const runner = resolveNlmRunner();
    if (!runner) {
      report.ok = false;
      report.error = 'NLM_RUNTIME_NOT_FOUND: Neither nlm, notebooklm, nor uv-managed project found.';
      console.error(JSON.stringify(report, null, 2));
      return 3;
    }

    // 4. Preflight Auth Check
    console.error(`[*] Verifying NotebookLM authentication...`);
    const authRes = runNlm(runner, ['login', '--check'], 15000);
    if (authRes.status !== 0) {
      report.ok = false;
      report.error = `AUTH_INVALID_RELOGIN_REQUIRED: ${authRes.stderr || authRes.stdout || 'Auth check returned non-zero'}`.trim();
      console.log(JSON.stringify(report, null, 2));
      return 2;
    }
    console.error(`[✓] NotebookLM authentication valid.`);

    // 5. Discover Staged Files
    const stagedFiles = fs.readdirSync(stagingDir)
      .filter(f => !f.startsWith('.') && fs.statSync(path.join(stagingDir, f)).isFile())
      .map(f => path.join(stagingDir, f));

    report.staged = stagedFiles.length;

    if (isDryRun || stagedFiles.length === 0) {
      console.error(`[*] Staged: ${report.staged}. DryRun: ${isDryRun}. Exiting nominal.`);
      console.log(JSON.stringify(report, null, 2));
      return 0;
    }

    // 6. Check Receipts
    const receiptsData = loadReceipts();
    const currentSources = listSources(runner);
    const existingSourceIds = new Set(currentSources.map(source => source.id || source.sourceId || source.source_id));
    const pendingFiles = [];

    for (const filePath of stagedFiles) {
      const fileName = path.basename(filePath);
      const hash = computeFileHash(filePath);
      const receiptKey = `${notebookUuid}::${fileName}::${hash}`;

      if (!isForce && findActiveUploadedSource(currentSources, receiptsData.receipts[receiptKey]?.sourceId)) {
        report.skippedAlreadySynced++;
      } else {
        pendingFiles.push({ filePath, fileName, hash, receiptKey });
      }
    }

    console.error(`[*] Total: ${stagedFiles.length} | Already synced: ${report.skippedAlreadySynced} | Pending: ${pendingFiles.length}`);

    // 7. Micro-Batch Upload Loop
    for (let i = 0; i < pendingFiles.length; i += batchSize) {
      const batch = pendingFiles.slice(i, i + batchSize);
      console.error(`\n[+] Processing batch ${Math.floor(i / batchSize) + 1} (${batch.length} files)...`);

      for (const item of batch) {
        const { filePath, fileName, hash, receiptKey } = item;

        try {
          // Payload Budget Validation (KIS-P <= 380 KiB)
          const stats = fs.statSync(filePath);
          if (stats.size > MAX_PAYLOAD_BYTES) {
            throw new Error(`PAYLOAD_EXCEEDS_BUDGET: File is ${(stats.size / 1024).toFixed(1)} KiB (max 380 KiB)`);
          }

          console.error(`    --> Uploading: ${fileName}`);
          const addArgs = buildSourceAddArgs(runner, notebookUuid, filePath);
          const addRes = runNlm(runner, addArgs, 90000);
          if (addRes.status !== 0) {
            throw new Error(`CLI_SOURCE_ADD_FAILED (${addRes.status}): ${addRes.stderr || addRes.stdout}`);
          }
          const added = JSON.parse(addRes.stdout);
          const uploadedSourceId = added.source_id || added.id || added.source?.id;
          if (typeof uploadedSourceId !== 'string' || !uploadedSourceId) throw new Error('UPLOAD_SOURCE_ID_MISSING');
          if (existingSourceIds.has(uploadedSourceId)) throw new Error('UPLOAD_SOURCE_ID_REUSED: receipt withheld');
          existingSourceIds.add(uploadedSourceId);
          report.uploadedSourceIds.push(uploadedSourceId);
          if (!findActiveUploadedSource(listSources(runner), uploadedSourceId)) {
            throw new Error('SOURCE_VERIFICATION_FAILED: uploaded source is not ACTIVE; receipt withheld');
          }

          saveReceipt(receiptsData, receiptKey, {
            fileName,
            hash,
            sizeBytes: stats.size,
            sourceId: uploadedSourceId
          });

          report.ingested++;
          console.error(`    [✓] Ingested successfully: ${fileName} (ID: ${uploadedSourceId})`);

        } catch (itemErr) {
          console.error(`    [-] Ingest failed for ${fileName}: ${itemErr.message}`);
          report.failed.push({
            fileName,
            error: itemErr.message
          });
          quarantineFile(filePath, itemErr.message);
        }
      }
    }

    // 8. Verification & Completion
    if (report.failed.length > 0) {
      report.ok = false;
      report.error = `PARTIAL_INGESTION_FAILURES: ${report.failed.length} item(s) failed and quarantined.`;
    }

    console.log(JSON.stringify(report, null, 2));
    return report.ok ? 0 : 1;

  } finally {
    if (fs.existsSync(lockPath)) {
      try {
        const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        if (lock.pid === process.pid) fs.unlinkSync(lockPath);
      } catch {}
    }
  }
}

try {
  process.exitCode = main();
} catch (fatalErr) {
  console.error(JSON.stringify({
    ok: false,
    error: `FATAL_UNHANDLED: ${fatalErr.message}`,
    staged: 0,
    failed: []
  }, null, 2));
  process.exit(1);
}
