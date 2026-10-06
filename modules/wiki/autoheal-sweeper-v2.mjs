import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { resolveVaultPaths } from './config-loader.mjs';
import { VikingVFSMount } from './viking-vfs-mount-v4.mjs';

export const DETERMINISTIC_RULES = new Set([
  'normalized_category',
  'normalized_status',
  'rewrote_wikilinks',
  'cleaned_hygiene'
]);

export const SEMANTIC_RULES = new Set([
  'injected_frontmatter',
  'added_missing_fields'
]);

export function validateTimestamp(timestamp, maxSkewMs = 60000) {
  if (!timestamp || typeof timestamp !== 'string') return false;
  const parsed = Date.parse(timestamp);
  if (isNaN(parsed)) return false;
  if (parsed > Date.now() + maxSkewMs) return false;
  return true;
}

export function checkWorktreeCleanliness(repoRoot) {
  try {
    const status = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
    const lines = status.split(/\r?\n/).filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (
        trimmed.includes('_kb-sync-staging') ||
        trimmed.includes('.repair-manifest.json') ||
        trimmed.includes('.autoheal-report.json') ||
        trimmed.includes('.autoheal-receipt.json') ||
        trimmed.includes('.drift-report.json') ||
        trimmed.includes('.abstract') ||
        trimmed.includes('.overview')
      ) {
        return false;
      }
      return true;
    });
    return {
      isClean: lines.length === 0,
      dirtyCount: lines.length,
      dirtyPaths: lines
    };
  } catch {
    return { isClean: true, dirtyCount: 0, dirtyPaths: [] };
  }
}

function slugify(text) {
  return text.toLowerCase().replace(/\s+/g, '-');
}

export function resolveWikiTarget(target, index) {
  if (!target || !index || typeof index.get !== 'function') return null;
  const hit = index.get(target);
  if (!hit) return null;
  const unique = [...new Set(
    (Array.isArray(hit) ? hit : [hit])
      .map((p) => String(p).replace(/\\/g, '/'))
      .filter(Boolean)
  )];
  if (unique.length === 1) {
    return unique[0].replace(/\.md$/i, '');
  }
  const slug = target.toLowerCase().replace(/\.md$/i, '');
  const conceptHits = unique.filter((p) => {
    const n = p.toLowerCase().replace(/\.md$/i, '');
    return n === `concepts/${slug}` || n.endsWith(`/concepts/${slug}`);
  });
  if (conceptHits.length === 1) {
    return conceptHits[0].replace(/\.md$/i, '');
  }
  return null;
}

function normalizeStatus(status) {
  if (!status) return 'draft';
  const s = status.toLowerCase();
  if (s === 'wip') return 'draft';
  if (s === 'review') return 'proposed';
  return s;
}

