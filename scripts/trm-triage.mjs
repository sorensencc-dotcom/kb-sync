#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { executeGapTriage } from '../modules/trm/gap-triage-engine.mjs';
import { DEFAULT_DB_PATH } from '../modules/cache/db-schema.mjs';

const gapsFilePath = process.argv.find((arg) => arg.startsWith('--gaps='))?.split('=')[1]
  || path.resolve(process.cwd(), 'trm-research-gaps.md');
const outputDir = process.argv.find((arg) => arg.startsWith('--out='))?.split('=')[1]
  || path.resolve(process.cwd(), 'wiki/research');
const dbPath = process.argv.find((arg) => arg.startsWith('--db='))?.split('=')[1]
  || DEFAULT_DB_PATH;
const dryRun = process.argv.includes('--dry-run');

console.log(`[trm-triage] Starting automated gap triage against local SQLite context cache...`);
console.log(`  - Gaps file: ${gapsFilePath}`);
console.log(`  - Output dir: ${outputDir}`);
console.log(`  - DB path:    ${dbPath}`);

if (!fs.existsSync(gapsFilePath)) {
  console.error(`[trm-triage] Error: Target gaps file does not exist: ${gapsFilePath}`);
  process.exit(1);
}

try {
  const result = executeGapTriage({
    gapsFilePath,
    outputDir,
    dbPath,
    dryRun
  });

  console.log(`\n[trm-triage] Triage completed successfully:`);
  console.log(`  - Pending gaps processed: ${result.processed}`);
  console.log(`  - Drafted RFC notes:`);
  for (const file of result.rfcFiles) {
    console.log(`    + ${file}`);
  }
} catch (err) {
  console.error(`[trm-triage] Fatal error during triage:`, err);
  process.exit(1);
}
