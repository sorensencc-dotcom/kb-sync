import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteJson } from '../modules/trm/storage/transaction-manager.mjs';

export function computeManifestHash(sources = []) {
  const canonical = [...sources]
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((source) => ({
      id: source.id,
      modified_at: source.modified_at || '',
      size_bytes: source.size_bytes || 0,
      etag: source.etag || '',
    }));
  return crypto.createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

export function evaluateSourceDelta(cachedManifest = {}, currentSources = []) {
  const cachedIds = new Set(cachedManifest.source_ids || []);
  const currentIds = new Set(currentSources.map((source) => source.id));
  const removedSourceIds = [...cachedIds].filter((id) => !currentIds.has(id));
  const added = [...currentIds].filter((id) => !cachedIds.has(id));

  if (removedSourceIds.length > 0 && added.length === 0) {
    return { deltaType: 'SOURCE_DELETED', removedSourceIds };
  }
  if (removedSourceIds.length > 0 || added.length > 0) {
    return { deltaType: 'DELTA_DETECTED', removedSourceIds };
  }
  return { deltaType: 'NO_DELTA', removedSourceIds: [] };
}

export function cascadeSourceDeletion(removedSourceIds, settledFactsPath) {
  if (!fs.existsSync(settledFactsPath)) return;
  const removed = new Set(removedSourceIds);
  let facts;
  try {
    facts = JSON.parse(fs.readFileSync(settledFactsPath, 'utf8'));
  } catch {
    return;
  }

  let changed = false;
  for (const fact of Object.values(facts)) {
    if (fact.source_ids?.some((sourceId) => removed.has(sourceId))) {
      fact.status = 'EVIDENCE_REMOVED';
      changed = true;
    }
  }
  if (changed) atomicWriteJson(settledFactsPath, facts);
}

export async function runClosedLoopResearch(options = {}) {
  const mode = options.mode || 'active';
  const dryRun = Boolean(options.dryRun);
  const targetNotebook = options.notebook;
  const baseDir = options.baseDir || path.join(process.cwd(), '_kb-sync-staging', 'trm');
  const logFile = path.join(process.cwd(), 'wiki', 'Log.md');
  const fingerprintsPath = path.join(baseDir, 'notebook_fingerprints.json');
  const cadencePath = path.join(baseDir, 'cadence_state.json');
  const settledFactsPath = path.join(baseDir, 'settled_facts.json');

  let fingerprints = {};
  try { fingerprints = JSON.parse(fs.readFileSync(fingerprintsPath, 'utf8')); } catch {}
  let cadenceState = {};
  try { cadenceState = JSON.parse(fs.readFileSync(cadencePath, 'utf8')); } catch {}

  const notebooks = targetNotebook ? [targetNotebook] : Object.keys(fingerprints).length ? Object.keys(fingerprints) : ['willow-run'];
  const results = [];

  for (const nbId of notebooks) {
    const nbFingerprint = fingerprints[nbId] || { source_ids: [], generation: 1, inventory_hash: '' };
    const lastDeltaUtc = cadenceState[nbId]?.last_source_delta_utc || new Date(0).toISOString();
    const hoursIdle = (Date.now() - new Date(lastDeltaUtc).getTime()) / (1000 * 3600);

    if (mode === 'weekly' && hoursIdle <= 72 && !targetNotebook) {
      // In weekly mode, skip active notebooks unless specifically targeted
      continue;
    }
    if (mode === 'active' && hoursIdle > 72 && !targetNotebook) {
      // In active mode, demote notebooks idle > 72h to weekly delta queue
      continue;
    }

    const currentSources = options.mockSources || [
      { id: `${nbId}_spec.pdf`, modified_at: new Date().toISOString(), size_bytes: 1024 }
    ];
    const currentHash = computeManifestHash(currentSources);
    const delta = evaluateSourceDelta(nbFingerprint, currentSources);

    if (delta.deltaType === 'NO_DELTA') {
      const logLine = `[${new Date().toISOString()}] TRM-DIFF-GATE: Notebook ${nbId} unchanged; skipping mining pass (mode: ${mode})\n`;
      try { fs.appendFileSync(logFile, logLine); } catch {}
      results.push({ notebookId: nbId, status: 'SKIPPED_NO_DELTA', mode });
      continue;
    }

    if (delta.deltaType === 'SOURCE_DELETED') {
      cascadeSourceDeletion(delta.removedSourceIds, settledFactsPath);
      nbFingerprint.generation = (nbFingerprint.generation || 1) + 1;
      nbFingerprint.source_ids = currentSources.map(s => s.id);
      nbFingerprint.inventory_hash = currentHash;
      fingerprints[nbId] = nbFingerprint;
      if (!dryRun) atomicWriteJson(fingerprintsPath, fingerprints);
      results.push({ notebookId: nbId, status: 'SOURCE_DELETED_CASCADED', mode });
      continue;
    }

    // Delta detected
    nbFingerprint.inventory_hash = currentHash;
    nbFingerprint.source_ids = currentSources.map(s => s.id);
    fingerprints[nbId] = nbFingerprint;
    cadenceState[nbId] = {
      last_source_delta_utc: new Date().toISOString(),
      cadence: mode === 'weekly' ? 'PASSIVE_WEEKLY' : 'ACTIVE_DAILY'
    };

    if (!dryRun) {
      atomicWriteJson(fingerprintsPath, fingerprints);
      atomicWriteJson(cadencePath, cadenceState);
    }
    results.push({ notebookId: nbId, status: 'MINED_DELTA', mode, manifestHash: currentHash });
  }

  return { mode, results, count: results.length };
}

function parseCliArgs() {
  const args = process.argv.slice(2);
  const options = { mode: 'active', dryRun: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode' && args[i + 1]) {
      options.mode = args[++i];
    } else if (args[i].startsWith('--mode=')) {
      options.mode = args[i].split('=')[1];
    } else if (args[i] === '--notebook' && args[i + 1]) {
      options.notebook = args[++i];
    } else if (args[i] === '--dry-run') {
      options.dryRun = true;
    }
  }
  return options;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const options = parseCliArgs();
  runClosedLoopResearch(options).then((res) => {
    console.log(`[TRM-RUNNER] Mode: ${res.mode} | Processed: ${res.count} notebook(s)`);
    res.results.forEach((r) => console.log(` - ${r.notebookId}: ${r.status}`));
  }).catch((err) => {
    console.error(`[TRM-RUNNER] Error: ${err.message}`);
    process.exit(1);
  });
}

