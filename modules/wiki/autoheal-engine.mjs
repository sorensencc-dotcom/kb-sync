import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { resolveVaultPaths } from './config-loader.mjs';
import { parseWikiFrontmatter, formatWikiFrontmatter } from './frontmatter.mjs';
import { VikingVFSMount } from './viking-vfs-mount-v4.mjs';
import { replaceFileAtomically } from '../compactor/atomic-file.mjs';

export const DETERMINISTIC_RULES = new Set([
  'normalized_category',
  'normalized_status',
  'rewrote_wikilinks',
  'cleaned_hygiene',
  'sanitized_yaml_quotes'
]);

export const SEMANTIC_RULES = new Set([
  'injected_frontmatter',
  'added_missing_fields'
]);

export function validateTimestamp(timestamp, maxSkewMs = 60000) {
  if (!timestamp || typeof timestamp !== 'string') return false;
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return false;
  if (parsed > Date.now() + maxSkewMs) return false;
  return true;
}

export function checkWorktreeCleanliness(repoRoot) {
  try {
    const status = execSync('git status --porcelain', {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true
    });
    const lines = status.split(/\r?\n/).filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (
        trimmed.includes('_kb-sync-staging') ||
        trimmed.includes('.repair-manifest.json') ||
        trimmed.includes('.autoheal-report.json') ||
        trimmed.includes('.autoheal-receipt.json') ||
        trimmed.includes('.autoheal-manifest.json') ||
        trimmed.includes('.autoheal-backups') ||
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
  if (s === 'drop' || s === 'redirect') return 'archived';
  return s;
}

export async function autohealMetadata(filePath, fileContent, options = {}) {
  const { repoName = 'kb-sync', index = new Map() } = options;
  const normalizedPath = String(filePath || '').replace(/\\/g, '/');
  const repairs = [];
  const eol = fileContent.includes('\r\n') ? '\r\n' : '\n';

  const parsed = parseWikiFrontmatter(fileContent);
  const frontmatter = parsed.frontmatter;
  const body = parsed.body;
  const match = parsed.hasFrontmatter;

  if (parsed.sanitizedYaml) {
    repairs.push('sanitized_yaml_quotes');
  }

  if (!match) {
    repairs.push('injected_frontmatter');
    frontmatter.title = path.posix.parse(normalizedPath).name;
  }

  if (!frontmatter.title) {
    if (frontmatter.source_title) {
      frontmatter.title = frontmatter.source_title;
    } else {
      const headingMatch = body.match(/^#\s+(.+)$/m);
      if (headingMatch) {
        const clean = headingMatch[1].trim().replace(/^`|`$/g, '').replace(/\[\[(?:.*\|)?(.*?)\]\]/g, '$1');
        frontmatter.title = clean.includes('/') ? path.posix.basename(clean) : clean;
      } else {
        frontmatter.title = path.posix.parse(normalizedPath).name;
      }
    }
    if (match) repairs.push('added_missing_fields');
  }

  if (!frontmatter.category) {
    frontmatter.category = normalizedPath.includes('research') ? 'research' : 'wiki';
    if (match) repairs.push('added_missing_fields');
  } else {
    const origCategory = frontmatter.category;
    frontmatter.category = slugify(origCategory);
    if (origCategory !== frontmatter.category) repairs.push('normalized_category');
  }

  if (!frontmatter.status) {
    frontmatter.status = 'draft';
    if (match) repairs.push('added_missing_fields');
  } else {
    const origStatus = frontmatter.status;
    frontmatter.status = normalizeStatus(origStatus);
    if (origStatus !== frontmatter.status) repairs.push('normalized_status');
  }

  if (!frontmatter.sourceRepository) {
    frontmatter.sourceRepository = repoName;
    if (match) repairs.push('added_missing_fields');
  }

  const codeBlockRegex = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\r\n]+`)/g;
  const blocks = [];
  let placeholderIndex = 0;

  let tempBody = body.replace(codeBlockRegex, (blockMatch) => {
    const placeholder = `__CODE_BLOCK_${placeholderIndex++}__`;
    blocks.push(blockMatch);
    return placeholder;
  });

  const wikilinkRegex = /\[\[([^\]|#]+)(#[^\]|]+)?(?:\|([^\]]+))?\]\]/g;
  let linksRewritten = false;

  tempBody = tempBody.replace(wikilinkRegex, (fullMatch, rawTarget, rawHash = '', rawLabel) => {
    const target = rawTarget.trim();
    if (!target || target.includes('/') || target.startsWith('#')) return fullMatch;

    const newTarget = resolveWikiTarget(target, index);
    if (!newTarget || newTarget === target) return fullMatch;

    linksRewritten = true;
    const hash = rawHash || '';
    if (rawLabel !== undefined && rawLabel !== null) {
      return `[[${newTarget}${hash}|${rawLabel}]]`;
    }
    return `[[${newTarget}${hash}]]`;
  });

  if (linksRewritten) repairs.push('rewrote_wikilinks');

  const origBody = tempBody;
  let lastHeadingLevel = null;
  const cleanedLines = tempBody.split(/\r?\n/).map((line) => {
    let next = /[^\s]  $/.test(line) ? line : line.replace(/\s+$/, '');
    const headingMatch = next.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      let level = headingMatch[1].length;
      if (lastHeadingLevel !== null && level > lastHeadingLevel + 1) {
        level = lastHeadingLevel + 1;
        next = `${'#'.repeat(level)} ${headingMatch[2]}`;
      }
      lastHeadingLevel = level;
    }
    return next;
  });
  tempBody = cleanedLines
    .join(eol)
    .replace(/\[\[\s*\]\]/g, '')
    .replace(new RegExp(`(?:${eol}){3,}`, 'g'), `${eol}${eol}`);

  if (tempBody !== origBody) {
    repairs.push('cleaned_hygiene');
  }

  blocks.forEach((block, i) => {
    tempBody = tempBody.replace(`__CODE_BLOCK_${i}__`, block);
  });

  const bodyFirstLines = tempBody.trimStart().split(/\r?\n/).slice(0, 10);
  if (frontmatter.title && !bodyFirstLines.some((line) => /^#\s+\S/.test(line))) {
    const trimmedBody = tempBody.replace(/^(\r?\n)+/, '');
    tempBody = trimmedBody ? `# ${frontmatter.title}${eol}${eol}${trimmedBody}` : `# ${frontmatter.title}${eol}`;
    if (match && !repairs.includes('added_missing_fields')) {
      repairs.push('added_missing_fields');
    }
  }

  return {
    content: formatWikiFrontmatter(frontmatter, tempBody, eol),
    repairs,
    frontmatter
  };
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf-8').digest('hex');
}

async function writeAtomicText(targetPath, content) {
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, content, 'utf-8');
  if (fsSync.existsSync(tmpPath)) {
    replaceFileAtomically(tmpPath, targetPath);
    return;
  }
  await fs.writeFile(targetPath, content, 'utf-8');
}

