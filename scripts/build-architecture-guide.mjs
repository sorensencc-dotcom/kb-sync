#!/usr/bin/env node
// ==============================================================================
// Architecture Guide Builder — kb-sync Integration Entrypoint
// Compiles the authoritative Ecosystem Architecture Guide with daily hygiene rules,
// run provenance stamp (run_id + drop_time), and fail-loud freshness gate.
//
// Governed by:
//   - Canonical Shared Memory Topology (Dual-Homed Cloud + Local Cache)
//   - Daily Guide Hygiene & Fail-Loud Gate Rules
// ==============================================================================

import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve compiler from root scripts or relative path
let compilerPath = path.resolve(__dirname, '../../scripts/ecosystem-compiler.mjs');
if (!fs.existsSync(compilerPath)) {
  compilerPath = path.resolve(__dirname, '../../../scripts/ecosystem-compiler.mjs');
}
if (!fs.existsSync(compilerPath)) {
  compilerPath = 'C:\\dev\\scripts\\ecosystem-compiler.mjs';
}

const compiler = await import(pathToFileURL(compilerPath).href);

export const {
  DEFAULT_REPO_ROOTS,
  DEFAULT_MCP_DIR,
  DEFAULT_REGISTRY_PATH,
  DEFAULT_GUIDE_OUTPUT_PATH,
  DRIVE_MASTER_URL,
  DEFAULT_DRIVE_MASTER_PATH,
  DEFAULT_LIBRARIAN_ARCHIVE_PATH,
  DEFAULT_KB_SYNC_PATH,
  LIBRARIAN_ARCHIVE_URL,
  formatTimeInZone,
  generateRunId,
  normalizeTimestamp,
  checkSourceFreshness,
  compileEcosystemGuide,
  generateAndWriteGuide,
  generateAndWriteGuideAsync
} = compiler;

export async function buildArchitectureGuide(options = {}) {
  const outputPath = options.outputPath || DEFAULT_GUIDE_OUTPUT_PATH;
  const dropTime = options.dropTime || new Date();
  const runId = options.runId || generateRunId(dropTime);

  console.log('================================================================================');
  console.log('🏛️  CIC Ecosystem Architecture Guide Builder');
  console.log(`   Run ID:    ${runId}`);
  console.log(`   Drop Time: ${formatTimeInZone(dropTime, 'America/New_York')} (${dropTime.toISOString()} UTC)`);
  console.log(`   Output:    ${outputPath}`);
  console.log('================================================================================\n');

  // Enforce pre-flight freshness & parity gate
  const freshnessReport = options.freshnessReport || checkSourceFreshness({
    ...options,
    now: dropTime
  });

  console.log(`[FRESHNESS GATE REPORT]`);
  console.log(`  Parity Status:   ${freshnessReport.parityStatus}`);
  console.log(`  Checked Sources: ${freshnessReport.checkedSources.length}`);
  console.log(`  Stale / Missing: ${freshnessReport.staleSources.length}`);

  if (freshnessReport.staleSources.length > 0) {
    console.warn('\n  ⚠️  FAIL-LOUD WARNING: The following sources failed the freshness threshold:');
    for (const stale of freshnessReport.staleSources) {
      console.warn(`     - [${stale.error || (stale.isStale ? 'STALE' : 'MISSING')}] ${stale.name}`);
      console.warn(`       Path:    ${stale.path}`);
      console.warn(`       Details: ${stale.details}`);
    }
    console.warn('     -> Top-of-document FAIL-LOUD warning banner injected into Guide header.\n');
  } else {
    console.log('  ✓  All authoritative sources verified fresh and synchronized.\n');
  }

  if (options.haltOnStale && freshnessReport.staleSources.length > 0) {
    throw new Error(`Build halted: ${freshnessReport.staleSources.length} sources failed freshness gate.`);
  }

  const result = await generateAndWriteGuideAsync(outputPath, {
    ...options,
    runId,
    dropTime,
    freshnessReport,
    parityStatus: freshnessReport.parityStatus
  });

  console.log('================================================================================');
  console.log(`✅ Guide successfully compiled to: ${result.outputPath}`);
  console.log(`   Bytes written: ${result.bytesWritten}`);
  console.log(`   Repositories:  ${result.repoCount}`);
  console.log(`   MCP Servers:   ${result.mcpCount}`);
  console.log(`   Notebooks:     ${result.notebookCount}`);
  console.log(`   Contract Hubs: ${result.skeletonCount}`);
  console.log(`   Parity Status: ${result.parityStatus}`);
  console.log('================================================================================');

  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const options = {
    withGemini: args.includes('--with-gemini'),
    haltOnStale: args.includes('--halt-on-stale')
  };

  const runIdArg = args.find(a => a.startsWith('--run-id='));
  if (runIdArg) options.runId = runIdArg.split('=')[1];

  const windowArg = args.find(a => a.startsWith('--drop-window-hours='));
  if (windowArg) options.dropWindowHours = parseFloat(windowArg.split('=')[1]);

  const outArg = args.find(a => a.startsWith('--output='));
  if (outArg) options.outputPath = outArg.split('=')[1];

  buildArchitectureGuide(options)
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Build failed:', err.message);
      process.exit(1);
    });
}
