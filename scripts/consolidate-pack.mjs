#!/usr/bin/env node
// ==============================================================================
// Thematic Knowledge Pack Consolidator (Stage 6)
// Emits modular, self-describing packs into .nlm_pack/ partitioned by research category:
// - .nlm_pack/pack_willow_run.txt      (Target: CIC - Willow Run & Aviation Engineering)
// - .nlm_pack/pack_ford_politics.txt   (Target: CIC - Ford Executive Dynamics & Politics)
// - .nlm_pack/pack_post_war.txt        (Target: CIC - Post-War)
// - .nlm_pack/pack_willys_overland.txt (Target: CIC - Willys-Overland)
// - .nlm_pack/pack_cuban_seizures.txt  (Target: CIC - Cuban Seizures & Retired Assets)
// - .nlm_pack/pack_master_kb.txt       (Target: CIC-KB)
// ==============================================================================

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadCategoriesData, buildNotebookTargetMap, NOTEBOOK_TARGETS, resolveNotebookId, getMasterKbExclusions } from '../core/config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COLOR = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', reset: '\x1b[0m' };
const logInfo = (msg) => console.log(`${COLOR.green}[CONSOLIDATE-PACK] [INFO]${COLOR.reset} ${msg}`);
const logWarn = (msg) => console.log(`${COLOR.yellow}[CONSOLIDATE-PACK] [WARN]${COLOR.reset} ${msg}`);
const logError = (msg) => console.error(`${COLOR.red}[CONSOLIDATE-PACK] [ERROR]${COLOR.reset} ${msg}`);
export const MAX_PACK_BYTES = 380 * 1024;

