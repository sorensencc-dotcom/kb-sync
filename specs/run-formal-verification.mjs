#!/usr/bin/env node
/**
 * Master Formal Verification Suite for kb-sync.
 * Runs TLA+ model checking across:
 *   1. PackReplaceGate (NotebookLM pack replacement cutover & delete-before-poll race)
 *   2. WikiLog (Obsidian live Log.md append-only preservation & proposal overwrite replay)
 *   3. TrmIngestDrive (10-state TRM Ingest Drive normalization, lock lease & quarantine guards)
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const suites = [
  { name: 'PackReplaceGate (Pack replacement cutover & race replay)', script: path.join(here, 'pack-replace-gate', 'run-tlc.mjs') },
  { name: 'WikiLog (Log.md append-only preservation & overwrite replay)', script: path.join(here, 'wiki-log', 'run-tlc.mjs') },
  { name: 'TrmIngestDrive (10-state normalization, lease & quarantine model)', script: path.join(here, 'trm-ingest-drive', 'run-tlc.mjs') },
];

console.log('=== KB-SYNC FORMAL VERIFICATION SUITE ===');
let allPassed = true;

for (const suite of suites) {
  console.log(`\n--- Running ${suite.name} ---`);
  const result = spawnSync(process.execPath, [suite.script], {
    cwd: here,
    encoding: 'utf8',
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    console.error(`FAILED: ${suite.name} exited with status ${result.status}`);
    allPassed = false;
  }
}

if (!allPassed) {
  console.error('\nFAIL: One or more formal verification models failed.');
  process.exit(1);
}

console.log('\nPASS: All formal models verified and past bug replays caught successfully.');
process.exit(0);
