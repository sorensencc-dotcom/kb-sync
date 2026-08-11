import fs from 'node:fs';
import path from 'node:path';
import { loadActiveOverrides, saveOverrides } from './overrides-manager.mjs';
import { normalizeRepoPath } from './path-utils.mjs';

export async function runCompactCli(args, repoRoot) {
  const command = args[0];

  switch (command) {
    case 'inspect': {
      const statusFile = path.join(repoRoot, '.sync-status.json');
      if (!fs.existsSync(statusFile)) {
        console.log('No sync status available. Run kb-sync first.');
        return;
      }
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
      console.log('=== COMPACTED CONTEXT ENGINE STATUS ===');
      console.dir(status.compaction_stats || {}, { depth: null });
      break;
    }

    case 'restore': {
      const targetPath = args[1];
      if (!targetPath) {
        console.error('Error: Missing target path. Usage: npm run kb:compact -- restore <path>');
        process.exit(1);
      }

      const overridesResult = loadActiveOverrides(repoRoot);
      if (overridesResult.error) {
        console.error(`Error: Refusing to update overrides due to schema error: ${overridesResult.error}`);
        process.exit(1);
      }

      const normPath = normalizeRepoPath(targetPath, repoRoot);
      const expireAt = new Date(Date.now() + 3 * 86400 * 1000).toISOString();

      overridesResult.map.set(normPath, {
        path: normPath,
        created_at: new Date().toISOString(),
        expire_at: expireAt,
        reason: 'Manual restore via CLI subcommand'
      });

      saveOverrides(repoRoot, overridesResult.map);
      console.log(`[COMPACTOR] Successfully restored "${normPath}" to FULL context (Active until ${expireAt}).`);
      break;
    }

    case 'dump': {
      const targetPath = args[1];
      if (!targetPath) {
        console.error('Error: Missing target path. Usage: npm run kb:compact -- dump <path>');
        process.exit(1);
      }
      const normPath = normalizeRepoPath(targetPath, repoRoot);
      const fullPath = path.join(repoRoot, normPath);
      if (!fs.existsSync(fullPath)) {
        console.error(`Error: File not found: ${normPath}`);
        process.exit(1);
      }
      process.stdout.write(fs.readFileSync(fullPath, 'utf8'));
      break;
    }

    case 'prune-overrides': {
      const overridesResult = loadActiveOverrides(repoRoot);
      if (overridesResult.error) {
        console.error(`Error: Cannot prune overrides: ${overridesResult.error}`);
        process.exit(1);
      }
      // loadActiveOverrides already drops expired entries from the map;
      // saveOverrides re-filters defensively, so this writes only the live set.
      saveOverrides(repoRoot, overridesResult.map);
      console.log('[COMPACTOR] Expired overrides pruned successfully.');
      break;
    }

    default:
      console.log('Usage: npm run kb:compact -- <inspect | restore <path> | dump <path> | prune-overrides>');
  }
}
