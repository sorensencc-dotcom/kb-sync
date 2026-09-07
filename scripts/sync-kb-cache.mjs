#!/usr/bin/env node
/**
 * Synchronize the knowledge base into the local SQLite cache.
 *
 * Nightly / unattended Apply for process janitor:
 *   --nightly
 *   KB_SYNC_NIGHTLY=1
 *   SYNC_KB_CACHE_NIGHTLY=1
 *
 * On win32, always dry-runs Toolforge node-process-janitor.ps1 before sync
 * (and -Apply when nightly). Path override: TOOLFORGE_JANITOR_PS1 or JANITOR_PS1.
 * Janitor errors warn and continue; non-Windows skips janitor.
 */
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { syncKnowledgeCache } from '../modules/cache/sync-cache.mjs';
import { DEFAULT_DB_PATH } from '../modules/cache/db-schema.mjs';

const DEFAULT_JANITOR_PS1 = 'C:\\dev\\utilities\\node-process-janitor.ps1';

function isNightlyMode() {
  return (
    process.argv.includes('--nightly') ||
    process.env.KB_SYNC_NIGHTLY === '1' ||
    process.env.SYNC_KB_CACHE_NIGHTLY === '1'
  );
}

/**
 * Run Toolforge node-process-janitor.ps1.
 * Always dry-runs (and logs) when apply is requested or not; only passes -Apply when apply=true.
 * Fail-soft: missing script / spawn errors warn and continue.
 */
function runProcessJanitor({ apply = false, scriptPath } = {}) {
  if (process.platform !== 'win32') {
    console.log('[kb-cache] [process-janitor] Skipping (non-Windows).');
    return;
  }

  const resolved =
    scriptPath ||
    process.env.TOOLFORGE_JANITOR_PS1 ||
    process.env.JANITOR_PS1 ||
    DEFAULT_JANITOR_PS1;

  if (!fs.existsSync(resolved)) {
    console.warn(`[kb-cache] [process-janitor] Script not found at ${resolved}; skipping.`);
    return;
  }

  const runOnce = (doApply) => {
    const mode = doApply ? 'APPLY' : 'dry-run';
    console.log(`[kb-cache] [process-janitor] Running (${mode}): ${resolved}`);
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolved];
    if (doApply) args.push('-Apply');

    try {
      const result = spawnSync('powershell.exe', args, {
        encoding: 'utf8',
        windowsHide: true
      });
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      if (result.error) {
        console.warn(
          `[kb-cache] [process-janitor] ${mode} spawn error: ${result.error.message}; continuing.`
        );
        return;
      }
      if (result.status !== 0 && result.status !== null) {
        console.warn(
          `[kb-cache] [process-janitor] exited ${result.status} (${mode}); continuing.`
        );
      } else {
        console.log(`[kb-cache] [process-janitor] ${mode} completed.`);
      }
    } catch (err) {
      console.warn(`[kb-cache] [process-janitor] ${mode} failed: ${err}; continuing.`);
    }
  };

  // Always dry-run and log; Apply only on nightly/unattended path.
  runOnce(false);
  if (apply) runOnce(true);
}

const isVerbose = process.argv.includes('--verbose') || process.argv.includes('-v');
const dbPathArg = process.argv.find((arg) => arg.startsWith('--db='))?.split('=')[1];
const dbPath = dbPathArg ? path.resolve(dbPathArg) : DEFAULT_DB_PATH;
const nightly = isNightlyMode();

runProcessJanitor({ apply: nightly });

console.log(`[kb-cache] Synchronizing knowledge base into SQLite cache at ${dbPath}...`);
if (nightly) {
  console.log('[kb-cache] Nightly mode enabled (--nightly / KB_SYNC_NIGHTLY / SYNC_KB_CACHE_NIGHTLY).');
}
const startTime = Date.now();

try {
  const stats = syncKnowledgeCache({
    dbPath,
    verbose: isVerbose
  });

  const durationMs = Date.now() - startTime;
  console.log(`[kb-cache] Sync completed in ${durationMs}ms:`);
  console.log(`  - Inserted:    ${stats.inserted}`);
  console.log(`  - Updated:     ${stats.updated}`);
  console.log(`  - L0 Injected: ${stats.abstracts_injected ?? 0}`);
  console.log(`  - Skipped:     ${stats.skipped}`);
  console.log(`  - Deleted:     ${stats.deleted}`);
  console.log(`  - Total:       ${stats.total}`);
} catch (err) {
  console.error(`[kb-cache] Sync failed:`, err);
  process.exit(1);
}
