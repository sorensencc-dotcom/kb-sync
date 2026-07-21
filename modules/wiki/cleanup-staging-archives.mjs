#!/usr/bin/env node

import { promises as fs, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CONFIG = {
  retention_days: 7,
  keep_min_snapshots: 5,
};

function getStagingRoot() {
  let vaultRoot = process.env.OBSIDIAN_VAULT_ROOT || 'C:\\dev';
  let stagingDir = '_kb-sync-staging';
  try {
    const yamlPath = join(process.cwd(), 'configs', 'obsidian.yaml');
    if (existsSync(yamlPath)) {
      const content = readFileSync(yamlPath, 'utf8');
      const rootMatch = content.match(/^\s*vault_root\s*[:=]\s*(.*)$/m);
      if (rootMatch && rootMatch[1]) {
        const val = rootMatch[1].replace(/#.*$/, '').trim().replace(/^['"]|['"]$/g, '');
        if (val) vaultRoot = process.env.OBSIDIAN_VAULT_ROOT || val;
      }
      const dirMatch = content.match(/^\s*staging_dir\s*[:=]\s*(.*)$/m);
      if (dirMatch && dirMatch[1]) {
        const val = dirMatch[1].replace(/#.*$/, '').trim().replace(/^['"]|['"]$/g, '');
        if (val) stagingDir = val;
      }
    }
  } catch {}

  if (process.platform !== 'win32') {
    const m = vaultRoot.match(/^([A-Za-z]):[/\\]?(.*)/);
    if (m) {
      const drive = m[1].toLowerCase();
      const rest = m[2].replace(/\\/g, '/');
      vaultRoot = `/mnt/${drive}${rest ? '/' + rest : ''}`;
    }
  }

  const full = join(vaultRoot, stagingDir, 'kb-sync');
  if (existsSync(full)) return full;
  return join(process.cwd(), 'obsidian', 'vault', '_kb-sync-staging', 'kb-sync');
}

async function getSnapshotDirs(stagingRoot) {
  try {
    const entries = await fs.readdir(stagingRoot, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory())
      .map(e => ({
        name: e.name,
        path: join(stagingRoot, e.name),
        timestamp: parseTimestamp(e.name)
      }))
      .filter(e => e.timestamp !== null)
      .sort((a, b) => b.timestamp - a.timestamp);
  } catch (err) {
    console.error(`[CLEANUP] Error reading staging root: ${err.message}`);
    return [];
  }
}

function parseTimestamp(dirname) {
  const match = dirname.match(/^(\d{8})-(\d{6})$/);
  if (!match) return null;
  const [, date, time] = match;
  try {
    return new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}Z`).getTime();
  } catch {
    return null;
  }
}

function formatDate(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

function getAgeInDays(ms) {
  return Math.floor((Date.now() - ms) / (24 * 60 * 60 * 1000));
}

async function deleteDir(path) {
  try {
    await fs.rm(path, { recursive: true, force: true });
    return true;
  } catch (err) {
    console.error(`[CLEANUP] Failed to delete ${path}: ${err.message}`);
    return false;
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const verbose = process.argv.includes('--verbose');
  const quiet = process.argv.includes('--quiet');

  const stagingRoot = process.env.STAGING_ROOT || getStagingRoot();

  if (!quiet) {
    console.log(`[CLEANUP] Archive cleanup starting`);
    console.log(`[CLEANUP] Retention: ${CONFIG.retention_days} days, keep min ${CONFIG.keep_min_snapshots} snapshots`);
    console.log(`[CLEANUP] Staging root: ${stagingRoot}`);
    if (dryRun) console.log(`[CLEANUP] Mode: DRY RUN (no deletions)`);
  }

  const snapshots = await getSnapshotDirs(stagingRoot);

  if (snapshots.length === 0) {
    if (!quiet) console.log(`[CLEANUP] No snapshots found.`);
    process.exit(0);
  }

  if (verbose) {
    console.log(`[CLEANUP] Found ${snapshots.length} snapshot(s):`);
    snapshots.forEach((s, i) => {
      const age = getAgeInDays(s.timestamp);
      console.log(`  ${i + 1}. ${s.name} (${age}d old) — ${formatDate(s.timestamp)}`);
    });
  }

  const now = Date.now();
  const cutoff = now - (CONFIG.retention_days * 24 * 60 * 60 * 1000);

  const toDelete = snapshots.filter((s, idx) => {
    const age = getAgeInDays(s.timestamp);
    const exceedsAge = s.timestamp < cutoff;
    const exceedsKeep = idx >= CONFIG.keep_min_snapshots;
    return exceedsAge && exceedsKeep;
  });

  if (toDelete.length === 0) {
    if (!quiet) console.log(`[CLEANUP] No snapshots to delete (all within retention policy).`);
    process.exit(0);
  }

  if (!quiet) {
    console.log(`\n[CLEANUP] Candidates for deletion: ${toDelete.length}`);
    toDelete.forEach(s => {
      const age = getAgeInDays(s.timestamp);
      console.log(`  — ${s.name} (${age}d old)`);
    });
  }

  if (dryRun) {
    if (!quiet) console.log(`\n[CLEANUP] DRY RUN: Would delete ${toDelete.length} snapshot(s).`);
    process.exit(0);
  }

  if (!quiet) console.log(`\n[CLEANUP] Deleting ${toDelete.length} snapshot(s)...`);

  let deleted = 0;
  for (const snapshot of toDelete) {
    const success = await deleteDir(snapshot.path);
    if (success) {
      deleted++;
      if (!quiet) console.log(`  ✓ Deleted: ${snapshot.name}`);
    } else if (!quiet) {
      console.log(`  ✗ Failed: ${snapshot.name}`);
    }
  }

  if (!quiet) {
    console.log(`\n[CLEANUP] Complete. Deleted ${deleted}/${toDelete.length} snapshot(s).`);
    console.log(`[CLEANUP] Remaining: ${snapshots.length - deleted} snapshot(s).`);
  }

  process.exit(deleted === toDelete.length ? 0 : 1);
}

main().catch(err => {
  console.error(`[CLEANUP] Fatal error: ${err.message}`);
  process.exit(1);
});
