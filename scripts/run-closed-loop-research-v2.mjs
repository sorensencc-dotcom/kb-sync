import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteJson, createTransaction } from '../modules/trm/storage/transaction-manager.mjs';
import { dispatchEvaluator } from '../modules/trm/evaluators/index.mjs';
import { canonicalizeSpanText, computeSpanHash, normalizeGapText, formatLineageHeader } from '../modules/trm/gap-normalizer.mjs';
import { evaluateClaim } from '../modules/trm/gap-triage-engine.mjs';
import { NOTEBOOK_TARGETS, resolveNotebookId } from '../core/targets.mjs';
import { loadCategoriesData } from '../core/config.mjs';
import { listNotebookSources } from './nlm-pack-replace-gate.mjs';

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

function collectFilesFromDirs(dirs, maxDepth = 2) {
  const files = [];
  function scan(dir, depth) {
    if (depth > maxDepth || !fs.existsSync(dir)) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
          scan(full, depth + 1);
        } else if (e.isFile()) {
          files.push({ name: e.name, fullPath: full });
        }
      }
    } catch {}
  }
  for (const d of dirs) scan(d, 1);
  return files;
}

export function getRealSourcesForNotebook(nbId, options = {}) {
  if (options.mockSources) {
    return options.mockSources;
  }

  const resolvedUuid = resolveNotebookId(nbId);

  // Fast check if CLI is available without blocking
  if (options.useCli !== false) {
    const cliCandidates = ['notebooklm', 'nlm'];
    for (const cli of cliCandidates) {
      try {
        const listed = listNotebookSources(cli, resolvedUuid);
        if (Array.isArray(listed) && listed.length > 0) {
          return listed.map((s) => ({
            id: String(s.id || s.title || s.name),
            title: s.title || s.name || s.id,
            modified_at: s.updated_at || s.modified_at || s.created_at || new Date().toISOString(),
            size_bytes: s.size_bytes || s.size || 0,
            fullPath: s.fullPath || null,
          }));
        }
      } catch {}
    }
  }

  let aliases = [];
  try {
    const catData = loadCategoriesData();
    if (catData?.categories?.[nbId]?.aliases) {
      aliases = catData.categories[nbId].aliases;
    }
  } catch {}

  const normNb = String(nbId).toLowerCase().replace(/[-_]/g, '');
  const normAliases = aliases.map((a) => a.toLowerCase().replace(/[-_]/g, ''));
  const allKeys = [normNb, ...normAliases].filter((k) => k.length >= 3);

  const searchRoots = [
    path.join(process.cwd(), 'docs'),
    path.join(process.cwd(), 'wiki'),
    path.join(process.cwd(), 'skills'),
    path.join(process.cwd(), 'modules'),
    path.join(process.cwd(), 'core'),
    'C:/Users/soren/trm-vault/trm/research-gaps',
    'C:/Users/soren/trm-vault/intake/notebooklm',
    'C:/dev/IronLedger',
    'C:/dev/sigil-repo',
    'C:/dev/rewrite-docs',
    'C:/dev/rewrite-mcp'
  ];

  const candidateFiles = collectFilesFromDirs(searchRoots, 2);
  const matched = [];
  const seen = new Set();

  for (const item of candidateFiles) {
    const ext = path.extname(item.name).toLowerCase();
    if (!['.md', '.txt', '.json', '.docx', '.ts', '.mjs'].includes(ext)) continue;
    if (seen.has(item.name)) continue;

    const normName = item.name.toLowerCase().replace(/[-_]/g, '');
    const normPath = item.fullPath.toLowerCase().replace(/[-_]/g, '');

    const isMatch = allKeys.some((k) => {
      if (['doc', 'kb', 'ops', 'gov'].includes(k)) {
        return normName.startsWith(k) || normPath.includes('/' + k) || normPath.includes('\\' + k);
      }
      return normName.includes(k) || normPath.includes(k);
    });

    if (isMatch) {
      seen.add(item.name);
      try {
        const st = fs.statSync(item.fullPath);
        matched.push({
          id: item.name,
          title: item.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
          modified_at: st.mtime.toISOString(),
          size_bytes: st.size,
          fullPath: item.fullPath,
        });
      } catch {}
    }
  }

  // Staged packs check: ONLY match specific pack prefix/stem
  const nlmDirs = [path.join(process.cwd(), '.nlm_pack'), 'C:/dev/.nlm_pack'];
  for (const dir of nlmDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir).filter((f) => f.startsWith('pack_') && (f.endsWith('.txt') || f.endsWith('.md')));
      for (const f of files) {
        if (seen.has(f)) continue;
        const normPack = f.toLowerCase().replace(/^pack_/, '').replace(/\.(txt|md)$/, '').replace(/[-_]/g, '');
        if (normPack === normNb || normAliases.includes(normPack) || normPack.includes(normNb)) {
          seen.add(f);
          const fullPath = path.join(dir, f);
          const st = fs.statSync(fullPath);
          matched.push({
            id: f,
            title: f.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
            modified_at: st.mtime.toISOString(),
            size_bytes: st.size,
            fullPath,
          });
        }
      }
    } catch {}
  }

  if (matched.length > 0) {
    return matched.slice(0, 10);
  }

  return [
    { id: `${nbId}-manifest.json`, modified_at: new Date().toISOString(), size_bytes: 1024 }
  ];
}

