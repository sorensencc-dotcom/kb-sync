#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

// Standard styling colors for console logging
const COLOR = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

const logInfo = (msg) => console.log(`${COLOR.green}[MERMAID-MAP] [INFO]${COLOR.reset} ${msg}`);
const logWarn = (msg) => console.log(`${COLOR.yellow}[MERMAID-MAP] [WARN]${COLOR.reset} ${msg}`);
const logError = (msg) => console.log(`${COLOR.red}[MERMAID-MAP] [ERROR]${COLOR.reset} ${msg}`);

/**
 * Loads configurations from configs/obsidian.yaml.
 */
function loadObsidianConfig(repoRoot) {
  const configPath = path.join(repoRoot, 'configs', 'obsidian.yaml');
  const defaults = {
    vault_root: '.',
    wiki_dir: 'wiki',
    index_filename: 'Index.md'
  };

  if (!fs.existsSync(configPath)) {
    logWarn(`configs/obsidian.yaml not found. Using standard defaults.`);
    return defaults;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = yaml.load(raw) || {};
    return {
      vault_root: parsed.vault_root || defaults.vault_root,
      wiki_dir: parsed.wiki_dir || defaults.wiki_dir,
      index_filename: parsed.index_filename || defaults.index_filename,
      mapping_rules: parsed.mapping_rules || []
    };
  } catch (err) {
    logWarn(`Error parsing configs/obsidian.yaml: ${err.message}. Using defaults.`);
    return defaults;
  }
}

/**
 * Resolves the active generation directory and loads its adjacency and DAG data.
 */
function loadActiveGenerationData(repoRoot) {
  const candidateDirs = [
    repoRoot,
    path.resolve(repoRoot, '..')
  ];

  let pointerPath = null;
  let activeBaseDir = repoRoot;

  for (const base of candidateDirs) {
    const candidates = [
      path.join(base, '.nlm_pack', 'current_generation.json'),
      path.join(base, '.nlm_pack', 'pointer.json'),
      path.join(base, 'KB_SYNC_STATUS.json')
    ];
    const found = candidates.find(p => fs.existsSync(p));
    if (found) {
      pointerPath = found;
      activeBaseDir = base;
      break;
    }
  }

  if (!pointerPath) {
    throw new Error('No pointer or current_generation.json found. Run DAG build first.');
  }

  try {
    const pointer = JSON.parse(fs.readFileSync(pointerPath, 'utf8'));
    const activeGen = pointer.active_generation;
    if (!activeGen) {
      throw new Error('Pointer file is missing an active_generation value.');
    }

    const genDir = path.join(activeBaseDir, '.nlm_pack', 'generations', activeGen);
    const adjFile = path.join(genDir, 'adjacency.json');
    const dagFile = path.join(genDir, 'dag.json');

    if (!fs.existsSync(adjFile) || !fs.existsSync(dagFile)) {
      throw new Error(`Generation files missing under: ${genDir}`);
    }

    return {
      adjacency: JSON.parse(fs.readFileSync(adjFile, 'utf8')),
      dag: JSON.parse(fs.readFileSync(dagFile, 'utf8'))
    };
  } catch (err) {
    throw new Error(`Failed to resolve active generation: ${err.message}`);
  }
}

/**
 * Capitalizes names to camelCase/PascalCase for neat labeling
 */
function cleanLabel(rawPath) {
  const filename = path.basename(rawPath);
  let ext = path.extname(filename);
  let namePart = path.basename(filename, ext);
  
  if (namePart.includes('-') || namePart.includes('.')) {
    return namePart.split(/[-.]/)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
  }
  return namePart.charAt(0).toUpperCase() + namePart.slice(1);
}

/**
 * Builds a highly optimized and clustered Mermaid diagram string
 */
