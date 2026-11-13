#!/usr/bin/env node
// ==============================================================================
// Thematic Knowledge Pack Consolidator (Stage 6)
// Emits modular packs into .nlm_pack/ partitioned by research category:
// - .nlm_pack/pack_willow_run.txt      (Target: CIC - Willow Run & Aviation Engineering)
// - .nlm_pack/pack_ford_politics.txt   (Target: CIC - Ford Executive Dynamics & Politics)
// - .nlm_pack/pack_post_war.txt        (Target: CIC - Post-War)
// - .nlm_pack/pack_willys_overland.txt (Target: CIC - Willys-Overland)
// - .nlm_pack/pack_master_kb.txt       (Target: CIC-KB)
// Injects Evidence-Mode Fact Registries at the header of each pack within
// strict chunk ceilings (<= 380 KiB total, <= 38 KiB fact registry).
// ==============================================================================

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { NOTEBOOK_TARGETS, resolveNotebookId, resolveCategoryKey, getMasterKbExclusions } from '../core/config.mjs';
import { partitionPackIntoChunks } from '../core/nlm-chunker.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COLOR = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', reset: '\x1b[0m' };
const logInfo = (msg) => console.log(`${COLOR.green}[CONSOLIDATE-PACK] [INFO]${COLOR.reset} ${msg}`);
const logWarn = (msg) => console.log(`${COLOR.yellow}[CONSOLIDATE-PACK] [WARN]${COLOR.reset} ${msg}`);
const logError = (msg) => console.error(`${COLOR.red}[CONSOLIDATE-PACK] [ERROR]${COLOR.reset} ${msg}`);

export const MAX_FACT_REGISTRY_BYTES = 38 * 1024; // 38 KiB ceiling for fact registry
export const MAX_PACK_BYTES = 380 * 1024; // 380 KiB chunk ceiling

export const THEMATIC_PACK_MAP = [
  {
    category: 'willow-run',
    filename: 'pack_willow_run.txt',
    notebookId: NOTEBOOK_TARGETS['willow-run'],
    title: 'CIC - Willow Run & Aviation Engineering'
  },
  {
    category: 'ford-politics',
    filename: 'pack_ford_politics.txt',
    notebookId: NOTEBOOK_TARGETS['ford-politics'],
    title: 'CIC - Ford Executive Dynamics & Politics'
  },
  {
    category: 'post-war',
    filename: 'pack_post_war.txt',
    notebookId: NOTEBOOK_TARGETS['post-war'],
    title: 'CIC - Post-War'
  },
  {
    category: 'willys-overland',
    filename: 'pack_willys_overland.txt',
    notebookId: NOTEBOOK_TARGETS['willys-overland'],
    title: 'CIC - Willys-Overland'
  },
  {
    category: 'cuba-claims',
    filename: 'pack_cuba_claims.txt',
    notebookId: NOTEBOOK_TARGETS['cuba-claims'],
    title: 'CIC - Cuban Seizures & Retired Assets'
  },
  {
    category: 'miami-estate',
    filename: 'pack_miami_estate.txt',
    notebookId: NOTEBOOK_TARGETS['miami-estate'],
    title: 'CIC - Miami Estate & Florida Retirement'
  },
  {
    category: 'assembly-line',
    filename: 'pack_assembly_line.txt',
    notebookId: NOTEBOOK_TARGETS['assembly-line'],
    title: 'CIC - Rouge, Model T & Moving Assembly Line'
  },
  {
    category: 'daily',
    filename: 'pack_daily.txt',
    notebookId: NOTEBOOK_TARGETS['daily'] || '1b4861a3-931f-4632-8fc1-343a8dd37df8',
    title: 'CIC - Daily Research (Buffer/Intake)'
  },
  {
    category: 'master-kb',
    filename: 'pack_master_kb.txt',
    notebookId: NOTEBOOK_TARGETS['master-kb'],
    title: 'CIC-KB (Master Knowledge Base)'
  }
];

// Filename patterns for packs whose notes are rarely tagged with their own
// frontmatter category (post-war and Willys-Overland notes ship as `research`).
const FILENAME_BUCKET_PATTERNS = [
  { bucket: 'post-war', pattern: /post[-_ ]?war/i },
  { bucket: 'willys-overland', pattern: /willys/i },
  { bucket: 'cuba-claims', pattern: /cuba(?:n[-_ ]?seizures|[-_ ]?claims)?/i },
  { bucket: 'miami-estate', pattern: /miami[-_ ]?estate/i },
  { bucket: 'assembly-line', pattern: /(?:moving[-_ ]?)?assembly[-_ ]?line/i }
];

