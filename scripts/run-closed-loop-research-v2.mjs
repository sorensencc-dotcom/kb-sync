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

export function cascadeSourceDeletion(removedSourceIds, settledFactsPath, options = {}) {
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
  if (changed && !options.dryRun) atomicWriteJson(settledFactsPath, facts);
}

const DOMAIN_DISCOVERY = {
  'willow-run': {
    dirs: ['wiki/research', 'C:/Users/soren/trm-vault/intake/notebooklm/cic-willow-run-aviation-engineering', 'C:/Users/soren/trm-vault/intake/notebooklm/willow-run-videos', 'C:/Users/soren/trm-vault/intake/notebooklm/the-sorensen-photographic-archive-industrial-giants-at-willow-run'],
    pack: 'pack_willow_run.txt',
    matchKeywords: ['willow', 'aviation', 'b24', 'b-24', 'bomber'],
    gapDomain: 'willow'
  },
  'ford-politics': {
    dirs: ['wiki/research', 'C:/Users/soren/trm-vault/intake/notebooklm/cic-ford-executive-dynamics-politics', 'C:/Users/soren/trm-vault/intake/notebooklm/cast-iron-charlie-research-logs'],
    pack: 'pack_ford_politics.txt',
    matchKeywords: ['ford', 'politics', 'executive', 'labor', 'sorensen', 'bennett', 'bombard'],
    gapDomain: 'ford'
  },
  'post-war': {
    dirs: ['wiki/research', 'C:/Users/soren/trm-vault/intake/notebooklm/cic-post-war-willys-overland'],
    pack: 'pack_willys_overland.txt',
    matchKeywords: ['willys', 'overland', 'post-war', 'postwar', 'jeep'],
    gapDomain: 'post-war'
  },
  'cuba-claims': {
    dirs: ['wiki/research/properties', 'wiki/research', 'C:/Users/soren/trm-vault/intake/notebooklm/cic-cuban-seizures-retired-assets'],
    pack: 'pack_cuban_seizures.txt',
    matchKeywords: ['cuba', 'cuban', 'moa-bay', 'nicaro'],
    gapDomain: 'cuba'
  },
  'miami-estate': {
    dirs: ['wiki/research/properties', 'C:/Users/soren/trm-vault/intake/notebooklm/cast-iron-charlie-research-logs', 'C:/Users/soren/trm-vault/intake/notebooklm/cic-daily-research'],
    pack: null,
    matchKeywords: ['miami', 'florida', 'estate', 'yacht', 'helene'],
    gapDomain: 'miami'
  },
  'assembly-line': {
    dirs: ['C:/Users/soren/trm-vault/intake/notebooklm/cast-iron-charlie-research-logs', 'wiki/research'],
    pack: null,
    matchKeywords: ['assembly', 'rouge', 'model-t', 'modelt', 'moving-assembly'],
    gapDomain: 'assembly'
  },
  'master-kb': {
    dirs: ['wiki', 'C:/Users/soren/trm-vault/intake/notebooklm/cic-kb'],
    pack: 'pack_master_kb.txt',
    matchKeywords: ['cic-kb', 'master', 'wiki', 'index', 'log'],
    gapDomain: 'cic-kb'
  },
  'daily': {
    dirs: ['wiki/research', 'C:/Users/soren/trm-vault/intake/notebooklm/cic-daily-research'],
    pack: 'pack_daily.txt',
    matchKeywords: ['daily', 'ironbots-daily', 'intake'],
    gapDomain: 'daily'
  },
  'research-deltas': {
    dirs: ['wiki/research', 'C:/Users/soren/trm-vault/intake/notebooklm/cic-research-deltas-living-matrix'],
    pack: null,
    matchKeywords: ['research-deltas', 'living-matrix', 'matrix', 'delta'],
    gapDomain: 'research-deltas'
  },
  'ironledger': {
    dirs: ['C:/dev/IronLedger', 'wiki/specs', 'wiki/concepts'],
    pack: null,
    matchKeywords: ['ironledger', 'financial', 'ledger', 'balance'],
    gapDomain: null
  },
  'sigil': {
    dirs: ['C:/dev/sigil-repo', 'wiki/concepts', 'wiki/research'],
    pack: null,
    matchKeywords: ['sigil', 'protocol', 'federation'],
    gapDomain: null
  },
  'agent-harness': {
    dirs: ['wiki/concepts', 'wiki/entities', 'C:/dev/graft', 'docs/targets'],
    pack: null,
    matchKeywords: ['graft', 'harness', 'herdr', 'sam-safeguards'],
    gapDomain: null
  },
  'rewrite-labs': {
    dirs: ['C:/dev/rewrite-docs', 'C:/dev/rewrite-mcp', 'wiki/rewrite'],
    pack: null,
    matchKeywords: ['rewrite', 'ssg', 'redesign', 'claude', 'readme', 'roadmap'],
    gapDomain: null
  },
  'dev-triage': {
    dirs: ['docs/superpowers/specs', 'wiki/entities', 'docs/operations', 'docs/audit/ironbot'],
    pack: null,
    matchKeywords: ['triage', 'ironbot', 'audit', 'ci-watchdog', 'gap-triage', 'monitor'],
    gapDomain: null
  },
  'personal-os': {
    dirs: ['docs', 'C:/dev/.nlm_pack', '.nlm_pack'],
    pack: 'pack_personal_os.txt',
    matchKeywords: ['personal_os', 'personal-os', 'household', 'utilities'],
    gapDomain: null
  },
  'governance': {
    dirs: ['docs/governance'],
    pack: null,
    matchKeywords: ['governance', 'policy', 'charter', 'approval'],
    gapDomain: null
  },
  'meta': {
    dirs: ['docs/meta/specs', 'docs/meta/plans', 'docs/meta'],
    pack: null,
    matchKeywords: ['meta', 'compacted-context', 'architecture', 'spec'],
    gapDomain: null
  },
  'modules': {
    dirs: ['docs/modules', 'modules'],
    pack: 'pack_modules.txt',
    matchKeywords: ['modules', 'artifact-generator', 'module'],
    gapDomain: null
  },
  'operations': {
    dirs: ['docs/operations', 'docs/operations/kb-sync-nightly-reports'],
    pack: null,
    matchKeywords: ['operations', 'nightly-audit', 'task-scheduler', 'runbook'],
    gapDomain: null
  },
  'skills': {
    dirs: ['docs/skills', 'skills', 'docs/governance'],
    pack: null,
    matchKeywords: ['skills', 'skill', 'obsidian-ingest', 'skill-approval'],
    gapDomain: null
  },
  'superpowers': {
    dirs: ['docs/superpowers/plans', 'docs/superpowers/specs', 'docs/superpowers'],
    pack: null,
    matchKeywords: ['superpowers', 'superpower', 'enhancements', 'coverage-remediation'],
    gapDomain: null
  },
  'targets': {
    dirs: ['docs/targets'],
    pack: null,
    matchKeywords: ['targets', 'target', 'notebooklm', 'obsidian'],
    gapDomain: null
  }
};