export function getRealGapForNotebook(nbId, gapsFilePath, options = {}) {
  if (options.targetGap && options.mockExcerpt) {
    return {
      targetGap: options.targetGap,
      rawExcerpt: options.mockExcerpt,
      sourceTitle: options.sourceTitle || `${nbId}_source`,
    };
  }

  let aliases = [];
  try {
    const catData = loadCategoriesData();
    if (catData?.categories?.[nbId]?.aliases) {
      aliases = catData.categories[nbId].aliases;
    }
  } catch {}

  const normNb = String(nbId).toLowerCase().replace(/[-_]/g, '');
  const normAliases = aliases.map((a) => a.toLowerCase().replace(/[-_]/g, ''));
  const allKeys = [normNb, ...normAliases, nbId.toLowerCase().replace(/[-_]/g, ' ')].filter((k) => k.length >= 3);

  // 1. Search in trm-research-gaps.md
  if (fs.existsSync(gapsFilePath)) {
    try {
      const gapsContent = fs.readFileSync(gapsFilePath, 'utf8');
      const lines = gapsContent.split('\n');
      const gapRegex = /^-\s*\[[ /xX]\]\s*\[(GAP-\d+)\]\s*\*\*([^*]+)\*\*:\s*(.+)$/;

      for (const line of lines) {
        const match = line.match(gapRegex);
        if (match) {
          const gapId = match[1];
          const header = match[2];
          const body = match[3];

          const headerNorm = header.toLowerCase().replace(/[-_]/g, '');
          if (allKeys.some((k) => headerNorm.includes(k.replace(/ /g, '')))) {
            return {
              targetGap: options.targetGap || gapId,
              rawExcerpt: options.mockExcerpt || body.replace(/\(Drafted:.*?\)/, '').trim(),
              sourceTitle: header.trim(),
            };
          }
        }
      }
    } catch {}
  }

  // 2. Extract grounded excerpt from real discovered sources
  const currentSources = options.currentSources || getRealSourcesForNotebook(nbId, options);
  if (Array.isArray(currentSources) && currentSources.length > 0) {
    for (const src of currentSources) {
      const srcPath = src.fullPath || (src.id && fs.existsSync(src.id) ? src.id : null);
      if (srcPath && fs.existsSync(srcPath) && (srcPath.endsWith('.md') || srcPath.endsWith('.txt'))) {
        try {
          const content = fs.readFileSync(srcPath, 'utf8');
          const lines = content.split('\n')
            .map((l) => l.trim())
            .filter((l) => l.length > 25 && !l.startsWith('#') && !l.startsWith('---') && !l.startsWith('>') && !l.startsWith('|'));
          if (lines.length > 0) {
            return {
              targetGap: options.targetGap || `GAP-${nbId.toUpperCase()}`,
              rawExcerpt: options.mockExcerpt || lines[0],
              sourceTitle: src.id,
            };
          }
        } catch {}
      }
    }
  }

  return {
    targetGap: options.targetGap || `GAP-${nbId.toUpperCase()}`,
    rawExcerpt: options.mockExcerpt || `Domain research analysis and truth vector verification for ${nbId}.`,
    sourceTitle: `${nbId}_domain`,
  };
}

