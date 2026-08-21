#!/usr/bin/env node
import path from 'node:path';
import { syncKnowledgeCache } from '../modules/cache/sync-cache.mjs';
import { DEFAULT_DB_PATH } from '../modules/cache/db-schema.mjs';

const isVerbose = process.argv.includes('--verbose') || process.argv.includes('-v');
const dbPathArg = process.argv.find((arg) => arg.startsWith('--db='))?.split('=')[1];
const dbPath = dbPathArg ? path.resolve(dbPathArg) : DEFAULT_DB_PATH;

console.log(`[kb-cache] Synchronizing knowledge base into SQLite cache at ${dbPath}...`);
const startTime = Date.now();

try {
  const stats = syncKnowledgeCache({
    dbPath,
    verbose: isVerbose
  });

  const durationMs = Date.now() - startTime;
  console.log(`[kb-cache] Sync completed in ${durationMs}ms:`);
  console.log(`  - Inserted: ${stats.inserted}`);
  console.log(`  - Updated:  ${stats.updated}`);
  console.log(`  - Skipped:  ${stats.skipped}`);
  console.log(`  - Deleted:  ${stats.deleted}`);
  console.log(`  - Total:    ${stats.total}`);
} catch (err) {
  console.error(`[kb-cache] Sync failed:`, err);
  process.exit(1);
}