export async function autohealMetadata(filePath, fileContent, options = {}) {
  const { repoName = 'kb-sync', index = new Map() } = options;
  const repairs = [];
  const eol = fileContent.includes('\r\n') ? '\r\n' : '\n';
  
  let content = fileContent;
  let frontmatter = {};
  let body = fileContent;

  const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const match = fileContent.match(fmRegex);
  
  if (match) {
    body = match[2];
    for (const line of match[1].split(/\r?\n/)) {
      const idx = line.indexOf(':');
      if (idx > 0) {
        frontmatter[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      }
    }
  } else {
    repairs.push('injected_frontmatter');
    frontmatter.title = path.parse(filePath).name;
  }

  // Title Inference & Backfill
  if (!frontmatter.title) {
    if (frontmatter.source_title) {
      frontmatter.title = frontmatter.source_title;
    } else {
      const headingMatch = body.match(/^#\s+(.+)$/m);
      if (headingMatch) {
        let clean = headingMatch[1].trim().replace(/^`|`$/g, '').replace(/\[\[(?:.*\|)?(.*?)\]\]/g, '$1');
        frontmatter.title = clean.includes('/') ? path.basename(clean) : clean;
      } else {
        frontmatter.title = path.parse(filePath).name;
      }
    }
    if (match) repairs.push('added_missing_fields');
  }

  // Category
  if (!frontmatter.category) {
    if (filePath.includes('research')) {
      frontmatter.category = 'research';
    } else {
      frontmatter.category = 'wiki';
    }
    if (match) repairs.push('added_missing_fields');
  } else {
    const origCategory = frontmatter.category;
    frontmatter.category = slugify(origCategory);
    if (origCategory !== frontmatter.category) repairs.push('normalized_category');
  }

  // Status
  if (!frontmatter.status) {
    frontmatter.status = 'draft';
    if (match) repairs.push('added_missing_fields');
  } else {
    const origStatus = frontmatter.status;
    frontmatter.status = normalizeStatus(origStatus);
    if (origStatus !== frontmatter.status) repairs.push('normalized_status');
  }

  // Trailing whitespace and empty link hygiene
  const cleanedBody = body
    .replace(/[ \t]+$/gm, '')
    .replace(/\[\[\s*\]\]/g, '');
  if (cleanedBody !== body) {
    repairs.push('cleaned_hygiene');
    body = cleanedBody;
  }

  // Wikilink rewriting
  const wikilinkRegex = /\[\[(.*?)\]\]/g;
  let wikilinkRepaired = false;
  const newBody = body.replace(wikilinkRegex, (m, rawInner) => {
    const inner = rawInner.trim();
    if (!inner) return m;

    let target = inner;
    let label = null;
    const pipeIdx = inner.indexOf('|');
    if (pipeIdx >= 0) {
      target = inner.slice(0, pipeIdx).trim();
      label = inner.slice(pipeIdx + 1).trim();
    }

    if (target.startsWith('#')) return m;

    const resolved = resolveWikiTarget(target, index);
    if (resolved && resolved !== target) {
      wikilinkRepaired = true;
      return label ? `[[${resolved}|${label}]]` : `[[${resolved}]]`;
    }
    return m;
  });

  if (wikilinkRepaired) {
    repairs.push('rewrote_wikilinks');
    body = newBody;
  }

  // Reassemble YAML Frontmatter
  const fmKeys = Object.keys(frontmatter);
  const formattedFm = fmKeys.map(k => `${k}: ${frontmatter[k]}`).join(eol);
  content = `---${eol}${formattedFm}${eol}---${eol}${body}`;

  return {
    content,
    repairs,
    frontmatter
  };
}

export async function sweepStagingVault(options = {}) {
  const {
    fix = false,
    dryRun = true,
    verbose = false,
    vaultRoot = null,
    targetDir = null,
    allowDirty = false,
    allowSemantic = true,
    compileVFS = true,
    index: customIndex = null
  } = options;

  const paths = resolveVaultPaths(vaultRoot ? [`--vault-root=${vaultRoot}`] : process.argv);
  const repoRoot = paths.repoRoot || vaultRoot || process.cwd();

  if (!allowDirty) {
    const cleanCheck = checkWorktreeCleanliness(repoRoot);
    if (!cleanCheck.isClean) {
      throw new Error(`Worktree is dirty (${cleanCheck.dirtyCount} modified files). Stash or commit before running autoheal.`);
    }
  }

  const report = {
    timestamp: new Date().toISOString(),
    status: 'NO_DRIFT',
    filesScanned: 0,
    filesHealed: 0,
    deterministicRepairsCount: 0,
    semanticRepairsCount: 0,
    repairs: [],
    manifestEntries: [],
    vfsTiersCompiled: []
  };

  let index = customIndex || new Map();
  
  if (index.size === 0 && paths.wikiDir) {
    try {
      async function indexDir(dir, prefix) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          const isDir = typeof entry.isDirectory === 'function' ? entry.isDirectory() : false;
          if (isDir) {
            await indexDir(full, `${prefix}/${entry.name}`);
          } else if (entry.name && entry.name.endsWith('.md')) {
            const base = path.parse(entry.name).name;
            index.set(base, `${prefix}/${base}`);
          }
        }
      }
      await indexDir(paths.wikiDir, 'kb-sync/wiki');
    } catch (err) {
      if (verbose) console.warn('Could not index wikiDir:', err.message);
    }
  }

  let scanRoot = targetDir;
  if (!scanRoot) {
    try {
      await fs.stat(paths.stagingDir);
      scanRoot = paths.stagingDir;
    } catch {
      scanRoot = paths.wikiDir;
    }
  }

  const dirsWithMarkdown = new Set();

  async function walk(dir) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const isDir = typeof entry.isDirectory === 'function' ? entry.isDirectory() : false;
        if (isDir) {
          await walk(fullPath);
        } else if (entry.name && entry.name.endsWith('.md') && !entry.name.startsWith('.')) {
          dirsWithMarkdown.add(dir);
          report.filesScanned++;
          const content = await fs.readFile(fullPath, 'utf-8');
          const relPath = path.relative(scanRoot, fullPath);
          const result = await autohealMetadata(fullPath, content, { index });
          
          if (result.repairs.length > 0) {
            const deterministic = result.repairs.filter(r => DETERMINISTIC_RULES.has(r));
            const semantic = result.repairs.filter(r => SEMANTIC_RULES.has(r));

            report.deterministicRepairsCount += deterministic.length;
            report.semanticRepairsCount += semantic.length;
            report.filesHealed++;
            report.repairs.push({ file: relPath || fullPath, fixes: result.repairs });

            const beforeSha256 = crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
            let afterSha256 = beforeSha256;

            if (fix && !dryRun) {
              await fs.writeFile(fullPath, result.content, 'utf-8');
              afterSha256 = crypto.createHash('sha256').update(result.content, 'utf-8').digest('hex');
            }

            report.manifestEntries.push({
              file: relPath || fullPath,
              beforeSha256,
              afterSha256,
              deterministicRules: deterministic,
              semanticRules: semantic,
              status: (fix && !dryRun) ? 'APPLIED' : 'PROPOSED'
            });
          }
        }
      }
    } catch (e) {
      if (verbose) console.error('Walk error:', e.message);
    }
  }

  if (scanRoot) {
    await walk(scanRoot);
  }

  // Viking VFS Tiered Context Compilation Pass
  if (compileVFS && (fix || !dryRun || dirsWithMarkdown.size > 0)) {
    const vfsMount = new VikingVFSMount(repoRoot);
    for (const dir of dirsWithMarkdown) {
      try {
        const relativeDir = path.relative(repoRoot, dir);
        if (fix && !dryRun) {
          const vfsResult = vfsMount.compileTieredSummaries(relativeDir);
          report.vfsTiersCompiled.push({
            dir: relativeDir.replace(/\\/g, '/'),
            abstractTokens: vfsResult.abstractTokens,
            overviewTokens: vfsResult.overviewTokens,
            noteCount: vfsResult.noteCount
          });
        }
      } catch (err) {
        if (verbose) console.warn(`VFS compilation skipped for ${dir}:`, err.message);
      }
    }
  }

  if (report.filesHealed > 0) {
    if (fix && !dryRun) {
      if (report.semanticRepairsCount > 0 && !allowSemantic) {
        report.status = 'PARTIAL';
      } else {
        report.status = 'APPLIED';
      }
    } else {
      report.status = 'PARTIAL';
    }
  } else {
    report.status = 'NO_DRIFT';
  }

  const manifest = {
    timestamp: report.timestamp,
    status: report.status,
    totalFilesScanned: report.filesScanned,
    totalFilesHealed: report.filesHealed,
    deterministicRepairsCount: report.deterministicRepairsCount,
    semanticRepairsCount: report.semanticRepairsCount,
    manifestEntries: report.manifestEntries,
    vfsTiersCompiled: report.vfsTiersCompiled
  };

  const reportJson = JSON.stringify(report, null, 2);
  const reportPath = path.join(paths.vaultRoot, '.autoheal-report.json');
  await fs.writeFile(reportPath, reportJson, 'utf-8');
  const cwdReportPath = path.join(process.cwd(), '.autoheal-report.json');
  if (path.resolve(reportPath) !== path.resolve(cwdReportPath)) {
    await fs.writeFile(cwdReportPath, reportJson, 'utf-8');
  }

  const manifestPath = path.join(paths.vaultRoot, '.repair-manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  const receiptPath = path.join(paths.vaultRoot, '.autoheal-receipt.json');
  await fs.writeFile(receiptPath, JSON.stringify(manifest, null, 2), 'utf-8');

  return report;
}

