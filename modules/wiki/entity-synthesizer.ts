import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

export interface EntitySynthesisResult {
  repository: string;
  sourceFilesScanned: number;
  entitiesGenerated: number;
  entitiesUpdated: number;
  entitiesUnchanged: number;
  entityFiles: string[];
}

function getFileSha256(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch {
    return '';
  }
}

function getGitCommitDate(filePath: string, cwd: string): string {
  try {
    const dateStr = execSync(`git log -1 --format=%cI -- "${filePath}"`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (dateStr) return dateStr;
  } catch {}
  try {
    const stat = fs.statSync(path.join(cwd, filePath));
    return stat.mtime.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function extractExportedSymbols(content: string, ext: string): string[] {
  const symbols: string[] = [];
  if (/\.(ts|js|mjs|cjs)$/.test(ext)) {
    const exportMatches = content.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let|var|interface|type)\s+([a-zA-Z0-9_$]+)/g);
    for (const m of exportMatches) {
      symbols.push(m[1]);
    }
  } else if (/\.(py)$/.test(ext)) {
    const pyMatches = content.matchAll(/def\s+([a-zA-Z0-9_]+)\s*\(/g);
    for (const m of pyMatches) {
      symbols.push(m[1]);
    }
  }
  return Array.from(new Set(symbols));
}

export function synthesizeEntityMarkdown(repoName: string, repoRoot: string, fileRel: string): { content: string; entityFilename: string } {
  const fullPath = path.join(repoRoot, fileRel);
  const ext = path.extname(fileRel);
  const baseName = path.basename(fileRel);
  const entityFilename = `${baseName}.md`;

  let rawContent = '';
  try {
    rawContent = fs.readFileSync(fullPath, 'utf8');
  } catch {
    rawContent = '';
  }

  const linesCount = rawContent.split(/\r?\n/).length;
  const sha256 = getFileSha256(fullPath);
  const lastCommitDate = getGitCommitDate(fileRel, repoRoot);
  const symbols = extractExportedSymbols(rawContent, ext);

  let category = 'utilities';
  if (fileRel.startsWith('modules/cache') || fileRel.startsWith('core/')) category = 'sync-tools';
  else if (fileRel.startsWith('modules/wiki')) category = 'wiki';
  else if (fileRel.startsWith('modules/obsidian')) category = 'adapters';
  else if (fileRel.startsWith('modules/notebooklm')) category = 'adapters';
  else if (fileRel.startsWith('tests/')) category = 'scaffolds';

  const title = baseName.replace(/[^a-zA-Z0-9]/g, '-');

  let symbolsSection = '';
  if (symbols.length > 0) {
    symbolsSection = `\n## Exported Symbols & API\n${symbols.map(s => `- \`${s}\``).join('\n')}\n`;
  }

  const content = `---
title: ${baseName}
category: ${category}
status: active
sourceRepository: ${repoName}
sourceFile: ${fileRel}
sha256: ${sha256}
lastCommit: ${lastCommitDate}
---

# ${baseName}

## Overview
Synthesized entity documentation for \`${fileRel}\` in **${repoName}**.

- **File Path:** \`${fileRel}\`
- **Lines of Code:** ${linesCount}
- **Last Modified:** \`${lastCommitDate}\`
- **SHA-256:** \`${sha256}\`
${symbolsSection}
## Source Citations
- Source: \`${fileRel}\`
- Repository: \`${repoName}\`
`;

  return { content, entityFilename };
}

export function synthesizeAllEntities(options: { repoName?: string; repoRoot?: string; targetWikiDir?: string } = {}): EntitySynthesisResult {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const repoName = options.repoName || path.basename(repoRoot);
  const wikiDir = options.targetWikiDir || path.join(repoRoot, 'wiki');
  const entitiesDir = path.join(wikiDir, 'entities');

  if (!fs.existsSync(entitiesDir)) {
    fs.mkdirSync(entitiesDir, { recursive: true });
  }

  const scanDirs = ['core', 'modules', 'scripts', 'tests', 'src'];
  const sourceFiles: string[] = [];

  function collect(dirRel: string) {
    const fullDir = path.join(repoRoot, dirRel);
    if (!fs.existsSync(fullDir)) return;
    try {
      const entries = fs.readdirSync(fullDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name === 'node_modules' || e.name === '.git' || e.name === '_kb-sync-staging' || e.name === '.wiki-publish-temp') continue;
        const rel = path.join(dirRel, e.name).replace(/\\/g, '/');
        if (e.isDirectory()) {
          collect(rel);
        } else if (e.isFile() && /\.(ts|js|mjs|cjs|json|sh|ps1|py|yaml|yml|md)$/.test(e.name)) {
          sourceFiles.push(rel);
        }
      }
    } catch {}
  }

  for (const d of scanDirs) {
    collect(d);
  }

  let generated = 0;
  let updated = 0;
  let unchanged = 0;
  const entityFiles: string[] = [];

  for (const fileRel of sourceFiles) {
    const { content, entityFilename } = synthesizeEntityMarkdown(repoName, repoRoot, fileRel);
    const destPath = path.join(entitiesDir, entityFilename);
    entityFiles.push(entityFilename);

    if (!fs.existsSync(destPath)) {
      fs.writeFileSync(destPath, content, 'utf8');
      generated++;
    } else {
      const existing = fs.readFileSync(destPath, 'utf8');
      if (existing !== content) {
        fs.writeFileSync(destPath, content, 'utf8');
        updated++;
      } else {
        unchanged++;
      }
    }
  }

  console.log(`[ENTITY-SYNTHESIZER] ${repoName}: Scanned ${sourceFiles.length} source files -> Generated: ${generated}, Updated: ${updated}, Unchanged: ${unchanged}`);

  return {
    repository: repoName,
    sourceFilesScanned: sourceFiles.length,
    entitiesGenerated: generated,
    entitiesUpdated: updated,
    entitiesUnchanged: unchanged,
    entityFiles
  };
}

if (process.argv[1] && process.argv[1].endsWith('entity-synthesizer.ts')) {
  const result = synthesizeAllEntities();
  console.log(JSON.stringify(result, null, 2));
}
