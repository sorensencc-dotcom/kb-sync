import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import yaml from 'js-yaml';

/**
 * Loads configurations from configs/obsidian.yaml, with robust defaults.
 * @param {string} repoRoot 
 * @returns {object}
 */
export function loadObsidianConfig(repoRoot) {
  const configPath = path.join(repoRoot, 'configs', 'obsidian.yaml');
  const defaults = {
    vault_root: '.',
    wiki_dir: 'wiki',
    mapping_rules: [
      { prefix: 'core/', folder: 'kb-sync/utilities' },
      { prefix: 'scripts/', folder: 'kb-sync/utilities' },
      { prefix: 'modules/wiki/', folder: 'entities' },
      { prefix: 'modules/obsidian/', folder: 'entities' },
      { prefix: 'modules/notebooklm/', folder: 'entities' }
    ]
  };

  if (!fs.existsSync(configPath)) {
    return defaults;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = yaml.load(raw) || {};
    
    // Normalize properties
    return {
      vault_root: parsed.vault_root || defaults.vault_root,
      wiki_dir: parsed.wiki_dir || defaults.wiki_dir,
      mapping_rules: Array.isArray(parsed.mapping_rules) ? parsed.mapping_rules : defaults.mapping_rules
    };
  } catch (_) {
    return defaults;
  }
}

/**
 * Maps a source repository file path to its corresponding wiki sibling path.
 * @param {string} sourceFile - Relative path of the source file (e.g., 'core/run-all.sh')
 * @param {object} obsidianConfig - Normalized configuration from loadObsidianConfig
 * @returns {string|null} - Sibling relative wiki file path (e.g., 'wiki/kb-sync/utilities/RunAll.md')
 */
export function mapSourceToWikiSibling(sourceFile, obsidianConfig) {
  if (!sourceFile) return null;
  const normalizedSource = sourceFile.replace(/\\/g, '/');
  
  const rules = obsidianConfig.mapping_rules || [];
  const wikiDir = obsidianConfig.wiki_dir || 'wiki';

  for (const rule of rules) {
    if (!rule || typeof rule.prefix !== 'string' || typeof rule.folder !== 'string') continue;
    
    const prefix = rule.prefix.replace(/\\/g, '/');
    if (normalizedSource.startsWith(prefix)) {
      const filename = path.basename(normalizedSource);
      
      // Capitalize/Format filename if it matches certain utility boundaries (e.g., RunAll.md)
      let ext = path.extname(filename);
      let namePart = path.basename(filename, ext);
      
      // Convert namePart to camelCase/PascalCase if it contains hyphens/dots
      if (namePart.includes('-') || namePart.includes('.')) {
        namePart = namePart.split(/[-.]/)
          .map(part => part.charAt(0).toUpperCase() + part.slice(1))
          .join('');
      } else {
        // Just make the first letter uppercase
        namePart = namePart.charAt(0).toUpperCase() + namePart.slice(1);
      }
      
      // If prefix maps to 'entities', preserve the full name with extension (e.g., detect-drift.ts.md)
      if (rule.folder.toLowerCase() === 'entities' || rule.folder.toLowerCase().includes('entities')) {
        return path.join(wikiDir, rule.folder, `${filename}.md`).replace(/\\/g, '/');
      } else {
        return path.join(wikiDir, rule.folder, `${namePart}.md`).replace(/\\/g, '/');
      }
    }
  }

  // Generic fallback if no mapping rule matches
  const base = path.basename(sourceFile);
  return path.join(wikiDir, 'entities', `${base}.md`).replace(/\\/g, '/');
}

/**
 * Extracts the names of exported symbols that are modified in a Git diff.
 * @param {string} diff - The unified git diff output
 * @returns {Array<string>} - Array of extracted symbol names
 */
export function extractExportedSymbolsFromDiff(diff) {
  if (!diff) return [];
  const symbols = [];
  const lines = diff.split('\n');
  
  // Captures function/class/const/let/var/interface/type exports
  const regex = /^\+\s*export\s+(?:async\s+)?(?:default\s+)?(?:function|class|const|let|var|interface|type)\s+([a-zA-Z0-9_$]+)/;
  
  for (const line of lines) {
    const match = line.match(regex);
    if (match && match[1]) {
      symbols.push(match[1]);
    }
  }
  return [...new Set(symbols)];
}

/**
 * Executes a local 'graft callers' query to find calling files of a symbol.
 * @param {string} symbol - The symbol name to query (e.g., 'toPosixPath')
 * @param {string} repoRoot - Absolute repository root
 * @returns {Array<string>} - Calling relative file paths
 */
