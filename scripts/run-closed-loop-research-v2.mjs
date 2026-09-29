import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteJson, createTransaction } from '../modules/trm/storage/transaction-manager.mjs';
import { dispatchEvaluator } from '../modules/trm/evaluators/index.mjs';
import { canonicalizeSpanText, computeSpanHash, normalizeGapText, formatLineageHeader } from '../modules/trm/gap-normalizer.mjs';
import { evaluateClaim } from '../modules/trm/gap-triage-engine.mjs';

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
  const paragraphHashesPath = path.join(baseDir, 'mined_paragraph_hashes.json');

  let fingerprints = {};
  try { fingerprints = JSON.parse(fs.readFileSync(fingerprintsPath, 'utf8')); } catch {}
  let cadenceState = {};
  try { cadenceState = JSON.parse(fs.readFileSync(cadencePath, 'utf8')); } catch {}
  let settledFacts = {};
  try { settledFacts = JSON.parse(fs.readFileSync(settledFactsPath, 'utf8')); } catch {}
  let paragraphHashes = {};
  try { paragraphHashes = JSON.parse(fs.readFileSync(paragraphHashesPath, 'utf8')); } catch {}

  const notebooks = targetNotebook ? [targetNotebook] : Object.keys(fingerprints).length ? Object.keys(fingerprints) : ['willow-run'];
  const results = [];

  for (const nbId of notebooks) {
    const nbFingerprint = fingerprints[nbId] || { source_ids: [], generation: 1, inventory_hash: '' };
    const lastDeltaUtc = cadenceState[nbId]?.last_source_delta_utc || new Date().toISOString();
    const hoursIdle = (Date.now() - new Date(lastDeltaUtc).getTime()) / (1000 * 3600);

    // Cadence check: Active mode demotes > 72h idle to weekly delta mode
    if (mode === 'active' && hoursIdle > 72 && !targetNotebook) {
      cadenceState[nbId] = {
        last_source_delta_utc: lastDeltaUtc,
        cadence: 'PASSIVE_WEEKLY',
        consecutive_idle_days: Math.floor(hoursIdle / 24)
      };
      if (!dryRun) atomicWriteJson(cadencePath, cadenceState);
      results.push({ notebookId: nbId, status: 'DEMOTED_TO_WEEKLY', mode: 'active', hoursIdle });
      continue;
    }

    // Cadence check: Weekly mode skips active notebooks (<= 72h idle) unless targeted
    if (mode === 'weekly' && hoursIdle <= 72 && !targetNotebook) {
      results.push({ notebookId: nbId, status: 'SKIPPED_ACTIVE_MODE', mode: 'weekly', hoursIdle });
      continue;
    }

    // Stage 1: Deterministic Source Inventory Fingerprint Gate
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

    // Stage 2: Two-Tier Query Engine Execution (Governed Evaluator)
    const runId = `run_${Date.now()}_${nbId}`;
    const evalPayload = {
      targetGap: options.targetGap || `GAP-${nbId.slice(0, 4).toUpperCase()}`,
      sourceTitle: currentSources[0]?.id || 'unknown_source'
    };
    const nbConfig = options.notebookConfig || { notebook_id: nbId, remote_evaluator_allowed: false };
    const evalResult = await dispatchEvaluator(evalPayload, nbConfig, {
      ollamaUrl: options.ollamaUrl || 'http://127.0.0.1:99999',
      budgetPath: path.join(baseDir, 'cloud_evaluator_budget.json')
    });

    // Stage 3: Attribution Extraction & Canonical Span Normalization
    const rawExcerpt = options.mockExcerpt || `Findings for ${nbId}: production volume confirmed in ${currentSources[0]?.id}.`;
    const canonicalExcerpt = canonicalizeSpanText(rawExcerpt);
    const spanHash = computeSpanHash(currentSources[0]?.id || 'src', canonicalExcerpt);

    // Stage 4: Typed Fact Settlement & Contradiction Evaluation (Pre-Dedupe)
    const claim = options.mockClaim || {
      notebook_id: nbId,
      entity: nbId,
      attribute: 'general_spec',
      raw_value: canonicalExcerpt
    };
    const triageResult = evaluateClaim(claim, settledFacts);

    // Stage 5: Context-Aware Paragraph Deduplication
    const normalizedPara = normalizeGapText(rawExcerpt);
    const paraHash = crypto.createHash('sha256').update(`${nbId}::${normalizedPara}`).digest('hex');
    const isDuplicate = paragraphHashes[nbId]?.hashes?.[paraHash] && triageResult.action !== 'CONTRADICTION_DETECTED';

    // Stage 6: Promotion & WAL Transactional Commit
    const tx = createTransaction(runId, nbId, nbFingerprint.generation || 1, { baseDir });
    if (!isDuplicate) {
      tx.stageMutation('promoted_spans', {
        id: spanHash,
        source_id: currentSources[0]?.id,
        promoted_at: new Date().toISOString(),
        triage_action: triageResult.action
      });
      tx.stageMutation('mined_paragraph_hashes', {
        id: paraHash,
        span_hash: spanHash,
        first_seen_utc: new Date().toISOString()
      });
    }

    if (!dryRun) {
      tx.commitTransaction(nbFingerprint.generation || 1);

      // Refresh fingerprint & elevate cadence back to Active Daily
      nbFingerprint.inventory_hash = currentHash;
      nbFingerprint.source_ids = currentSources.map(s => s.id);
      fingerprints[nbId] = nbFingerprint;
      cadenceState[nbId] = {
        last_source_delta_utc: new Date().toISOString(),
        cadence: 'ACTIVE_DAILY',
        consecutive_idle_days: 0
      };

      atomicWriteJson(fingerprintsPath, fingerprints);
      atomicWriteJson(cadencePath, cadenceState);
    }

    results.push({
      notebookId: nbId,
      status: 'MINED_DELTA',
      mode,
      runId,
      evaluator: evalResult.evaluator_used,
      triageAction: triageResult.action,
      isDuplicate,
      manifestHash: currentHash
    });
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