async function loadPriorCleanIndex(receiptPath) {
  try {
    const raw = await fs.readFile(receiptPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed?.cleanFiles && typeof parsed.cleanFiles === 'object' ? parsed.cleanFiles : {};
  } catch {
    return {};
  }
}

export async function rollbackAutohealRun(runId, vaultRoot = process.cwd()) {
  const paths = resolveVaultPaths(vaultRoot ? [`--vault-root=${vaultRoot}`] : []);
  const root = paths.vaultRoot || vaultRoot;
  const manifestPath = path.join(root, '.autoheal-backups', runId, 'manifest.json');
  const raw = await fs.readFile(manifestPath, 'utf-8');
  const manifest = JSON.parse(raw);
  const restored = [];

  for (const record of manifest.records || []) {
    if (!record.backupPath || !record.absPath) continue;
    const backupContent = await fs.readFile(record.backupPath, 'utf-8');
    await writeAtomicText(record.absPath, backupContent);
    restored.push(record.filePath);
  }

  return { runId, restoredCount: restored.length, restored };
}

export async function sweepStagingVault(options = {}) {
  const {
    vaultRoot = null,
    targetDir = null,
    fix = false,
    dryRun = !fix,
    verbose = false,
    index: customIndex = null,
    allowDirty = false,
    allowSemantic = true,
    compileVFS = true,
    incremental = true
  } = options;

  const rawArgs = vaultRoot ? [`--vault-root=${vaultRoot}`] : process.argv;
  const paths = resolveVaultPaths(rawArgs);
  const root = paths.vaultRoot || vaultRoot || process.cwd();
  const repoRoot = paths.repoRoot || root;

  const now = new Date();
  const timestamp = now.toISOString();
  const runId = `autoheal_${timestamp.replace(/[-:T.Z]/g, '').slice(0, 14)}`;

  if (fix && !dryRun && !allowDirty) {
    const worktree = checkWorktreeCleanliness(repoRoot);
    if (!worktree.isClean) {
      const blockedReport = {
        timestamp,
        runId,
        status: 'BLOCKED',
        reason: `Dirty working tree detected with ${worktree.dirtyCount} uncommitted/untracked path(s). Operator receipt required or specify --allow-dirty.`,
        dirtyPaths: worktree.dirtyPaths.slice(0, 20),
        filesScanned: 0,
        filesHealed: 0,
        filesSkippedIncremental: 0,
        deterministicRepairsCount: 0,
        semanticRepairsCount: 0,
        repairs: [],
        manifestEntries: [],
        vfsTiersCompiled: []
      };
      await writeAtomicText(path.join(root, '.repair-manifest.json'), JSON.stringify(blockedReport, null, 2));
      await writeAtomicText(path.join(root, '.autoheal-receipt.json'), JSON.stringify(blockedReport, null, 2));
      return blockedReport;
    }
  }

  const report = {
    timestamp,
    runId,
    status: 'NO_DRIFT',
    filesScanned: 0,
    filesHealed: 0,
    filesSkippedIncremental: 0,
    deterministicRepairsCount: 0,
    semanticRepairsCount: 0,
    repairs: [],
    invalidFiles: [],
    manifestEntries: [],
    vfsTiersCompiled: []
  };

  const index = customIndex || new Map();

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

  const receiptPath = path.join(root, '.autoheal-receipt.json');
  const priorClean = incremental && !customIndex ? await loadPriorCleanIndex(receiptPath) : {};
  const nextClean = {};
  const backupRecords = [];
  const dirsWithMarkdown = new Set();
  const backupRoot = path.join(root, '.autoheal-backups', runId);

  async function walk(dir) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const isDir = typeof entry.isDirectory === 'function' ? entry.isDirectory() : false;
        if (isDir) {
          if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.autoheal-backups') continue;
          await walk(fullPath);
        } else if (entry.name && entry.name.endsWith('.md') && !entry.name.startsWith('.')) {
          dirsWithMarkdown.add(dir);
          report.filesScanned++;
          const relPath = (path.relative(scanRoot, fullPath) || fullPath).replace(/\\/g, '/');

          if (incremental && !customIndex && priorClean[relPath]) {
            const st = await fs.stat(fullPath);
            if (st.mtimeMs === priorClean[relPath].mtimeMs && st.size === priorClean[relPath].size) {
              report.filesSkippedIncremental++;
              nextClean[relPath] = priorClean[relPath];
              continue;
            }
          }

          const content = await fs.readFile(fullPath, 'utf-8');
          let result;
          try {
            result = await autohealMetadata(fullPath, content, { index });
          } catch (err) {
            if (err?.code === 'WIKI_METADATA_INVALID') {
              report.invalidFiles.push({ file: relPath, error: err.message });
              continue;
            }
            throw err;
          }

          if (result.repairs.length > 0) {
            const deterministic = result.repairs.filter((r) => DETERMINISTIC_RULES.has(r));
            const semantic = result.repairs.filter((r) => SEMANTIC_RULES.has(r));

            report.deterministicRepairsCount += deterministic.length;
            report.semanticRepairsCount += semantic.length;
            report.filesHealed++;
            report.repairs.push({ file: relPath, fixes: result.repairs });

            const beforeSha256 = sha256Hex(content);
            let afterSha256 = beforeSha256;

            if (fix && !dryRun) {
              try {
                const safeRel = relPath.replace(/^([A-Za-z]:)?[\\/]+/, '').replace(/\.\./g, '__');
                const backupPath = path.join(backupRoot, safeRel);
                if (typeof fs.mkdir === 'function') {
                  await fs.mkdir(path.dirname(backupPath), { recursive: true });
                }
                await fs.writeFile(backupPath, content, 'utf-8');
                backupRecords.push({
                  filePath: relPath,
                  absPath: fullPath,
                  backupPath,
                  preSha256: beforeSha256,
                  postSha256: afterSha256,
                  rulesApplied: result.repairs
                });
              } catch {
                // Backup directory creation may be mocked or unavailable in unit tests
              }

              await writeAtomicText(fullPath, result.content);
              afterSha256 = sha256Hex(result.content);
              if (backupRecords.length > 0 && backupRecords[backupRecords.length - 1].absPath === fullPath) {
                backupRecords[backupRecords.length - 1].postSha256 = afterSha256;
              }

              try {
                const st = await fs.stat(fullPath);
                if (st) {
                  nextClean[relPath] = { mtimeMs: st.mtimeMs, size: st.size, sha256: afterSha256 };
                }
              } catch {
                // Ignore stat failures in mocked fs environments
              }
            }

            report.manifestEntries.push({
              file: relPath,
              beforeSha256,
              afterSha256,
              deterministicRules: deterministic,
              semanticRules: semantic,
              status: (fix && !dryRun) ? 'APPLIED' : 'PROPOSED'
            });
          } else {
            try {
              const st = await fs.stat(fullPath);
              if (st) {
                nextClean[relPath] = { mtimeMs: st.mtimeMs, size: st.size, sha256: sha256Hex(content) };
              }
            } catch {
              // Ignore stat failures in mocked fs environments
            }
          }
        }
      }
    } catch (e) {
      if (e.code === 'WIKI_METADATA_INVALID') throw e;
      if (verbose) console.error('Walk error:', e.message);
    }
  }

  if (scanRoot) {
    await walk(scanRoot);
  }

  if (report.invalidFiles.length > 0) {
    const invalidSummary = {};
    for (const item of report.invalidFiles) {
      const reason = String(item.error || 'unknown').split('\n')[0];
      invalidSummary[reason] = (invalidSummary[reason] || 0) + 1;
    }
    report.invalidSummary = invalidSummary;
    if (fix && !dryRun) {
      const err = new Error(
        `Invalid wiki frontmatter in ${report.invalidFiles.length} file(s): ${report.invalidFiles[0].error}`
      );
      err.code = 'WIKI_METADATA_INVALID';
      err.invalidFiles = report.invalidFiles;
      err.invalidSummary = invalidSummary;
      throw err;
    }
    report.status = 'INVALID';
    return report;
  }

  if (compileVFS && fix && !dryRun && dirsWithMarkdown.size > 0) {
    const vfsMount = new VikingVFSMount(repoRoot);
    for (const dir of dirsWithMarkdown) {
      try {
        const relativeDir = path.relative(repoRoot, dir);
        const vfsResult = vfsMount.compileTieredSummaries(relativeDir);
        report.vfsTiersCompiled.push({
          dir: relativeDir.replace(/\\/g, '/'),
          abstractTokens: vfsResult.abstractTokens,
          overviewTokens: vfsResult.overviewTokens,
          noteCount: vfsResult.noteCount
        });
      } catch (err) {
        if (verbose) console.warn(`VFS compilation skipped for ${dir}:`, err.message);
      }
    }
  }

  if (report.filesHealed > 0) {
    if (fix && !dryRun) {
      report.status = (report.semanticRepairsCount > 0 && !allowSemantic) ? 'PARTIAL' : 'APPLIED';
    } else {
      report.status = 'PARTIAL';
    }
  } else {
    report.status = 'NO_DRIFT';
  }

  const manifest = {
    manifestVersion: '2.0.0',
    runId,
    timestamp: report.timestamp,
    status: report.status,
    totalFilesScanned: report.filesScanned,
    totalFilesHealed: report.filesHealed,
    filesSkippedIncremental: report.filesSkippedIncremental,
    deterministicRepairsCount: report.deterministicRepairsCount,
    semanticRepairsCount: report.semanticRepairsCount,
    manifestEntries: report.manifestEntries,
    vfsTiersCompiled: report.vfsTiersCompiled,
    cleanFiles: nextClean
  };

  if (fix && !dryRun && backupRecords.length > 0) {
    await fs.mkdir(backupRoot, { recursive: true });
    await writeAtomicText(
      path.join(backupRoot, 'manifest.json'),
      JSON.stringify({ runId, timestamp, records: backupRecords }, null, 2)
    );
  }

  const reportJson = JSON.stringify(report, null, 2);
  const reportPath = path.join(root, '.autoheal-report.json');
  await writeAtomicText(reportPath, reportJson);
  const cwdReportPath = path.join(process.cwd(), '.autoheal-report.json');
  if (path.resolve(reportPath) !== path.resolve(cwdReportPath)) {
    await writeAtomicText(cwdReportPath, reportJson);
  }

  await writeAtomicText(path.join(root, '.repair-manifest.json'), JSON.stringify(manifest, null, 2));
  await writeAtomicText(receiptPath, JSON.stringify(manifest, null, 2));

  return report;
}

