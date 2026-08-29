import fs from 'fs/promises';
import path from 'path';
import { resolveVaultPaths } from './config-loader.mjs';

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

  const fmRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = fileContent.match(fmRegex);
  
  if (match) {
    body = match[2];
    const fmText = match[1];
    fmText.split('\n').forEach(line => {
      const parts = line.split(':');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join(':').trim();
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

  const wikilinkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let linksRewritten = false;

  tempBody = tempBody.replace(wikilinkRegex, (fullMatch, target, label) => {
    // Already prefixed
    if (target.includes('/')) return fullMatch;

    let newTarget = index.get(target);
    if (!newTarget) {
      newTarget = `kb-sync/wiki/research/${target}`;
    }

    linksRewritten = true;
    if (label) {
      return `[[${newTarget}|${label}]]`;
    }
    return `[[${newTarget}]]`;
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
  const { vaultRoot, fix = false, dryRun = true, verbose = false } = options;
  const paths = await resolveVaultPaths(vaultRoot);
  
  const report = {
    filesScanned: 0,
    filesHealed: 0,
    repairs: []
  };

  let index = new Map();
  try {
    const manifestContent = await fs.readFile(paths.manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestContent);
    if (manifest.index) {
      for (const [k, v] of Object.entries(manifest.index)) {
        index.set(k, v);
      }
    }
  } catch (err) {
    if (verbose) console.warn('Could not load manifest:', err.message);
  }

  async function walk(dir) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.name.endsWith('.md')) {
          report.filesScanned++;
          const content = await fs.readFile(fullPath, 'utf-8');
          const relPath = path.relative(paths.stagingRoot, fullPath);
          const result = await autohealMetadata(relPath, content, { index });
          
          if (result.repairs.length > 0) {
            report.filesHealed++;
            report.repairs.push({ file: relPath, fixes: result.repairs });
            
            if (fix && !dryRun) {
              await fs.writeFile(fullPath, result.content, 'utf-8');
            }
          }
        }
      }
    } catch (e) {
      if (verbose) console.error('Walk error:', e.message);
    }
  }

  await walk(paths.stagingRoot || vaultRoot || '.');

  await fs.writeFile('.autoheal-report.json', JSON.stringify(report, null, 2), 'utf-8');
  return report;
}

// CLI Support
if (process.argv[1] && process.argv[1] === new URL(import.meta.url).pathname) {
  const args = process.argv.slice(2);
  const options = { fix: false, dryRun: true, verbose: false, vaultRoot: null };
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--fix') options.fix = true;
    else if (args[i] === '--dry-run') options.dryRun = true;
    else if (args[i] === '--verbose') options.verbose = true;
    else if (args[i] === '--vault-root' && args[i+1]) {
      options.vaultRoot = args[i+1];
      i++;
    }
  }
  
  sweepStagingVault(options).then(report => {
    if (options.verbose) console.log(JSON.stringify(report, null, 2));
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