function buildMermaidChart(dag, adjacency) {
  const fileNodes = (dag.nodes || []).filter(n => n.node_type === 'file');
  const edges = (dag.edges || []).filter(e => {
    // Only map file-to-file links to keep index chart clean and scannable
    return e.source.startsWith('node:file:') && e.target.startsWith('node:file:') && 
           (e.relation === 'wikilink' || e.relation === 'mdlink');
  });

  if (fileNodes.length === 0) {
    return '%% No file nodes found to map %%\n';
  }

  let chart = '```mermaid\nflowchart TD\n';
  chart += '  %% Theme styling\n';
  chart += '  classDef core fill:#2d1b4e,stroke:#9d4edd,stroke-width:2px,color:#fff;\n';
  chart += '  classDef modules fill:#112a46,stroke:#0077b6,stroke-width:2px,color:#fff;\n';
  chart += '  classDef docs fill:#1b4d3e,stroke:#52b788,stroke-width:2px,color:#fff;\n';
  chart += '  classDef fallback fill:#343a40,stroke:#6c757d,stroke-width:1px,color:#fff;\n\n';

  // Group files into subgraphs by their parent folder structures
  const clusters = {};
  for (const node of fileNodes) {
    const rawPath = node.path;
    const parts = rawPath.split('/');
    const groupName = parts.length > 1 ? parts[0] : 'root';
    
    if (!clusters[groupName]) {
      clusters[groupName] = [];
    }
    clusters[groupName].push(node);
  }

  // Write subgraphs
  for (const [groupName, nodes] of Object.entries(clusters)) {
    const safeGroupId = groupName.replace(/[^a-zA-Z0-9]/g, '_');
    const groupLabel = groupName.toUpperCase();
    
    chart += `  subgraph ${safeGroupId} ["${groupLabel} DIRECTORY"]\n`;
    for (const node of nodes) {
      const cleanId = node.id.replace(/[:.#/\\-]/g, '_');
      const label = cleanLabel(node.path);
      chart += `    ${cleanId}["${label}"]\n`;
    }
    chart += '  end\n\n';
  }

  // Write Edges with styles
  for (const edge of edges) {
    const srcId = edge.source.replace(/[:.#/\\-]/g, '_');
    const tgtId = edge.target.replace(/[:.#/\\-]/g, '_');
    const relationLabel = edge.relation === 'wikilink' ? 'wiki-link' : 'md-link';
    chart += `  ${srcId} -->|"${relationLabel}"| ${tgtId}\n`;
  }

  // Map CSS classes to subgraphs/nodes dynamically
  chart += '\n  %% Node style mappings\n';
  for (const node of fileNodes) {
    const cleanId = node.id.replace(/[:.#/\\-]/g, '_');
    const rawPath = node.path;
    if (rawPath.startsWith('core/')) {
      chart += `  class ${cleanId} core;\n`;
    } else if (rawPath.startsWith('modules/') || rawPath.startsWith('scripts/')) {
      chart += `  class ${cleanId} modules;\n`;
    } else if (rawPath.startsWith('docs/')) {
      chart += `  class ${cleanId} docs;\n`;
    } else {
      chart += `  class ${cleanId} fallback;\n`;
    }
  }

  chart += '```';
  return chart;
}

/**
 * Inlines or replaces the Mermaid diagram inside the target Index.md file
 */
function updateIndexDoc(indexPath, chart) {
  if (!fs.existsSync(indexPath)) {
    logWarn(`Index file not found at ${indexPath}. Creating a fresh Index file.`);
    const freshIndex = `---
title: "Wiki Index"
category: "wiki"
status: "active"
---

### Wiki Index

<!-- MERMAID-MAP-START -->
${chart}
<!-- MERMAID-MAP-END -->

#### Pages
- [[kb-sync/wiki/Index]]
`;
    fs.writeFileSync(indexPath, freshIndex, 'utf8');
    logInfo(`✓ Successfully created and populated ${indexPath}`);
    return;
  }

  const content = fs.readFileSync(indexPath, 'utf8');
  const startDelimiter = '<!-- MERMAID-MAP-START -->';
  const endDelimiter = '<!-- MERMAID-MAP-END -->';

  const startIndex = content.indexOf(startDelimiter);
  const endIndex = content.indexOf(endDelimiter);

  let updatedContent;
  if (startIndex !== -1 && endIndex !== -1) {
    // Replace the existing block
    updatedContent = 
      content.slice(0, startIndex + startDelimiter.length) + '\n' +
      chart + '\n' +
      content.slice(endIndex);
    logInfo('Detected existing Mermaid map delimiters. Replacing inline block...');
  } else {
    // Append to the end of the Index if no delimiters are present
    updatedContent = content.trim() + `\n\n### System Topology Map\n\n${startDelimiter}\n${chart}\n${endDelimiter}\n`;
    logInfo('No existing delimiters found. Appended visual map to the end of Index.md.');
  }

  fs.writeFileSync(indexPath, updatedContent, 'utf8');
  logInfo(`✓ Successfully updated ${path.basename(indexPath)} with the active code graph.`);
}

function main() {
  const repoRoot = process.cwd();
  logInfo(`Executing local CodeWiki Diagram Generator in: ${repoRoot}`);

  try {
    const config = loadObsidianConfig(repoRoot);
    const vaultRoot = path.resolve(repoRoot, config.vault_root);
    const wikiDir = path.resolve(vaultRoot, config.wiki_dir);
    const indexPath = path.join(wikiDir, config.index_filename);

    logInfo(`Obsidian Vault Root resolved to: ${vaultRoot}`);
    logInfo(`Target Wiki directory: ${wikiDir}`);

    const { adjacency, dag } = loadActiveGenerationData(repoRoot);
    logInfo(`Successfully loaded active structural DAG metadata.`);

    logInfo(`Parsing dependency edges and generating Mermaid code tree...`);
    const chart = buildMermaidChart(dag, adjacency);

    logInfo(`Updating documentation target: ${indexPath}`);
    updateIndexDoc(indexPath, chart);

    logInfo(`${COLOR.bold}${COLOR.green}SUCCESS: Local CodeWiki generation cycle completed!${COLOR.reset}`);
    process.exit(0);
  } catch (err) {
    logError(`Map Generation Interrupted: ${err.message}`);
    process.exit(1);
  }
}

main();