// `daily` is the catch-all category (`research` resolves to it), so it does not block filename matching.
const EXPLICIT_BUCKETS = new Set([
  'willow-run',
  'ford-politics',
  'post-war',
  'willys-overland',
  'cuba-claims',
  'miami-estate',
  'assembly-line'
]);

/**
 * Returns the filename-matched buckets for a note that has no explicit
 * thematic frontmatter category. A note matching several patterns lands in each.
 * @param {string} resolvedCategory category after resolveCategoryKey
 * @param {string} relPath repo-relative note path
 * @param {Set<string>} nonHistoricalCategories categories barred from historical packs
 * @returns {string[]}
 */
export function resolveFilenameBuckets(resolvedCategory, relPath, nonHistoricalCategories = new Set()) {
  if (EXPLICIT_BUCKETS.has(resolvedCategory) || nonHistoricalCategories.has(resolvedCategory)) return [];
  const base = path.posix.basename(String(relPath).replace(/\\/g, '/'));
  return FILENAME_BUCKET_PATTERNS.filter(({ pattern }) => pattern.test(base)).map(({ bucket }) => bucket);
}

/**
 * Computes SHA-256 hash of a string.
 * @param {string} content
 * @returns {string} Hex hash
 */
export function computeSha256(content) {
  return crypto.createHash('sha256').update(content || '', 'utf8').digest('hex');
}

/**
 * Formats a single fact entry for the Evidence-Mode Fact Registry.
 * @param {Object} fact
 * @returns {string}
 */
export function formatFactEntry(fact) {
  const status = fact.verification_status || 'verified';
  const shortHash = (fact.fact_id || '').replace(/^sha256:/, '').slice(0, 7);
  const anchor = fact.temporal_anchor ? ` | ${fact.temporal_anchor}` : '';
  const hashTag = shortHash ? ` [hash: ${shortHash}]` : '';
  return `- [${status}] ${fact.subject} | ${fact.predicate} | ${fact.object}${anchor}${hashTag}`;
}

/**
 * Formats the full Fact Registry section within the byte ceiling.
 * @param {Array<Object>} facts
 * @param {number} maxBytes
 * @returns {string}
 */
export function formatFactRegistrySection(facts = [], maxBytes = MAX_FACT_REGISTRY_BYTES) {
  if (!Array.isArray(facts) || facts.length === 0) return '';
  const headerLines = [
    '=== FACT REGISTRY (EVIDENCE MODE) ==='
  ];
  const footerLine = '================================================================================\n\n';

  const entries = [];
  let currentBytes = Buffer.byteLength(headerLines.join('\n') + '\n' + footerLine, 'utf8');
  let truncatedCount = 0;

  for (const fact of facts) {
    const line = formatFactEntry(fact);
    const lineBytes = Buffer.byteLength(line + '\n', 'utf8');
    if (currentBytes + lineBytes > maxBytes) {
      truncatedCount++;
      continue;
    }
    entries.push(line);
    currentBytes += lineBytes;
  }

  if (truncatedCount > 0) {
    logWarn(`Fact registry capped: ${truncatedCount} fact(s) truncated to stay within ${(maxBytes / 1024).toFixed(1)} KiB ceiling.`);
  }

  if (entries.length === 0) return '';

  return `${headerLines.join('\n')}\n${entries.join('\n')}\n${footerLine}`;
}

/**
 * Loads and filters settled facts for a specific pack category.
 * @param {string} rootDir
 * @param {string} categoryKey
 * @param {Array<Object>} constituentItems
 * @param {Set<string>} nonHistoricalCategories
 * @returns {Array<Object>}
 */
