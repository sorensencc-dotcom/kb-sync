#!/usr/bin/env node
// ==============================================================================
// Thematic Knowledge Pack Consolidator (Stage 6)
// Emits modular packs into .nlm_pack/ partitioned by research category:
// - .nlm_pack/pack_willow_run.txt      (Target: CIC - Willow Run & Aviation Engineering)
// - .nlm_pack/pack_ford_politics.txt   (Target: CIC - Ford Executive Dynamics & Politics)
// - .nlm_pack/pack_willys_overland.txt (Target: CIC - Post-War & Willys-Overland)
// - .nlm_pack/pack_master_kb.txt       (Target: CIC-KB)
// ==============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOTEBOOK_TARGETS, resolveNotebookId } from '../core/config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COLOR = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', reset: '\x1b[0m' };
const logInfo = (msg) => console.log(`${COLOR.green}[CONSOLIDATE-PACK] [INFO]${COLOR.reset} ${msg}`);
const logWarn = (msg) => console.log(`${COLOR.yellow}[CONSOLIDATE-PACK] [WARN]${COLOR.reset} ${msg}`);
const logError = (msg) => console.error(`${COLOR.red}[CONSOLIDATE-PACK] [ERROR]${COLOR.reset} ${msg}`);

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
    category: 'willys-overland',
    aliases: ['post-war', 'willys-overland'],
    filename: 'pack_willys_overland.txt',
    notebookId: NOTEBOOK_TARGETS['post-war'],
    title: 'CIC - Post-War & Willys-Overland'
  },
  {
    category: 'master-kb',
    filename: 'pack_master_kb.txt',
    notebookId: NOTEBOOK_TARGETS['master-kb'],
    title: 'CIC-KB (Master Knowledge Base)'
  }
];

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

export function consolidatePacks(options = {}) {
  const rootDir = options.rootDir || path.resolve(__dirname, '../..');
  const outDir = options.outDir || path.join(rootDir, '.nlm_pack');

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  logInfo(`Consolidating thematic packs from root: ${rootDir}`);
  logInfo(`Output directory: ${outDir}`);

  // Collect candidate files from wiki and staging
  const scanDirs = [
    path.join(rootDir, 'wiki'),
    path.join(rootDir, '_kb-sync-staging')
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
        if (entry.name !== 'node_modules' && entry.name !== '.git') {
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

  // Parse and organize files by category
  const categorized = {
    'willow-run': [],
    'ford-politics': [],
    'willys-overland': [],
    'master-kb': []
  };

  for (const filePath of candidateFiles) {
    try {
      const relPath = path.relative(rootDir, filePath).replace(/\\/g, '/');
      const content = fs.readFileSync(filePath, 'utf8');
      const fm = extractFrontmatter(content);
      const cat = (fm.category || '').toLowerCase().trim();

      const item = { relPath, filePath, content, frontmatter: fm };

      // Add to specific category bucket
      if (cat === 'willow-run') {
        categorized['willow-run'].push(item);
      } else if (cat === 'ford-politics') {
        categorized['ford-politics'].push(item);
      } else if (cat === 'willys-overland' || cat === 'post-war') {
        categorized['willys-overland'].push(item);
      }

      // Master KB includes all valid notes
      categorized['master-kb'].push(item);
    } catch (err) {
      logWarn(`Could not read ${filePath}: ${err.message}`);
    }
  }

  const generatedPacks = [];

  for (const packDef of THEMATIC_PACK_MAP) {
    const packFile = path.join(outDir, packDef.filename);
    const items = categorized[packDef.category] || [];

    let payload = `================================================================================\n`;
    payload += `THEMATIC KNOWLEDGE PACK: ${packDef.title}\n`;
    payload += `CATEGORY: ${packDef.category}\n`;
    payload += `TARGET NOTEBOOK: ${packDef.notebookId}\n`;
    payload += `COMPILED AT: ${new Date().toISOString()}\n`;
    payload += `FILE COUNT: ${items.length}\n`;
    payload += `================================================================================\n\n`;

    for (const item of items) {
      payload += `--- START FILE: ${item.relPath} ---\n`;
      if (item.frontmatter.source_title) {
        payload += `PROVENANCE SOURCE: ${item.frontmatter.source_title}\n`;
        payload += `REPOSITORY: ${item.frontmatter.repository || 'N/A'}\n`;
        payload += `DOCUMENT DATE: ${item.frontmatter.document_date || 'N/A'}\n`;
        payload += `VERIFICATION STATUS: ${item.frontmatter.verification_status || 'N/A'}\n`;
      }
      payload += `\n${item.content}\n`;
      payload += `--- END FILE: ${item.relPath} ---\n\n`;
    }

    fs.writeFileSync(packFile, payload, 'utf8');
    const bytes = fs.statSync(packFile).size;
    const mb = bytes / (1024 * 1024);

    if (mb > 5.0) {
      logWarn(`Pack ${packDef.filename} (${mb.toFixed(2)} MB) exceeds 5.0 MB warning limit!`);
    } else {
      logInfo(`✓ Emitted ${packDef.filename} (${(bytes / 1024).toFixed(2)} KB, ${items.length} files) -> Target: ${packDef.notebookId}`);
    }

    generatedPacks.push({
      packDef,
      packFile,
      bytes,
      fileCount: items.length
    });
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
