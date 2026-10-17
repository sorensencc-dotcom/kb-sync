import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPosixPath } from '../../core/path-normalizer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const KB_SYNC_ROOT = path.resolve(__dirname, '..', '..');

export const DEFAULT_LOCK_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Checks whether a process ID is currently running.
 * @param {number|string} pid 
 * @returns {boolean}
 */
export function isPidAlive(pid) {
  if (!pid) return false;
  const numPid = Number(pid);
  if (isNaN(numPid) || numPid <= 0) return false;
  try {
    process.kill(numPid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes Windows drive letters and paths to standard forward slashes for cross-platform and bash execution.
 * @param {string} inputPath 
 * @returns {string}
 */
export function normalizeWindowsPath(inputPath) {
  if (!inputPath) return '';
  return toPosixPath(path.resolve(inputPath));
}

/**
 * Reaps an individual lockfile if it is stale (> maxAgeMs or dead PID).
 * @param {string} lockPath 
 * @param {number} maxAgeMs 
 * @returns {{ reaped: boolean, reason?: string, ageMs?: number, pidAlive?: boolean, error?: string }}
 */
export function reapStaleLock(lockPath, maxAgeMs = DEFAULT_LOCK_MAX_AGE_MS) {
  if (!lockPath || !fs.existsSync(lockPath)) {
    return { reaped: false, reason: 'NOT_FOUND' };
  }

  try {
    const stats = fs.statSync(lockPath);
    const ageMs = Date.now() - stats.mtimeMs;
    let pid = null;

    try {
      const raw = fs.readFileSync(lockPath, 'utf8');
      const parsed = JSON.parse(raw);
      pid = parsed.pid;
    } catch {}

    const pidAlive = isPidAlive(pid);

    if (!pidAlive || ageMs > maxAgeMs) {
      console.warn(`[WARN] Reaping orphaned lockfile: ${lockPath} (age: ${Math.round(ageMs / 1000)}s, pid: ${pid || 'N/A'}, pidAlive: ${pidAlive})`);
      fs.unlinkSync(lockPath);
      return { reaped: true, lockPath, ageMs, pidAlive };
    }

    return { reaped: false, reason: 'ACTIVE_LOCK', pid };
  } catch (err) {
    console.error(`[ERROR] Failed to check/reap lockfile ${lockPath}:`, err.message);
    return { reaped: false, error: err.message };
  }
}

/**
 * Proactively sweeps known lock locations across kb-sync workspace.
 * @param {Object} options
 * @param {string[]} [options.searchDirs]
 * @param {number} [options.maxAgeMs]
 * @returns {Array<{ lockPath: string, reaped: boolean, reason?: string }>}
 */
export function sweepStaleLocks(options = {}) {
  const root = options.rootDir || KB_SYNC_ROOT;
  const maxAgeMs = options.maxAgeMs || DEFAULT_LOCK_MAX_AGE_MS;
  const candidateDirs = options.searchDirs || [
    path.join(root, '_cache'),
    path.join(root, '_kb-sync-staging'),
    path.join(root, '.cache')
  ];

  const results = [];
  const knownDirectFiles = [
    path.join(root, '_cache', 'nlm_ingest.lock'),
    path.join(root, '.nlm-sync.lock')
  ];

  for (const fp of knownDirectFiles) {
    if (fs.existsSync(fp)) {
      results.push(reapStaleLock(fp, maxAgeMs));
    }
  }

  for (const dir of candidateDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.lock')) {
          const fullPath = path.join(dir, entry.name);
          if (!knownDirectFiles.includes(fullPath)) {
            results.push(reapStaleLock(fullPath, maxAgeMs));
          }
        } else if (entry.isDirectory()) {
          // Check child directory (e.g. _kb-sync-staging/<notebookUuid>/.nlm-sync.lock)
          const subDir = path.join(dir, entry.name);
          try {
            const subEntries = fs.readdirSync(subDir);
            for (const sub of subEntries) {
              if (sub.endsWith('.lock')) {
                results.push(reapStaleLock(path.join(subDir, sub), maxAgeMs));
              }
            }
          } catch {}
        }
      }
    } catch {}
  }

  return results;
}

export default {
  isPidAlive,
  normalizeWindowsPath,
  reapStaleLock,
  sweepStaleLocks
};
