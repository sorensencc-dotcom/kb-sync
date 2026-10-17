#!/usr/bin/env node
/**
 * scripts/pipeline/cluster-sync-runner.mjs
 *
 * Partitioned Knowledge Plane Sync Orchestrator.
 * Decouples monolithic sweeps into:
 * - Ops Sync (`npm run sync:ops`, 06:45 PM EDT): Clusters C, D, E (15 notebooks)
 * - Research Sync (`npm run sync:research`, 10:45 PM EDT): Clusters A, B (15 notebooks)
 * - Catchup Pass (`npm run sync:catchup`, 06:00 AM EDT): Retries quarantined/dropped notebooks
 *
 * Enforces per-notebook atomic scope, multipart atomicity, idempotent pre-flight,
 * 300s poller headroom, and has_pack: false bypass.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  replacePackFamilyAtomic,
  probeExistingPackSource,
  pollFamilyUntilActive,
  listNotebookSources
} from '../nlm-pack-replace-gate.mjs';
import { consolidatePacks } from '../consolidate-pack.mjs';
import { generateDynamicQuestionBattery } from '../mining/dynamic-question-battery.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

export const MANIFEST_PATHS = [
  path.resolve(REPO_ROOT, 'state/knowledge-plane-notebooks.json'),
  '//wsl$/Ubuntu/home/box/first-mate/state/knowledge-plane-notebooks.json',
  '/home/box/first-mate/state/knowledge-plane-notebooks.json'
];

export const QUARANTINE_FILE = path.resolve(REPO_ROOT, '.nlm-quarantine.json');
export const SYNC_STATUS_FILE = path.resolve(REPO_ROOT, '.sync-status.json');

const COLOR = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', reset: '\x1b[0m' };
const logInfo = (msg) => console.log(`${COLOR.green}[CLUSTER-SYNC] [INFO]${COLOR.reset} ${msg}`);
const logWarn = (msg) => console.log(`${COLOR.yellow}[CLUSTER-SYNC] [WARN]${COLOR.reset} ${msg}`);
const logError = (msg) => console.error(`${COLOR.red}[CLUSTER-SYNC] [ERROR]${COLOR.reset} ${msg}`);
const logStep = (msg) => console.log(`${COLOR.cyan}[CLUSTER-SYNC] [STEP]${COLOR.reset} ${msg}`);

export function loadManifest() {
  let manifest = null;
  let canonicalPath = null;
  let rawContent = null;
  for (const p of MANIFEST_PATHS) {
    if (fs.existsSync(p)) {
      try {
        const text = fs.readFileSync(p, 'utf8');
        manifest = JSON.parse(text);
        canonicalPath = p;
        rawContent = text;
        break;
      } catch (_) {}
    }
  }
  if (!manifest) {
    throw new Error(`Knowledge plane manifest not found in expected paths: ${MANIFEST_PATHS.join(', ')}`);
  }

  // Automatically propagate canonical manifest to alternate registered locations (e.g. First Mate)
  for (const altPath of MANIFEST_PATHS) {
    if (altPath === canonicalPath) continue;
    try {
      const parentDir = path.dirname(altPath);
      if (fs.existsSync(parentDir)) {
        let needsWrite = true;
        if (fs.existsSync(altPath)) {
          const existingText = fs.readFileSync(altPath, 'utf8');
          if (existingText === rawContent) {
            needsWrite = false;
          }
        }
        if (needsWrite) {
          fs.writeFileSync(altPath, rawContent, 'utf8');
        }
      }
    } catch (_) {}
  }

  return manifest;
}

export function loadQuarantine() {
  if (fs.existsSync(QUARANTINE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(QUARANTINE_FILE, 'utf8'));
    } catch {
      return { quarantined: {} };
    }
  }
  return { quarantined: {} };
}

export function recordQuarantine(notebookId, key, error) {
  const data = loadQuarantine();
  data.quarantined[notebookId] = {
    key,
    error,
    quarantinedAt: new Date().toISOString()
  };
  fs.writeFileSync(QUARANTINE_FILE, JSON.stringify(data, null, 2), 'utf8');
  logWarn(`[QUARANTINE-LOGGED] Notebook ${notebookId} (${key}) quarantined: ${error}`);
}

export function clearQuarantine(notebookId) {
  const data = loadQuarantine();
  if (data.quarantined[notebookId]) {
    delete data.quarantined[notebookId];
    fs.writeFileSync(QUARANTINE_FILE, JSON.stringify(data, null, 2), 'utf8');
    logInfo(`[QUARANTINE-CLEARED] Notebook ${notebookId} cleared from quarantine.`);
  }
}

export function getClusterNotebooks(manifest, mode) {
  const clusters = manifest.clusters || {};
  let targetClusters = [];

  if (mode === 'ops') {
    targetClusters = [
      clusters.cluster_c_core_dev_personal_os,
      clusters.cluster_d_canonical_standards,
      clusters.cluster_e_automation_ecosystem,
    ];
  } else if (mode === 'research') {
    targetClusters = [
      clusters.cluster_a_historical_core,
      clusters.cluster_b_historical_archival_media,
    ];
  } else if (mode === 'catchup') {
    const qData = loadQuarantine();
    const qIds = new Set(Object.keys(qData.quarantined || {}));
    const all = [];
    for (const cl of Object.values(clusters)) {
      if (cl && Array.isArray(cl.notebooks)) {
        all.push(...cl.notebooks);
      }
    }
    return all.filter(nb => qIds.has(nb.uuid));
  } else {
    throw new Error(`Unknown cluster execution mode: "${mode}". Valid: ops, research, catchup`);
  }

  const notebooks = [];
  for (const cl of targetClusters) {
    if (cl && Array.isArray(cl.notebooks)) {
      notebooks.push(...cl.notebooks);
    }
  }
  return notebooks;
}

export const PACK_FAMILY_ALIASES = {
  pack_agent_harness: ['repo_knowledge_pack'],
};

export const DEFAULT_PACK_CANDIDATE_DIRS = [
  path.resolve(REPO_ROOT, '../.nlm_pack'),
  path.resolve(REPO_ROOT, '.nlm_pack'),
];

export function findStagedPackFiles(notebook, candidateDirs = DEFAULT_PACK_CANDIDATE_DIRS) {
  const family = notebook.pack_family;
  if (!family) return [];

  const aliases = PACK_FAMILY_ALIASES[family] || [];
  const prefixes = [family, ...aliases].map(p => p.toLowerCase());

  for (const packDir of candidateDirs) {
    if (!fs.existsSync(packDir)) continue;
    const files = fs.readdirSync(packDir);
    const matched = files.filter(f => {
      const lower = f.toLowerCase();
      if (lower.endsWith('.bak.txt')) return false;
      for (const prefix of prefixes) {
        if (lower === `${prefix}.txt`) return true;
        if (lower.startsWith(`${prefix}_part_`) && lower.endsWith('.txt')) return true;
        if (lower.startsWith(`${prefix}.`) && lower.endsWith('.txt')) return true;
      }
      return false;
    }).sort().map(f => path.join(packDir, f));

    if (matched.length > 0) return matched;
  }

  return [];
}

export async function runNotebookSweep(notebook, options = {}) {
  const { isDryRun = false, mode = 'ops', timeoutMs = 300000, candidateDirs = DEFAULT_PACK_CANDIDATE_DIRS } = options;
  logStep(`=== Running sync for [${notebook.key}] (${notebook.uuid}) ===`);

  const summary = {
    key: notebook.key,
    uuid: notebook.uuid,
    packDispatched: false,
    questionsMined: 0,
    status: 'SUCCESS',
    error: null,
  };

  try {
    // 1. Pack Dispatcher (with has_pack: false bypass)
    if (notebook.has_pack === false) {
      logInfo(`[BYPASS] Notebook ${notebook.key} has_pack: false; bypassing pack upload gate.`);
    } else {
      summary.packDispatched = true;
      let packFiles = findStagedPackFiles(notebook, candidateDirs);
      if (packFiles.length === 0) {
        logWarn(`WARN: No staged pack files found for pack family "${notebook.pack_family}" in directories searched: ${candidateDirs.join(', ')}; skipping upload.`);
      } else if (!isDryRun) {
        await replacePackFamilyAtomic({
          cli: 'nlm',
          notebookId: notebook.uuid,
          packFiles,
          expectedPartCount: notebook.multipart ? packFiles.length : (notebook.expected_parts || 1),
          hasPack: true,
          timeoutMs,
          quarantineHandler: (id, err) => recordQuarantine(id, notebook.key, err),
          logInfo,
          logWarn,
        });
      }
    }

    // 2. Chat Injection & Dynamic Gap Mining
    logInfo(`Mining dynamic questions for ${notebook.key}...`);
    const battery = generateDynamicQuestionBattery(notebook.key);
    summary.questionsMined = battery.questions ? battery.questions.length : 0;
    summary.batteryEntropy = battery.entropy;
    logInfo(`Mined ${summary.questionsMined} question(s) with entropy ${battery.entropy} (source: ${battery.source})`);

    // Clear quarantine if previous run had quarantined this notebook
    clearQuarantine(notebook.uuid);
    return summary;
  } catch (err) {
    summary.status = 'FAILED';
    summary.error = err.message;
    recordQuarantine(notebook.uuid, notebook.key, err.message);
    logError(`Sync failed for ${notebook.key}: ${err.message}`);
    return summary;
  }
}

export async function executeClusterSync(options = {}) {
  const mode = options.mode || 'ops';
  const isDryRun = Boolean(options.dryRun);
  const targetNotebook = options.notebook || null;

  logInfo(`================================================================================`);
  logInfo(`Starting Cluster Sync Orchestrator (Mode: ${mode.toUpperCase()}, DryRun: ${isDryRun})`);
  logInfo(`================================================================================`);

  const manifest = loadManifest();
  let notebooks = getClusterNotebooks(manifest, mode);

  if (targetNotebook) {
    notebooks = notebooks.filter(nb => nb.key === targetNotebook || nb.uuid === targetNotebook);
    if (notebooks.length === 0) {
      throw new Error(`Target notebook "${targetNotebook}" not found in ${mode} cluster.`);
    }
  }

  logInfo(`Cluster targets: ${notebooks.length} notebook(s).`);

  if (mode === 'catchup' && notebooks.length === 0) {
    logInfo(`[CATCHUP-NOMINAL] 0 quarantined or dropped notebooks found. Clean state verified.`);
    return { mode, targetCount: 0, succeeded: 0, failed: 0, results: [] };
  }

  const results = [];
  let succeeded = 0;
  let failed = 0;

  for (const nb of notebooks) {
    const res = await runNotebookSweep(nb, { isDryRun, mode });
    results.push(res);
    if (res.status === 'SUCCESS') succeeded++;
    else failed++;
  }

  logInfo(`================================================================================`);
  logInfo(`Cluster Sync Complete: ${succeeded}/${notebooks.length} succeeded, ${failed} failed.`);
  logInfo(`================================================================================`);

  // Persist telemetry to .sync-status.json
  const statusPayload = {
    target: `cluster_sync_${mode}`,
    timestamp: new Date().toISOString(),
    mode,
    total: notebooks.length,
    succeeded,
    failed,
    results,
  };

  try {
    fs.writeFileSync(SYNC_STATUS_FILE, JSON.stringify(statusPayload, null, 2), 'utf8');
  } catch (_) {}

  return { mode, targetCount: notebooks.length, succeeded, failed, results };
}

// CLI invocation
const mainFile = process.argv[1] ? fs.realpathSync(process.argv[1]) : '';
const thisFile = fs.realpathSync(__filename);
if (mainFile === thisFile) {
  const args = process.argv.slice(2);
  let mode = 'ops';
  let dryRun = false;
  let notebook = null;

  for (const a of args) {
    if (a.startsWith('--mode=')) mode = a.split('=')[1];
    else if (a === '--dry-run') dryRun = true;
    else if (a.startsWith('--notebook=')) notebook = a.split('=')[1];
    else if (!a.startsWith('--')) mode = a;
  }

  executeClusterSync({ mode, dryRun, notebook })
    .then((out) => {
      if (out.failed > 0 && out.succeeded === 0) process.exit(1);
      process.exit(0);
    })
    .catch((err) => {
      logError(`FATAL: ${err.message}`);
      process.exit(1);
    });
}