export function getCanonicalPacks() {
  const data = loadCategoriesData();
  const categories = data.categories || {};
  const packList = [];

  for (const [catKey, catDef] of Object.entries(categories)) {
    const safeFilename = `pack_${catKey.replace(/-/g, '_').replace(/[^a-zA-Z0-9_]/g, '_')}.txt`;
    packList.push({
      category: catKey,
      aliases: catDef.aliases || [],
      filename: safeFilename,
      notebookId: catDef.target,
      title: catDef.title,
      status: catDef.status || 'canonical'
    });
  }

  return packList;
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

export function loadEntityManifest(rootDir = path.resolve(__dirname, '..')) {
  const manifestPath = path.join(rootDir, '_kb-sync-staging', 'trm', 'master_entity_manifest.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function injectCrossNotebookDigests(content, currentCategory, manifest, categoriesData) {
  let result = content;
  const entities = manifest?.entities || {};
  const categories = categoriesData?.categories || {};

  for (const [entityKey, entity] of Object.entries(entities)) {
    if (entity.primary_category === currentCategory) continue;
    const targetNotebook = categories[entity.primary_category]?.target;
    if (!targetNotebook) continue;

    const aliases = Array.isArray(entity.aliases) ? entity.aliases : [];
    const mentioned = aliases.some(alias => {
      if (!alias) return false;
      return new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'i').test(content);
    }) || content.includes(`[[${entityKey}]]`);
    if (!mentioned || result.includes(`=== CROSS-NOTEBOOK DIGEST: ${entity.canonical_name} ===`)) continue;

    result += `\n\n=== CROSS-NOTEBOOK DIGEST: ${entity.canonical_name} ===\n`;
    result += `Target Notebook ID: ${targetNotebook}\n`;
    result += `Entity Key: ${entityKey}\n`;
    result += `${entity.l0_summary || ''}\n`;
  }

  return result;
}

export function normalizeWhitespace(content) {
  if (typeof content !== 'string') return '';
  return content
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function formatProvenanceHeader(item) {
  return [
    '=== PROVENANCE ===',
    `source_path: ${item.relPath}`,
    `source_type: ${item.sourceType}`,
    `hash_sha256: ${item.sha256}`,
    `ingested_at: ${new Date().toISOString()}`,
    `source_title: ${item.frontmatter.source_title || 'N/A'}`,
    `repository: ${item.frontmatter.repository || 'N/A'}`,
    `document_date: ${item.frontmatter.document_date || 'N/A'}`,
    `verification_status: ${item.frontmatter.verification_status || 'N/A'}`,
    '===================',
    '',
  ].join('\n');
}

export function serializePackItem(item) {
  const content = normalizeWhitespace(item.enrichedContent ?? item.content);
  return `${formatProvenanceHeader(item)}${content}\n\n--- END OF FILE: ${item.relPath} ---\n\n`;
}

function splitItemIntoParts(item, budget, serialize) {
  const contentToSplit = item.enrichedContent ?? item.content;
  const paragraphs = contentToSplit.split(/\n\n+/);

  const subItems = [];
  let currentParagraphs = [];
  let partIndex = 1;

  function createSubItem(paras, partNum) {
    const subContent = paras.join('\n\n');
    const subRelPath = `${item.relPath} (part ${partNum})`;
    const sub = {
      ...item,
      relPath: subRelPath,
      content: subContent,
    };
    if (item.enrichedContent !== undefined) {
      sub.enrichedContent = subContent;
    }
    return sub;
  }

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];

    const testSub = createSubItem([p], partIndex);
    if (Buffer.byteLength(serialize(testSub), 'utf8') > budget) {
      if (currentParagraphs.length > 0) {
        subItems.push(createSubItem(currentParagraphs, partIndex++));
        currentParagraphs = [];
      }

      const lines = p.split('\n');
      let currentLines = [];
      for (const line of lines) {
        const testLineSub = createSubItem([...currentLines, line], partIndex);
        if (Buffer.byteLength(serialize(testLineSub), 'utf8') > budget) {
          if (currentLines.length > 0) {
            subItems.push(createSubItem(currentLines, partIndex++));
            currentLines = [];
          }
          let remainingLine = line;
          while (remainingLine.length > 0) {
            let sliceLen = remainingLine.length;
            while (sliceLen > 0) {
              const sliceCandidate = remainingLine.slice(0, sliceLen);
              const sliceSub = createSubItem([sliceCandidate], partIndex);
              if (Buffer.byteLength(serialize(sliceSub), 'utf8') <= budget || sliceLen === 1) {
                subItems.push(createSubItem([sliceCandidate], partIndex++));
                remainingLine = remainingLine.slice(sliceLen);
                break;
              }
              sliceLen = Math.floor(sliceLen * 0.8);
            }
          }
        } else {
          currentLines.push(line);
        }
      }
      if (currentLines.length > 0) {
        subItems.push(createSubItem(currentLines, partIndex++));
      }
      continue;
    }

    const candidateSub = createSubItem([...currentParagraphs, p], partIndex);
    if (currentParagraphs.length > 0 && Buffer.byteLength(serialize(candidateSub), 'utf8') > budget) {
      subItems.push(createSubItem(currentParagraphs, partIndex++));
      currentParagraphs = [p];
    } else {
      currentParagraphs.push(p);
    }
  }

  if (currentParagraphs.length > 0) {
    subItems.push(createSubItem(currentParagraphs, partIndex++));
  }

  return subItems;
}

export function partitionPackItems(items, maxBytes = MAX_PACK_BYTES, options = {}) {
  const serialize = options.itemSerializer || serializePackItem;
  const prefix = options.prefix || '';
  const suffix = options.suffix || '';
  const budget = maxBytes - Buffer.byteLength(prefix + suffix, 'utf8');

  const effectiveItems = [];
  for (const item of items) {
    const one = serialize(item);
    if (Buffer.byteLength(one, 'utf8') > budget) {
      const parts = splitItemIntoParts(item, budget, serialize);
      effectiveItems.push(...parts);
    } else {
      effectiveItems.push(item);
    }
  }

  const chunks = [];
  for (const item of effectiveItems) {
    const one = serialize(item);
    if (Buffer.byteLength(prefix + one + suffix, 'utf8') > maxBytes) {
      throw new Error(`ITEM_EXCEEDS_BUDGET: ${item.relPath}`);
    }
    const current = chunks.at(-1);
    const candidate = [...(current || []), item];
    if (current && Buffer.byteLength(prefix + candidate.map(serialize).join('') + suffix, 'utf8') > maxBytes) {
      chunks.push([item]);
    } else if (current) {
      current.push(item);
    } else {
      chunks.push([item]);
    }
  }
  return chunks;
}