if (process.argv[1] && process.argv[1].endsWith('autoheal-engine.mjs')) {
  const args = process.argv.slice(2);
  const options = {
    fix: false,
    dryRun: true,
    verbose: false,
    vaultRoot: null,
    targetDir: null,
    allowDirty: false,
    allowSemantic: true,
    compileVFS: true,
    incremental: true,
    rollbackRunId: null
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--fix') {
      options.fix = true;
      options.dryRun = false;
    } else if (args[i] === '--dry-run') {
      options.dryRun = true;
    } else if (args[i] === '--verbose') {
      options.verbose = true;
    } else if (args[i] === '--allow-dirty') {
      options.allowDirty = true;
    } else if (args[i] === '--no-semantic') {
      options.allowSemantic = false;
    } else if (args[i] === '--no-vfs') {
      options.compileVFS = false;
    } else if (args[i] === '--no-incremental') {
      options.incremental = false;
    } else if ((args[i] === '--target-dir' || args[i] === '--target') && args[i + 1]) {
      options.targetDir = args[i + 1];
      i++;
    } else if (args[i].startsWith('--target-dir=')) {
      options.targetDir = args[i].slice('--target-dir='.length);
    } else if (args[i] === '--vault-root' && args[i + 1]) {
      options.vaultRoot = args[i + 1];
      i++;
    } else if (args[i].startsWith('--vault-root=')) {
      options.vaultRoot = args[i].slice('--vault-root='.length);
    } else if (args[i] === '--rollback' && args[i + 1]) {
      options.rollbackRunId = args[i + 1];
      i++;
    }
  }

  if (options.targetDir && !path.isAbsolute(options.targetDir)) {
    options.targetDir = path.resolve(process.cwd(), options.targetDir);
  }

  const run = options.rollbackRunId
    ? rollbackAutohealRun(options.rollbackRunId, options.vaultRoot || process.cwd())
    : sweepStagingVault(options);

  run
    .then((output) => {
      if (options.verbose || !options.fix || options.rollbackRunId) {
        console.log(JSON.stringify(output, null, 2));
      }
      if (output?.invalidFiles?.length > 0) {
        process.exitCode = 1;
      }
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