function extractFirstContentParagraph(text) {
  if (!text || typeof text !== 'string') return null;
  let body = text.trim();
  if (body.startsWith('{') && body.endsWith('}')) {
    try {
      const obj = JSON.parse(body);
      const desc = obj.description || obj.summary || obj.title || obj.name || obj.status || obj.message;
      if (desc && typeof desc === 'string' && desc.length > 10) return desc;
    } catch {}
  }
  // Strip YAML frontmatter if present
  if (body.startsWith('---')) {
    const endIdx = body.indexOf('\n---', 3);
    if (endIdx !== -1) {
      body = body.slice(endIdx + 4);
    }
  }
  const lines = body.split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 20 && !l.startsWith('#') && !l.startsWith('>') && !l.startsWith('|') && !l.startsWith('<!--') && !l.startsWith('```') && !l.startsWith('title:') && !l.startsWith('- ') && !l.startsWith('* '));
  return lines.length > 0 ? lines[0] : null;
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

  const config = DOMAIN_DISCOVERY[nbId];
  if (!config) {
    if (options.mockSources) return options.mockSources;
    throw new Error(`Unrecognized notebook domain: ${nbId}`);
  }

  const matched = [];
  const seen = new Set();

  // 1. Scan assigned domain directories
  for (const dir of config.dirs) {
    const fullDir = path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
    if (!fs.existsSync(fullDir)) continue;
    try {
      const entries = fs.readdirSync(fullDir, { withFileTypes: true });
      entries.sort((a, b) => {
        const aIsDoc = a.name.endsWith('.md') || a.name.endsWith('.txt');
        const bIsDoc = b.name.endsWith('.md') || b.name.endsWith('.txt');
        if (aIsDoc && !bIsDoc) return -1;
        if (!aIsDoc && bIsDoc) return 1;
        return a.name.localeCompare(b.name);
      });
      for (const e of entries) {
        if (!e.isFile()) continue;
        const name = e.name;
        if (!['.md', '.txt', '.json', '.ts', '.mjs', '.ps1'].some((ext) => name.endsWith(ext))) continue;
        if (seen.has(name)) continue;

        const lower = name.toLowerCase();
        const isExclusiveDir = dir.startsWith('docs/') || dir.startsWith('C:/dev/IronLedger') || dir.startsWith('C:/dev/sigil') || dir.startsWith('C:/dev/rewrite');
        const matchesKeyword = config.matchKeywords.some((kw) => lower.includes(kw));

        if (isExclusiveDir || matchesKeyword) {
          seen.add(name);
          const fullPath = path.join(fullDir, name);
          const st = fs.statSync(fullPath);
          matched.push({
            id: name,
            title: name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
            modified_at: st.mtime.toISOString(),
            size_bytes: st.size,
            fullPath,
          });
        }
      }
    } catch {}
  }

  // 2. Exact pack file if specified
  if (config.pack) {
    const packDirs = [path.join(process.cwd(), '.nlm_pack'), 'C:/dev/.nlm_pack'];
    for (const pd of packDirs) {
      const packPath = path.join(pd, config.pack);
      if (fs.existsSync(packPath) && !seen.has(config.pack)) {
        seen.add(config.pack);
        const st = fs.statSync(packPath);
        matched.push({
          id: config.pack,
          title: config.pack.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
          modified_at: st.mtime.toISOString(),
          size_bytes: st.size,
          fullPath: packPath,
        });
      }
    }
  }

  if (matched.length > 0) {
    return matched.slice(0, 10);
  }

  throw new Error(`No grounded source files discovered for notebook: ${nbId}`);
}

