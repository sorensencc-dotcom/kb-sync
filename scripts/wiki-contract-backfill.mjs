#!/usr/bin/env node
/**
 * wiki-contract-backfill.mjs
 * 
 * One-shot migration script: adds contract-compliant YAML frontmatter to all
 * wiki source files that are missing it, and rewrites relative [[WikiTitle]]
 * links to absolute [[kb-sync/path/to/file]] format.
 *
 * Safe to re-run: idempotent (skips files that already have frontmatter).
 * Usage: node scripts/wiki-contract-backfill.mjs [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const WIKI_ROOT = path.join(REPO_ROOT, 'obsidian', 'vault', 'wiki');
const DRY_RUN = process.argv.includes('--dry-run');

// ---------------------------------------------------------------------------
// Link rewrite map: relative display title -> absolute kb-sync path
// ---------------------------------------------------------------------------
const LINK_MAP = {
  // Scripts - kb-sync core
  'run-all.sh':                      'kb-sync/kb-sync/run-all.sh',
  'chunk.sh':                        'kb-sync/kb-sync/chunk.sh',
  'flatten.sh':                      'kb-sync/kb-sync/flatten.sh',
  'validate.sh':                     'kb-sync/kb-sync/validate.sh',
  'rollback.sh':                     'kb-sync/kb-sync/rollback.sh',
  'artifact-generator.sh':           'kb-sync/kb-sync/artifact-generator.sh',
  // Scripts - notebooklm
  'ingest-notebooklm.sh':           'kb-sync/notebooklm/ingest-notebooklm.sh',
  'kb-sync-nightly.sh':             'kb-sync/notebooklm/kb-sync-nightly.sh',
  'register-kb-sync-task.ps1':      'kb-sync/notebooklm/register-kb-sync-task.ps1',
  // Scripts - obsidian
  'ingest-obsidian.sh':             'kb-sync/obsidian/ingest-obsidian.sh',
  // Scripts - wiki
  'ingest-wiki.sh':                 'kb-sync/wiki/ingest-wiki.sh',
  // Concepts
  'Deterministic Sync Pipeline':    'kb-sync/concepts/deterministic-sync-pipeline',
  'Fail-Soft Orchestration':        'kb-sync/concepts/fail-soft-orchestration',
  'Karpathy LLM-Wiki Pattern':      'kb-sync/concepts/karpathy-llm-wiki-pattern',
  'Manifest Mode':                  'kb-sync/concepts/manifest-mode',
  'Pack-Based Knowledge Management':'kb-sync/concepts/pack-based-knowledge-management',
  'Raw Source Staging':             'kb-sync/concepts/raw-source-staging',
  'Semantic Ingest Workflow':       'kb-sync/concepts/semantic-ingest-workflow',
  'Three-Layer Vault Architecture': 'kb-sync/concepts/three-layer-vault-architecture',
  // Module indexes
  'kb-sync Core Module':            'kb-sync/kb-sync/index',
  'notebooklm module':              'kb-sync/notebooklm/index',
  'obsidian module':                'kb-sync/obsidian/index',
  'wiki module':                    'kb-sync/wiki/index',
  // Governance / wiki docs
  'Wiki Schema':                    'kb-sync/kb-sync/wiki-schema',
  'Wiki Operator Workflow':         'kb-sync/kb-sync/wiki-operator-workflow',
  'Wiki Lint Rules':                'kb-sync/kb-sync/wiki-lint-rules',
  'Wiki Update Rules':              'kb-sync/kb-sync/wiki-update-rules',
  'skill-approval-rules':           'kb-sync/governance/skill-approval-rules',
};

// ---------------------------------------------------------------------------
// Frontmatter assignment: infer category + status from file path/content
// ---------------------------------------------------------------------------
function inferFrontmatter(relPath, content) {
  const parts = relPath.replace(/\\/g, '/').split('/');
  const filename = parts[parts.length - 1].replace(/\.md$/, '');
  
  // Title: derive from h1 heading or filename
  const h1Match = content.match(/^#\s+(.+)$/m);
  const title = h1Match ? h1Match[1].trim() : filename;

  // Category
  let category = 'utilities';
  const topFolder = parts[0];
  if (topFolder === 'concepts') category = 'wiki';
  else if (topFolder === 'governance') category = 'wiki';
  else if (filename === 'Index' || filename === 'Log' || filename === 'index') category = 'wiki';
  else if (filename.endsWith('.sh') || filename.endsWith('.ps1')) {
    if (topFolder === 'obsidian' || topFolder === 'wiki') category = 'sync-tools';
    else category = 'utilities';
  } else if (filename.startsWith('wiki-') || filename.startsWith('ingest-')) {
    category = 'sync-tools';
  }

  // Status
  let status = 'active';
  if (content.match(/\*\*Status\*\*:\s*Archived/i) || content.match(/status:\s*archived/i)) {
    status = 'archived';
  } else if (content.match(/\*\*Status\*\*:\s*Beta/i)) {
    status = 'beta';
  }

  return { title, category, status };
}

// ---------------------------------------------------------------------------
// Rewrite relative [[links]] to absolute kb-sync/... paths
// ---------------------------------------------------------------------------
function rewriteLinks(content) {
  return content.replace(/\[\[([^\]]+)\]\]/g, (match, inner) => {
    // Already absolute if it starts with kb-sync/
    if (inner.startsWith('kb-sync/')) return match;
    
    // Strip display label to get the key
    const pipeIdx = inner.indexOf('|');
    const key = pipeIdx !== -1 ? inner.slice(0, pipeIdx).trim() : inner.trim();
    const display = pipeIdx !== -1 ? inner.slice(pipeIdx + 1).trim() : null;
    
    // Skip external links or already-absolute paths
    if (key.startsWith('http') || key.includes('://')) return match;
    // Skip governance/ folder references (invalid anyway, keep as-is for manual review)
    if (key.startsWith('governance/')) return match;
    
    const mapped = LINK_MAP[key];
    if (mapped) {
      // Use display label if present, otherwise use the original key as label
      const label = display || key;
      return `[[${mapped}|${label}]]`;
    }
    
    // Not in map — return unchanged (will still fail, but don't mask it)
    return match;
  });
}

// ---------------------------------------------------------------------------
// Process a single file
// ---------------------------------------------------------------------------
function processFile(filePath, relPath) {
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Check if frontmatter already exists
  const hasFrontmatter = content.startsWith('---\n') || content.startsWith('---\r\n');
  
  let newContent = content;
  let changed = false;
  
  // 1. Add frontmatter if missing
  if (!hasFrontmatter) {
    const fm = inferFrontmatter(relPath, content);
    const frontmatter = `---\ntitle: "${fm.title}"\ncategory: "${fm.category}"\nstatus: "${fm.status}"\n---\n\n`;
    newContent = frontmatter + newContent;
    changed = true;
    console.log(`  [FRONTMATTER] Added to: ${relPath}`);
  }
  
  // 2. Rewrite relative links
  const rewritten = rewriteLinks(newContent);
  if (rewritten !== newContent) {
    newContent = rewritten;
    changed = true;
    console.log(`  [LINKS] Rewrote links in: ${relPath}`);
  }
  
  if (changed && !DRY_RUN) {
    fs.writeFileSync(filePath, newContent, 'utf8');
  }
  
  return changed;
}

// ---------------------------------------------------------------------------
// Walk wiki directory
// ---------------------------------------------------------------------------
function walkDir(dir, relRoot = '') {
  const entries = fs.readdirSync(dir);
  let changedCount = 0;
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const relPath = relRoot ? `${relRoot}/${entry}` : entry;
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory() && entry !== '.git' && entry !== 'node_modules') {
      changedCount += walkDir(fullPath, relPath);
    } else if (entry.endsWith('.md')) {
      if (processFile(fullPath, relPath)) changedCount++;
    }
  }
  return changedCount;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
console.log(`Wiki Contract Backfill ${DRY_RUN ? '(DRY RUN)' : ''}`);
console.log(`Target: ${WIKI_ROOT}\n`);

const total = walkDir(WIKI_ROOT);
console.log(`\n${DRY_RUN ? '[DRY RUN] Would modify' : 'Modified'} ${total} file(s).`);
if (DRY_RUN) {
  console.log('Re-run without --dry-run to apply changes.');
}