export function loadScopedFacts(rootDir, categoryKey, constituentItems = [], nonHistoricalCategories = new Set()) {
  const stagingPaths = [
    path.join(rootDir, '_kb-sync-staging', 'trm', 'settled_facts.json'),
    path.join(rootDir, '_kb-sync-staging', 'settled_facts.json')
  ];

  let rawFacts = [];
  for (const p of stagingPaths) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          rawFacts = parsed;
          break;
        } else if (parsed && Array.isArray(parsed.facts)) {
          rawFacts = parsed.facts;
          break;
        }
      } catch (err) {
        logWarn(`Could not parse settled facts from ${p}: ${err.message}`);
      }
    }
  }

  if (rawFacts.length === 0) {
    return [];
  }

  const targetPackDef = THEMATIC_PACK_MAP.find((p) => p.category === categoryKey);
  const targetAliases = new Set([categoryKey, ...(targetPackDef?.aliases || [])]);

  const itemMap = new Map();
  for (const item of constituentItems) {
    itemMap.set(item.relPath, item);
  }

  const diskHashCache = new Map();
  const validFacts = [];

  for (const fact of rawFacts) {
    if (!fact || !fact.subject || !fact.predicate || !fact.object) continue;

    const sourcePath = (fact.source_path || '').replace(/\\/g, '/');
    const matchedItem = itemMap.get(sourcePath);

    if (!matchedItem && categoryKey !== 'master-kb') {
      const factCat = resolveCategoryKey(fact.category || '');
      if (!targetAliases.has(factCat)) {
        continue;
      }
    }

    if (categoryKey === 'master-kb') {
      const factCat = resolveCategoryKey(fact.category || (matchedItem?.frontmatter?.category) || '');
      if (nonHistoricalCategories.has(factCat)) {
        continue;
      }
    }

    let status = fact.verification_status || 'verified';
    if (matchedItem) {
      const liveHash = computeSha256(matchedItem.content);
      if (fact.source_hash_sha256 && fact.source_hash_sha256 !== liveHash) {
        status = 'unanchored';
      }
    } else if (sourcePath) {
      let liveHash = diskHashCache.get(sourcePath);
      if (liveHash === undefined) {
        const fullPath = path.join(rootDir, sourcePath);
        if (fs.existsSync(fullPath)) {
          try {
            const content = fs.readFileSync(fullPath, 'utf8');
            liveHash = computeSha256(content);
          } catch {
            liveHash = null;
          }
        } else {
          liveHash = null;
        }
        diskHashCache.set(sourcePath, liveHash);
      }

      if (liveHash === null) {
        continue; // Exclude deleted or unreadable file facts
      }

      if (fact.source_hash_sha256 && fact.source_hash_sha256 !== liveHash) {
        status = 'unanchored';
      }
    }

    validFacts.push({
      ...fact,
      verification_status: status
    });
  }

  // Deterministic sort: verified first, then unanchored, then by temporal_anchor descending
  validFacts.sort((a, b) => {
    const priority = { verified: 0, extracted: 1, unanchored: 2 };
    const pA = priority[a.verification_status] ?? 3;
    const pB = priority[b.verification_status] ?? 3;
    if (pA !== pB) return pA - pB;
    return String(b.temporal_anchor || '').localeCompare(String(a.temporal_anchor || ''));
  });

  return validFacts;
}