export function getRealGapForNotebook(nbId, gapsFilePath, options = {}) {
  if (options.mockExcerpt) {
    return {
      targetGap: options.targetGap || `GAP-${String(nbId).toUpperCase()}`,
      rawExcerpt: options.mockExcerpt,
      sourceTitle: options.sourceTitle || `${nbId}_source`,
    };
  }

  const config = DOMAIN_DISCOVERY[nbId];

  // 1. If historical domain with gaps in trm-research-gaps.md
  if (config?.gapDomain && fs.existsSync(gapsFilePath)) {
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

          const headerLower = header.toLowerCase();
          let isMatch = false;

          if (config.gapDomain === 'willow' && (headerLower.includes('willow') || headerLower.includes('aviation'))) isMatch = true;
          else if (config.gapDomain === 'ford' && (headerLower.includes('ford') || headerLower.includes('politics') || headerLower.includes('executive'))) isMatch = true;
          else if (config.gapDomain === 'post-war' && (headerLower.includes('willys') || headerLower.includes('post-war') || headerLower.includes('overland'))) isMatch = true;
          else if (config.gapDomain === 'cuba' && headerLower.includes('cuban')) isMatch = true;
          else if (config.gapDomain === 'miami' && (headerLower.includes('miami') || headerLower.includes('florida'))) isMatch = true;
          else if (config.gapDomain === 'assembly' && (headerLower.includes('assembly') || headerLower.includes('rouge') || headerLower.includes('model t'))) isMatch = true;
          else if (config.gapDomain === 'cic-kb' && headerLower.includes('cic-kb')) isMatch = true;
          else if (config.gapDomain === 'daily' && headerLower.includes('daily')) isMatch = true;
          else if (config.gapDomain === 'research-deltas' && headerLower.includes('research deltas')) isMatch = true;

          if (isMatch) {
            return {
              targetGap: options.targetGap || gapId,
              rawExcerpt: body.replace(/\(Drafted:.*?\)/, '').trim(),
              sourceTitle: header.trim(),
            };
          }
        }
      }
    } catch {}
  }

  // 2. Extract grounded excerpt from the top primary source document
  const currentSources = options.currentSources || getRealSourcesForNotebook(nbId, options);
  if (Array.isArray(currentSources) && currentSources.length > 0) {
    for (const src of currentSources) {
      const srcPath = src.fullPath || (src.id && fs.existsSync(src.id) ? src.id : null);
      if (srcPath && fs.existsSync(srcPath) && (srcPath.endsWith('.md') || srcPath.endsWith('.txt'))) {
        try {
          const content = fs.readFileSync(srcPath, 'utf8');
          const excerpt = extractFirstContentParagraph(content);
          if (excerpt) {
            return {
              targetGap: options.targetGap || `GAP-${String(nbId).toUpperCase()}`,
              rawExcerpt: excerpt,
              sourceTitle: src.id,
            };
          }
        } catch {}
      }
    }
  }

  // Fallback for ad-hoc / test harness notebooks where mockSources was provided without real disk files
  if (options.mockSources || !config) {
    return {
      targetGap: options.targetGap || `GAP-${String(nbId).toUpperCase()}`,
      rawExcerpt: `Mock research delta payload for test fixture ${nbId}.`,
      sourceTitle: `${nbId}_test_fixture`,
    };
  }

  throw new Error(`Could not derive grounded gap for notebook: ${nbId}`);
}

export async function runClosedLoopResearch(options = {}) {
  const mode = options.mode || 'active';
  const dryRun = Boolean(options.dryRun);
  const targetNotebook = options.notebook || options.targetNotebook;
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
      cascadeSourceDeletion(delta.removedSourceIds, settledFactsPath, { dryRun });
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