function removePackFiles(outDir, category) {
  const safe = category.replace(/-/g, '_').replace(/[^a-zA-Z0-9_]/g, '_');
  const pattern = new RegExp(`^pack_${safe}(?:_part\\d+)?\\.txt$`);
  for (const name of fs.readdirSync(outDir)) {
    if (pattern.test(name)) fs.unlinkSync(path.join(outDir, name));
  }
}

export function consolidatePacks(options = {}) {
  const rootDir = options.rootDir || path.resolve(__dirname, '..');
  const outDir = options.outDir || path.join(rootDir, '.nlm_pack');

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  logInfo(`Consolidating thematic packs from root: ${rootDir}`);
  logInfo(`Output directory: ${outDir}`);

  const canonicalPacks = getCanonicalPacks().filter(packDef => !options.category || packDef.category === options.category);
  const exclusions = getMasterKbExclusions();

  // Map category aliases to canonical category key
  const aliasMap = new Map();
  for (const packDef of canonicalPacks) {
    aliasMap.set(packDef.category.toLowerCase().trim(), packDef.category);
    for (const alias of packDef.aliases) {
      aliasMap.set(alias.toLowerCase().trim(), packDef.category);
    }
  }

  // Collect candidate files from wiki
  const scanDirs = options.scanDirs || [
    path.join(rootDir, 'wiki')
  ];

  const candidateFiles = [];
  const trmGapsPath = path.join(rootDir, 'trm-research-gaps.md');
  if (fs.existsSync(trmGapsPath)) {
    candidateFiles.push(trmGapsPath);
  }

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    const IGNORED_DIRS = new Set(['node_modules', '.git', '_archive', 'archive', 'dist', 'build', '.cache', '.tmp', 'coverage', '_kb-sync-staging']);
    const IGNORED_FILES = new Set(['log.md']);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          walk(full);
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        if (!IGNORED_FILES.has(entry.name.toLowerCase())) {
          candidateFiles.push(full);
        }
      }
    }
  }

  for (const sDir of scanDirs) {
    walk(sDir);
  }

  logInfo(`Discovered ${candidateFiles.length} markdown source files.`);

  // Initialize buckets
  const categorized = {};
  for (const packDef of canonicalPacks) {
    categorized[packDef.category] = [];
  }

  const dynamicPacks = new Map();

  for (const filePath of candidateFiles) {
    try {
      const relPath = path.relative(rootDir, filePath).replace(/\\/g, '/');
      const content = fs.readFileSync(filePath, 'utf8');
      const fm = extractFrontmatter(content);
      const rawCat = (fm.category || '').toLowerCase().trim();
      const sha256 = crypto.createHash('sha256').update(content.trim()).digest('hex');

      const item = {
        relPath,
        filePath,
        content,
        frontmatter: fm,
        sha256,
        sourceType: 'markdown'
      };

      let canonicalKey;
      if (rawCat && aliasMap.has(rawCat)) {
        canonicalKey = aliasMap.get(rawCat);
        categorized[canonicalKey].push(item);
      } else if (rawCat) {
        // Unknown category: dynamically bucket
        if (!dynamicPacks.has(rawCat)) {
          dynamicPacks.set(rawCat, []);
        }
        dynamicPacks.get(rawCat).push(item);
      }

      // Master KB includes all valid notes
      if (categorized['master-kb'] && !exclusions.has(canonicalKey)) {
        categorized['master-kb'].push(item);
      }
    } catch (err) {
      logWarn(`Could not read ${filePath}: ${err.message}`);
    }
  }

  if (options.category) dynamicPacks.clear();

  const generatedPacks = [];

  // Emit Canonical Packs
  for (const packDef of canonicalPacks) {
    removePackFiles(outDir, packDef.category);
    const items = categorized[packDef.category] || [];

    let payload = `# ==============================================================================\n`;
    payload += `# PACK: ${packDef.category}\n`;
    payload += `# TITLE: ${packDef.title}\n`;
    payload += `# STATUS: ${packDef.status}\n`;
    payload += `# TARGET_NOTEBOOK: ${packDef.notebookId}\n`;
    payload += `# SOURCE: consolidate-pack.mjs\n`;
    payload += `# GENERATED: ${new Date().toISOString()}\n`;
    payload += `# FILE_COUNT: ${items.length}\n`;
    payload += `# ==============================================================================\n\n`;

    let entityManifest;
    try {
      entityManifest = loadEntityManifest(rootDir);
    } catch (_) {
      entityManifest = { entities: {} };
    }
    const categoriesData = loadCategoriesData();

    const enrichedItems = items.map(item => ({
      ...item,
      enrichedContent: injectCrossNotebookDigests(item.content, packDef.category, entityManifest, categoriesData)
    }));
    const chunks = partitionPackItems(enrichedItems, MAX_PACK_BYTES, { prefix: payload });
    chunks.forEach((chunk, index) => {
      const filename = chunks.length === 1 ? packDef.filename : `pack_${packDef.category.replace(/-/g, '_')}_part${index + 1}.txt`;
      const packFile = path.join(outDir, filename);
      const serialized = payload + chunk.map(serializePackItem).join('');
      fs.writeFileSync(packFile, serialized, 'utf8');
      const bytes = Buffer.byteLength(serialized, 'utf8');
      logInfo(`✓ Emitted ${filename} (${(bytes / 1024).toFixed(2)} KB, ${chunk.length} files) -> Target: ${packDef.notebookId}`);
      generatedPacks.push({ packDef: { ...packDef, filename }, packFile, bytes, fileCount: chunk.length });
    });
  }

  // Handle Dynamic Placeholder Packs
  for (const [dynCat, dynItems] of dynamicPacks.entries()) {
    const safeCatName = dynCat.replace(/[^a-zA-Z0-9_-]/g, '_');
    const packFile = path.join(outDir, `pack_placeholder_${safeCatName}.txt`);
    const fallbackTarget = NOTEBOOK_TARGETS['daily'] || '1b4861a3-931f-4632-8fc1-343a8dd37df8';

    let payload = `# ==============================================================================\n`;
    payload += `# PACK: placeholder::${dynCat}\n`;
    payload += `# TITLE: Dynamic Unmapped Topic - ${dynCat}\n`;
    payload += `# STATUS: unmapped\n`;
    payload += `# TARGET_NOTEBOOK: ${fallbackTarget} (PENDING OPERATOR REGISTRATION)\n`;
    payload += `# SOURCE: consolidate-pack.mjs\n`;
    payload += `# GENERATED: ${new Date().toISOString()}\n`;
    payload += `# FILE_COUNT: ${dynItems.length}\n`;
    payload += `# OPERATOR_REQUIRED: true - do not ingest until mapped to canonical target\n`;
    payload += `# ==============================================================================\n\n`;

    for (const item of dynItems) {
      payload += formatProvenanceHeader(item);
      payload += `${item.content}\n\n`;
      payload += `--- END OF FILE: ${item.relPath} ---\n\n`;
    }

    fs.writeFileSync(packFile, payload, 'utf8');
    const bytes = fs.statSync(packFile).size;
    logWarn(`[DYNAMIC-TOPIC] Emitted unmapped placeholder pack: ${packFile} (${(bytes / 1024).toFixed(2)} KB, ${dynItems.length} files) -> Operator action required.`);

    generatedPacks.push({
      packDef: { category: `placeholder::${dynCat}`, filename: `pack_placeholder_${safeCatName}.txt`, notebookId: fallbackTarget, title: `Placeholder - ${dynCat}`, status: 'unmapped' },
      packFile,
      bytes,
      fileCount: dynItems.length
    });
  }

  return generatedPacks;
}

const mainFile = process.argv[1] ? fs.realpathSync(process.argv[1]) : '';
const thisFile = fs.realpathSync(__filename);
if (mainFile === thisFile) {
  try {
    const categoryArg = process.argv.find(a => a.startsWith('--category=') || a.startsWith('-c='));
    const category = categoryArg ? categoryArg.split('=')[1].trim().replace(/^['"]|['"]$/g, '') : null;
    consolidatePacks({ category });
    logInfo('Thematic knowledge pack consolidation completed successfully.');
  } catch (err) {
    logError(`Consolidation failed: ${err.message}`);
    process.exit(1);
  }
}