export function queryGraftCallers(symbol, repoRoot) {
  if (!symbol) return [];
  try {
    let output = '';
    try {
      // Attempt using global graft command first
      output = execSync(`graft callers "${symbol}"`, { cwd: repoRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (_) {
      // Fallback: Attempt running via npx
      output = execSync(`npx @nanonets/graft callers "${symbol}"`, { cwd: repoRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    }
    
    const files = [];
    const lines = output.split('\n');
    for (const line of lines) {
      // Parse paths from graft callers output (match typical project relative files)
      const pathRegex = /\b([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_/.-]+\.[a-zA-Z0-9]+)\b/g;
      let match;
      while ((match = pathRegex.exec(line)) !== null) {
        files.push(match[1].replace(/\\/g, '/'));
      }
    }
    return [...new Set(files)];
  } catch (_) {
    // Fail-soft: if graft command fails, return empty array
    return [];
  }
}

/**
 * Checks if a changed file undergoes exported structural signature changes (e.g., functions, classes, interfaces).
 * @param {string} relativePath 
 * @param {string} repoRoot 
 * @returns {boolean}
 */
export function isStructuralSignatureChange(relativePath, repoRoot) {
  const fullPath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(fullPath)) return false;

  try {
    // Run Git diff against HEAD to see the changes made in the staging environment
    const diff = execSync(`git diff -U0 HEAD -- "${relativePath}"`, { cwd: repoRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    
    // Core check signature updates: matches function/class/const/interface modifications
    return /^\+.*export\s+(function|class|const|interface|default|async|type|let|var)/im.test(diff);
  } catch (err) {
    return false;
  }
}

/**
 * Appends a documentation drift warning to TODOS.md, enforcing strict deduplication.
 * @param {string} repoRoot 
 * @param {string} taskLine 
 * @param {string} signatureKey 
 */
export function appendDriftTodo(repoRoot, taskLine, signatureKey) {
  const possiblePaths = [
    path.join(repoRoot, 'TODOS.md'),
    path.resolve(repoRoot, '../TODOS.md'),
    'C:/dev/TODOS.md',
    'c:/dev/TODOS.md',
  ];
  
  let targetPath = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      targetPath = p;
      break;
    }
  }
  
  // If TODOS.md does not exist anywhere, auto-create a baseline one in repo root
  if (!targetPath) {
    targetPath = path.join(repoRoot, 'TODOS.md');
    try {
      fs.writeFileSync(targetPath, '# Task List\n\n## Open\n\n', 'utf8');
    } catch (_) {
      return; // If write fails, exit gracefully
    }
  }

  try {
    const content = fs.readFileSync(targetPath, 'utf8');
    // Deduplication check: if signatureKey or taskLine already exists, ignore
    if (content.includes(signatureKey) || content.includes(taskLine)) {
      return;
    }
    
    if (content.includes('## Open')) {
      const updated = content.replace(/## Open\r?\n/, `## Open\n\n${taskLine}\n`);
      fs.writeFileSync(targetPath, updated, 'utf8');
    }
  } catch (_) {}
}

/**
 * Evaluates Sibling Pattern validations across all staged changed files.
 * @param {Array<string>} changedFiles - Array of relative staged file paths (e.g. ['core/run-all.sh'])
 * @param {string} repoRoot - Absolute repository root directory
 * @returns {object} - Object containing warnings and blocking errors
 */
export function checkSiblingPatterns(changedFiles, repoRoot) {
  const warnings = [];
  const errors = [];
  
  const obsidianConfig = loadObsidianConfig(repoRoot);
  const vaultRoot = path.resolve(repoRoot, obsidianConfig.vault_root);

  // 1. Resolve Adjacency/DAG pointer to inspect consumer relationships
  let adjacency = null;
  const possiblePointerPaths = [
    path.join(repoRoot, '.nlm_pack', 'current_generation.json'),
    path.join(repoRoot, '.nlm_pack', 'pointer.json'),
    path.join(repoRoot, 'KB_SYNC_STATUS.json')
  ];

  let pointerPath = possiblePointerPaths.find(p => fs.existsSync(p));
  if (pointerPath) {
    try {
      const pointer = JSON.parse(fs.readFileSync(pointerPath, 'utf8'));
      const activeGen = pointer.active_generation;
      if (activeGen) {
        const adjFile = path.join(repoRoot, '.nlm_pack', 'generations', activeGen, 'adjacency.json');
        if (fs.existsSync(adjFile)) {
          adjacency = JSON.parse(fs.readFileSync(adjFile, 'utf8'));
        }
      }
    } catch (_) {
      // Fail-soft on JSON parsing error: proceed without adjacency consumer checks
    }
  }

  // Clean relative paths for robust matching
  const cleanedStaged = changedFiles.map(f => f.replace(/\\/g, '/').toLowerCase());

  for (const file of changedFiles) {
    const cleanFile = file.replace(/\\/g, '/');
    const cleanFileLower = cleanFile.toLowerCase();
    
    // Ignore non-source or ignored directories
    if (cleanFileLower.startsWith('.git/') || cleanFileLower.startsWith('node_modules/')) {
      continue;
    }

    // Check Rule 1: Wiki Ingestion Drift
    const wikiSibling = mapSourceToWikiSibling(cleanFile, obsidianConfig);
    if (wikiSibling) {
      const fullSourcePath = path.join(repoRoot, cleanFile);
      const fullWikiSiblingPath = path.join(vaultRoot, wikiSibling);
      
      if (fs.existsSync(fullSourcePath)) {
        if (!fs.existsSync(fullWikiSiblingPath)) {
          // Wiki sibling page is completely missing
          warnings.push({
            type: 'WIKI_DRIFT',
            file: cleanFile,
            wikiSibling,
            message: `Stale or missing wiki documentation: Sibling document "${wikiSibling}" does not exist.`
          });
        } else {
          // Both exist, check drift mtime
          try {
            const sourceMtime = fs.statSync(fullSourcePath).mtimeMs;
            const wikiMtime = fs.statSync(fullWikiSiblingPath).mtimeMs;
            
            // If the code was edited after the documentation
            if (sourceMtime > wikiMtime && !cleanedStaged.includes(wikiSibling.toLowerCase())) {
              warnings.push({
                type: 'WIKI_DRIFT',
                file: cleanFile,
                wikiSibling,
                message: `Staged changes in "${cleanFile}" outpace its wiki page: "${wikiSibling}" has older modification timestamp.`
              });
            }
          } catch (_) {}
        }
      }
    }

    // Check Rule 2: Interface Signature Drift (downstream call map dependencies)
    let isSigChange = false;
    let modifiedSymbols = [];
    try {
      const fullSourcePath = path.join(repoRoot, cleanFile);
      if (fs.existsSync(fullSourcePath)) {
        const diff = execSync(`git diff -U0 HEAD -- "${cleanFile}"`, { cwd: repoRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        isSigChange = /^\+.*export\s+(function|class|const|interface|default|async|type|let|var)/im.test(diff);
        if (isSigChange) {
          modifiedSymbols = extractExportedSymbolsFromDiff(diff);
        }
      }
    } catch (_) {}

    if (isSigChange) {
      let graftResolved = false;
      
      // 2.1 Graft-Powered Call Graph Blast Radius Query
      if (modifiedSymbols.length > 0) {
        for (const symbol of modifiedSymbols) {
          const graftCallers = queryGraftCallers(symbol, repoRoot);
          if (graftCallers.length > 0) {
            graftResolved = true;
            for (const consumer of graftCallers) {
              const cleanConsumer = consumer.replace(/\\/g, '/');
              const cleanConsumerLower = cleanConsumer.toLowerCase();
              if (cleanConsumerLower !== cleanFileLower && !cleanedStaged.includes(cleanConsumerLower)) {
                errors.push({
                  type: 'INTERFACE_BREAK',
                  file: cleanFile,
                  symbol,
                  consumer: cleanConsumer,
                  source: 'Graft Context Graph',
                  message: `Graft resolved call dependency: Sibling consumer "${cleanConsumer}" references modified symbol "${symbol}" in library "${cleanFile}". Consumer needs update.`
                });
              }
            }
          }
        }
      }

      // 2.2 Fallback: Static DAG Adjacency list mapping (if Graft not resolved/installed)
      if (!graftResolved && adjacency) {
        const fileId = `node:file:${cleanFileLower}`;
        let consumers = [];
        if (adjacency.reverse && adjacency.reverse[fileId]) {
          consumers = adjacency.reverse[fileId];
        } else if (adjacency.edges) {
          consumers = adjacency.edges
            .filter(edge => edge.target === fileId)
            .map(edge => ({ source: edge.source }));
        }

        for (const consumer of consumers) {
          const consumerRelPath = consumer.source.replace('node:file:', '');
          const cleanConsumerLower = consumerRelPath.toLowerCase();

          if (!cleanedStaged.includes(cleanConsumerLower)) {
            errors.push({
              type: 'INTERFACE_BREAK',
              file: cleanFile,
              consumer: consumerRelPath,
              source: 'Static DAG Adjacency',
              message: `Static DAG dependency: Shared module "${cleanFile}" contains structural signature modifications. Consumer "${consumerRelPath}" has un-migrated interfaces.`
            });
          }
        }
      }
    }
  }

  return { warnings, errors };
}
