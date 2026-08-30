import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { resolveVaultPaths } from './config-loader.mjs';

export const DETERMINISTIC_RULES = new Set([
  'normalized_category',
  'normalized_status',
  'rewrote_wikilinks'
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
        trimmed.includes('.drift-report.json')
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
  
  let content = fileContent;
  let frontmatter = {};
  let body = fileContent;

  const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const match = fileContent.match(fmRegex);
  
  if (match) {
    body = match[2];
    const fmText = match[1];
    fmText.split(/\r?\n/).forEach(line => {
      const parts = line.split(':');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join(':').trim().replace(/^["']|["']$/g, '');
        frontmatter[key] = value;
      }
    });
  } else {
    repairs.push('injected_frontmatter');
    const parsedPath = path.parse(filePath);
    frontmatter.title = parsedPath.name;
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

  // Source Repository
  if (!frontmatter.sourceRepository) {
    frontmatter.sourceRepository = repoName;
    if (match) repairs.push('added_missing_fields');
  }

  // Wikilinks
  const codeBlockRegex = /(```[\s\S]*?```|`[^`]+`)/g;
  const blocks = [];
  let placeholderIndex = 0;
  
  let tempBody = body.replace(codeBlockRegex, (match) => {
    const placeholder = `__CODE_BLOCK_${placeholderIndex++}__`;
    blocks.push(match);
    return placeholder;
  });

  const wikilinkRegex = /\[\[([^\]|#]+)(#[^\]|]+)?(?:\|([^\]]+))?\]\]/g;
  let linksRewritten = false;

  tempBody = tempBody.replace(wikilinkRegex, (fullMatch, rawTarget, rawHash = '', rawLabel) => {
    const target = rawTarget.trim();
    // Already prefixed
    if (target.includes('/')) return fullMatch;

    let newTarget = index.get(target);
    if (!newTarget) {
      newTarget = `kb-sync/wiki/research/${target}`;
    }

    linksRewritten = true;
    const hash = rawHash || '';
    if (rawLabel !== undefined && rawLabel !== null) {
      return `[[${newTarget}${hash}|${rawLabel}]]`;
    }
    return `[[${newTarget}${hash}]]`;
  });

  if (linksRewritten) repairs.push('rewrote_wikilinks');

  // Restore code blocks
  blocks.forEach((block, i) => {
    tempBody = tempBody.replace(`__CODE_BLOCK_${i}__`, block);
  });

  // Construct final frontmatter
  let newFm = '---\n';
  for (const [k, v] of Object.entries(frontmatter)) {
    newFm += `${k}: ${v}\n`;
  }
  newFm += '---\n';

  return {
    content: newFm + tempBody,
    repairs
  };
}

export async function sweepStagingVault(options = {}) {
  const {
    vaultRoot,
    targetDir,
    fix = false,
    dryRun = false,
    verbose = false,
    index: customIndex,
    allowDirty = false,
    allowSemantic = true
  } = options;
  const rawArgs = vaultRoot ? [`--vault-root=${vaultRoot}`] : process.argv;
  const paths = resolveVaultPaths(rawArgs);
  const root = paths.vaultRoot || process.cwd();

  const now = new Date();
  const timestamp = now.toISOString();

  // Guard against dirty worktree if mutating
  if (fix && !dryRun && !allowDirty) {
    const worktree = checkWorktreeCleanliness(root);
    if (!worktree.isClean) {
      const blockedReport = {
        timestamp,
        status: 'BLOCKED',
        reason: `Dirty working tree detected with ${worktree.dirtyCount} uncommitted/untracked path(s). Operator receipt required or specify --allow-dirty.`,
        dirtyPaths: worktree.dirtyPaths.slice(0, 20),
        filesScanned: 0,
        filesHealed: 0,
        deterministicRepairsCount: 0,
        semanticRepairsCount: 0,
        repairs: [],
        manifestEntries: []
      };
      const manifestPath = path.join(root, '.repair-manifest.json');
      await fs.writeFile(manifestPath, JSON.stringify(blockedReport, null, 2), 'utf-8');
      const receiptPath = path.join(root, '.autoheal-receipt.json');
      await fs.writeFile(receiptPath, JSON.stringify(blockedReport, null, 2), 'utf-8');
      return blockedReport;
    }
  }

  const report = {
    timestamp,
    status: 'NO_DRIFT',
    filesScanned: 0,
    filesHealed: 0,
    deterministicRepairsCount: 0,
    semanticRepairsCount: 0,
    repairs: [],
    manifestEntries: []
  };

  let index = customIndex || new Map();
  
  // If no custom index, build index from existing wiki notes
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

  async function walk(dir) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const isDir = typeof entry.isDirectory === 'function' ? entry.isDirectory() : false;
        if (isDir) {
          await walk(fullPath);
        } else if (entry.name && entry.name.endsWith('.md')) {
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

  await walk(scanRoot);

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
    manifestEntries: report.manifestEntries
  };

  const reportPath = path.join(paths.vaultRoot, '.autoheal-report.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');

  const manifestPath = path.join(paths.vaultRoot, '.repair-manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  const receiptPath = path.join(paths.vaultRoot, '.autoheal-receipt.json');
  await fs.writeFile(receiptPath, JSON.stringify(manifest, null, 2), 'utf-8');

  return report;
}

// CLI Support
if (process.argv[1] && process.argv[1].endsWith('autoheal-sweeper.mjs')) {
  const args = process.argv.slice(2);
  const options = {
    fix: false,
    dryRun: true,
    verbose: false,
    vaultRoot: null,
    targetDir: null,
    allowDirty: false,
    allowSemantic: true
  };
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--fix') options.fix = true;
    else if (args[i] === '--dry-run') options.dryRun = true;
    else if (args[i] === '--verbose') options.verbose = true;
    else if (args[i] === '--allow-dirty') options.allowDirty = true;
    else if (args[i] === '--no-semantic') options.allowSemantic = false;
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
  
  sweepStagingVault(options).then(report => {
    if (options.verbose || !options.fix) console.log(JSON.stringify(report, null, 2));
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
