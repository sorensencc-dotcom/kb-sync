#!/usr/bin/env node
// ==============================================================================
// Post-upload grounding gate (RFC-NLM-05 Phase 2).
//
// Asserts, via the CLI's structured citations[] payload (never substring-
// matching free-text prose, which breaks on model phrasing variations), that
// the active notebook is actually grounded against the pack that was just
// uploaded. Runs as Stage 1.5 in scripts/notebooklm/kb-sync-nightly.sh,
// after Stage 1 (ingest-notebooklm.sh) succeeds and before Stage 2 (report
// generation).
//
// Exit 0: grounding verified.
// Exit 2: grounding check failed (empty or misattributed citations).
// Exit 1: usage/environment error (missing NOTEBOOK_ID, CLI bridge failure).
// ==============================================================================
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_SCRIPT = path.resolve(__dirname, 'run-nlm-chat.sh');
const PACK_FILENAME_PREFIX = 'repo_knowledge_pack';
const GROUNDING_PROMPT = 'What is the repo_root configuration in configs/notebooklm.yaml?';

function fail(message, code = 2) {
  console.error(`[GROUNDING-GATE] FAILED: ${message}`);
  process.exit(code);
}

const notebookId = process.argv[2] || process.env.NOTEBOOK_ID;
if (!notebookId) {
  fail('No NOTEBOOK_ID provided (pass as argv[1] or set NOTEBOOK_ID env var).', 1);
}

const result = spawnSync(BRIDGE_SCRIPT, [notebookId, GROUNDING_PROMPT], {
  encoding: 'utf8',
  timeout: Number(process.env.TIMEOUT_MS) || 90000,
});

if (result.error) {
  fail(`Could not invoke CLI bridge (${BRIDGE_SCRIPT}): ${result.error.message}`, 1);
}
if (result.status !== 0) {
  fail(`CLI bridge exited ${result.status}. stderr: ${(result.stderr || '').trim()}`, 1);
}

let data;
try {
  data = JSON.parse(result.stdout);
} catch (err) {
  fail(`CLI response was not valid JSON: ${err.message}`, 1);
}

if (!data.citations || data.citations.length === 0) {
  fail('Zero structured citations returned.');
}

const hasValidAttribution = data.citations.some(
  (c) => c && typeof c.source_name === 'string' && c.source_name.startsWith(PACK_FILENAME_PREFIX)
);

if (!hasValidAttribution) {
  fail('Citations do not reference active pack sources.');
}

console.log('[GROUNDING-GATE] PASSED: Grounding validated against active pack.');
process.exit(0);