export function extractFrontmatter(content) {
  if (typeof content !== 'string') return {};
  const parts = content.split(/^---\r?\n/m);
  if (parts.length < 3) return {};
  const fmRaw = parts[1];
  const data = {};
  for (const line of fmRaw.split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
    if (m) {
      data[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return data;
}

export function findPackFamilyFiles(outDir, filename) {
  const base = filename.replace(/\.txt$/i, '').toLowerCase();
  const partRe = new RegExp(`^${base}_part\\d+\\.txt$`);
  return fs.readdirSync(outDir).filter((f) => {
    const lower = f.toLowerCase();
    return lower === `${base}.txt` || partRe.test(lower);
  });
}

// The kb-sync repo root. This file lives in scripts/, one level below it. The
// research corpus is <root>/wiki and the sync runner reads <root>/.nlm_pack first.
export const DEFAULT_ROOT_DIR = path.resolve(__dirname, '..');
export const DEFAULT_OUT_DIR = path.join(DEFAULT_ROOT_DIR, '.nlm_pack');

export function consolidatePacks(options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT_DIR;
  const outDir = options.outDir || path.join(rootDir, '.nlm_pack');

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  logInfo(`Consolidating thematic packs from root: ${rootDir}`);
  logInfo(`Output directory: ${outDir}`);

  // Collect candidate files from wiki
  const scanDirs = [
    path.join(rootDir, 'wiki')
  ];

  const candidateFiles = [];
  const trmGapsPath = path.join(rootDir, 'trm-research-gaps.md');
  if (fs.existsSync(trmGapsPath)) {
    candidateFiles.push(trmGapsPath);
  }

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== '_kb-sync-staging') {
          walk(full);
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        candidateFiles.push(full);
      }
    }
  }

  for (const sDir of scanDirs) {
    walk(sDir);
  }

  logInfo(`Discovered ${candidateFiles.length} markdown source files.`);

  // Categories marked `exclude_from_master_kb` in core/categories.json (software,
  // personal-os, and KB-documentation domains) must never bundle into the
  // historical master-kb pack (see docs/targets isolation invariant).
  const NON_HISTORICAL_CATEGORIES = getMasterKbExclusions();

  // Parse and organize files by category
  const categorized = {
    'willow-run': [],
    'ford-politics': [],
    'post-war': [],
    'willys-overland': [],
    'cuba-claims': [],
    'miami-estate': [],
    'assembly-line': [],
    'daily': [],
    'master-kb': []
  };

  for (const filePath of candidateFiles) {
    try {
      const relPath = path.relative(rootDir, filePath).replace(/\\/g, '/');
      const content = fs.readFileSync(filePath, 'utf8');
      const fm = extractFrontmatter(content);
      const cat = resolveCategoryKey(fm.category || '');

      const item = { relPath, filePath, content, frontmatter: fm };

      if (cat !== 'master-kb' && categorized[cat]) {
        categorized[cat].push(item);
      }

      // Additive: notes tagged with a catch-all category still reach the
      // post-war and Willys-Overland packs when their filename names the topic.
      for (const bucket of resolveFilenameBuckets(cat, relPath, NON_HISTORICAL_CATEGORIES)) {
        categorized[bucket].push(item);
      }

      // Master KB includes all historical notes, excluding software and
      // personal-os categories to preserve domain isolation.
      if (!NON_HISTORICAL_CATEGORIES.has(cat)) {
        categorized['master-kb'].push(item);
      }
    } catch (err) {
      logWarn(`Could not read ${filePath}: ${err.message}`);
    }
  }

  const generatedPacks = [];

  for (const packDef of THEMATIC_PACK_MAP) {
    const items = categorized[packDef.category] || [];
    const facts = loadScopedFacts(rootDir, packDef.category, items, NON_HISTORICAL_CATEGORIES);

    const shards = partitionPackIntoChunks(packDef, items, facts, {
      maxPackBytes: MAX_PACK_BYTES,
      maxFactBytes: MAX_FACT_REGISTRY_BYTES
    });

    const written = new Set();
    for (const shard of shards) {
      const packFile = path.join(outDir, shard.filename);
      fs.writeFileSync(packFile, shard.payload, 'utf8');
      written.add(shard.filename);
      const bytes = fs.statSync(packFile).size;

      if (bytes > MAX_PACK_BYTES) {
        logWarn(`Pack ${shard.filename} (${(bytes / 1024).toFixed(2)} KB) exceeds ${MAX_PACK_BYTES / 1024} KiB chunk boundary!`);
      } else {
        logInfo(`✓ Emitted ${shard.filename} (${(bytes / 1024).toFixed(2)} KB, ${shard.itemCount} files, ${shard.factCount} facts) -> Target: ${packDef.notebookId}`);
      }

      generatedPacks.push({
        packDef,
        packFile,
        bytes,
        fileCount: shard.itemCount,
        factCount: shard.factCount,
        shardIndex: shard.shardIndex || 1,
        totalShards: shard.totalShards || 1
      });
    }

    // The sync runner prefers _partN files over the single pack, so any family
    // file this build did not write would be uploaded as stale content.
    for (const stale of findPackFamilyFiles(outDir, packDef.filename)) {
      if (!written.has(stale)) {
        fs.unlinkSync(path.join(outDir, stale));
        logInfo(`Removed stale pack file ${stale}`);
      }
    }
  }

  return generatedPacks;
}

const mainFile = process.argv[1] ? fs.realpathSync(process.argv[1]) : '';
const thisFile = fs.realpathSync(__filename);
if (mainFile === thisFile) {
  try {
    consolidatePacks();
    logInfo('Thematic knowledge pack consolidation completed successfully.');
  } catch (err) {
    logError(`Consolidation failed: ${err.message}`);
    process.exit(1);
  }
}