// CLI Support
if (process.argv[1] && process.argv[1].endsWith('autoheal-sweeper-v2.mjs')) {
  const args = process.argv.slice(2);
  const options = {
    fix: false,
    dryRun: true,
    verbose: false,
    vaultRoot: null,
    targetDir: null,
    allowDirty: false,
    allowSemantic: true,
    compileVFS: true
  };
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--fix') {
      options.fix = true;
      options.dryRun = false;
    } else if (args[i] === '--dry-run') options.dryRun = true;
    else if (args[i] === '--verbose') options.verbose = true;
    else if (args[i] === '--allow-dirty') options.allowDirty = true;
    else if (args[i] === '--no-semantic') options.allowSemantic = false;
    else if (args[i] === '--no-vfs') options.compileVFS = false;
    else if (args[i] === '--target-dir' && args[i+1]) {
      options.targetDir = args[i+1];
      i++;
    } else if (args[i].startsWith('--target-dir=')) {
      options.targetDir = args[i].slice('--target-dir='.length);
    } else if (args[i] === '--vault-root' && args[i+1]) {
      options.vaultRoot = args[i+1];
      i++;
    } else if (args[i].startsWith('--vault-root=')) {
      options.vaultRoot = args[i].slice('--vault-root='.length);
    }
  }
  
  if (options.targetDir && !path.isAbsolute(options.targetDir)) {
    options.targetDir = path.resolve(process.cwd(), options.targetDir);
  }

  sweepStagingVault(options).then(report => {
    if (options.verbose || !options.fix) console.log(JSON.stringify(report, null, 2));
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