export async function runClosedLoopResearch(options = {}) {
  const mode = options.mode || 'active';
  const dryRun = Boolean(options.dryRun);
  const targetNotebook = options.notebook;
  const baseDir = options.baseDir || path.join(process.cwd(), '_kb-sync-staging', 'trm');
  const logFile = path.join(process.cwd(), 'wiki', 'Log.md');
  const gapsFilePath = options.gapsFilePath || path.join(process.cwd(), 'trm-research-gaps.md');
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

  let canonicalTargets = ['willow-run', 'ford-politics', 'post-war', 'cuba-claims', 'miami-estate', 'assembly-line', 'daily', 'master-kb', 'ironledger'];
  try {
    const catData = loadCategoriesData();
    if (catData?.categories) {
      canonicalTargets = Object.keys(catData.categories);
    }
  } catch {}

  const notebooks = targetNotebook
    ? [targetNotebook]
    : Object.keys(fingerprints).length
    ? Object.keys(fingerprints)
    : canonicalTargets;

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
    const currentSources = getRealSourcesForNotebook(nbId, options);
    const currentHash = computeManifestHash(currentSources);
    const delta = evaluateSourceDelta(nbFingerprint, currentSources);

    if (delta.deltaType === 'NO_DELTA') {
      const logLine = `[${new Date().toISOString()}] TRM-DIFF-GATE: Notebook ${nbId} unchanged; skipping mining pass (mode: ${mode})\n`;
      if (!dryRun) {
        try { fs.appendFileSync(logFile, logLine); } catch {}
      }
      results.push({ notebookId: nbId, status: 'SKIPPED_NO_DELTA', mode });
      continue;
    }

    if (delta.deltaType === 'SOURCE_DELETED') {
      cascadeSourceDeletion(delta.removedSourceIds, settledFactsPath);
      nbFingerprint.generation = (nbFingerprint.generation || 1) + 1;
      nbFingerprint.source_ids = currentSources.map((s) => s.id);
      nbFingerprint.inventory_hash = currentHash;
      fingerprints[nbId] = nbFingerprint;
      if (!dryRun) atomicWriteJson(fingerprintsPath, fingerprints);
      results.push({ notebookId: nbId, status: 'SOURCE_DELETED_CASCADED', mode });
      continue;
    }

    // Stage 2: Two-Tier Query Engine Execution (Governed Evaluator)
    const runId = `run_${Date.now()}_${nbId}`;
    const minedGap = getRealGapForNotebook(nbId, gapsFilePath, { ...options, currentSources });
    const evalPayload = {
      targetGap: minedGap.targetGap,
      sourceTitle: minedGap.sourceTitle || currentSources[0]?.id || 'unknown_source'
    };

    const isRemoteAllowed = options.remoteEvaluatorAllowed !== undefined
      ? Boolean(options.remoteEvaluatorAllowed)
      : (process.env.REMOTE_EVALUATOR_ALLOWED === 'true' || Boolean(options.notebookConfig?.remote_evaluator_allowed));

    const nbConfig = options.notebookConfig || {
      notebook_id: nbId,
      remote_evaluator_allowed: isRemoteAllowed
    };

    const defaultOllamaUrl = process.env.OLLAMA_URL || process.env.OLLAMA_HOST || 'http://localhost:11434/api/generate';
    const evalResult = await dispatchEvaluator(evalPayload, nbConfig, {
      ollamaUrl: options.ollamaUrl !== undefined ? options.ollamaUrl : defaultOllamaUrl,
      budgetPath: path.join(baseDir, 'cloud_evaluator_budget.json'),
      ollamaTimeoutMs: options.ollamaTimeoutMs ?? 500
    });

    // Stage 3: Attribution Extraction & Canonical Span Normalization
    const rawExcerpt = minedGap.rawExcerpt;
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
    const tx = createTransaction(runId, nbId, nbFingerprint.generation || 1, { baseDir, dryRun });
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
      nbFingerprint.source_ids = currentSources.map((s) => s.id);
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
    } else if (args[i].startsWith('--notebook=')) {
      options.notebook = args[i].split('=')[1];
    } else if (args[i] === '--dry-run') {
      options.dryRun = true;
    } else if (args[i] === '--remote-evaluator' || args[i] === '--remote') {
      options.remoteEvaluatorAllowed = true;
    }
  }
  return options;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const options = parseCliArgs();
  runClosedLoopResearch(options).then((res) => {
    console.log(`[TRM-RUNNER] Mode: ${res.mode} | Processed: ${res.count} notebook(s)`);
    res.results.forEach((r) => console.log(` - ${r.notebookId}: ${r.status} (${r.evaluator || 'skipped'})`));
  }).catch((err) => {
    console.error(`[TRM-RUNNER] Error: ${err.message}`);
    process.exit(1);
  });
}
