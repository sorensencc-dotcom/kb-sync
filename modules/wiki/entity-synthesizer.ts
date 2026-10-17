import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import {
  GENERATED_MANIFEST_NAME,
  applyOwnedRemovals,
  planOwnedRemovals,
  readOwnershipManifest,
  sha256Text,
  toPosix,
  writeJsonAtomic,
} from './generated-ownership.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

/**
 * Bump when the page template changes so every page is regenerated (the
 * generator version is part of each page's inputHash).
 */
export const ENTITY_GENERATOR_VERSION = '2';
export const ENTITY_SCAN_DIRS = ['core', 'modules', 'scripts', 'tests', 'src'];
const SOURCE_EXT_RE = /\.(ts|js|mjs|cjs|json|sh|ps1|py|yaml|yml|md)$/;
const SKIP_DIR_NAMES = new Set(['node_modules', '.git', '_kb-sync-staging', '.wiki-publish-temp']);

/**
 * What an entity page IS. It is a metadata inventory (path, size, hash, exported
 * symbol names). It is NOT an explanation of behaviour, and refreshing it must
 * never be reported as semantic regeneration.
 */
export const ENTITY_GENERATION_KIND = 'metadata-inventory';

export interface EntitySynthesisFailure {
  file: string;
  stage: 'read' | 'collision' | 'conflict' | 'write';
  error: string;
}

export interface EntitySynthesisResult {
  repository: string;
  status: 'OK' | 'FAILED';
  dryRun: boolean;
  generationKind: typeof ENTITY_GENERATION_KIND;
  semanticRegeneration: false;
  sourceFilesScanned: number;
  entitiesGenerated: number;
  entitiesUpdated: number;
  entitiesUnchanged: number;
  /** Page file names (relative to wiki/entities) of the current entity pages. */
  entityFiles: string[];
  aliasesWritten: number;
  removed: string[];
  /** Owned pages whose source vanished but which were hand-edited: kept in place. */
  preservedModified: string[];
  /** removed page -> new page, matched by identical source content. */
  renamed: Array<{ from: string; to: string }>;
  legacyAdopted: number;
  /** Human-authored files that sat on a path the generator wanted (never overwritten). */
  skippedHumanOwned: string[];
  failures: EntitySynthesisFailure[];
  sourcesHash: string;
  outputsHash: string;
  manifestPath: string;
}

export interface SynthesizeOptions {
  repoName?: string;
  repoRoot?: string;
  targetWikiDir?: string;
  /** Plan only: no directory, page, removal or manifest is written. */
  dryRun?: boolean;
  /** Keep `entities/<basename>.md` redirect/disambiguation pages for old links (default true). */
  legacyAliases?: boolean;
  /** Test seam: read a source file. Throwing marks the stage as FAILED. */
  readSource?: (fullPath: string) => string;
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

function slug(value: string, max: number): string {
  const s = toPosix(value).replace(/[^A-Za-z0-9._]+/g, '-').replace(/^-+|-+$/g, '');
  return s.length > max ? s.slice(0, max).replace(/-+$/, '') : s;
}

/**
 * Collision-safe page identity derived from repository + FULL relative source
 * path. The readable prefix is for humans; the hash suffix makes the identity
 * injective even when two paths slug to the same text.
 */
export function entityPageId(repoName: string, fileRel: string): string {
  const rel = toPosix(fileRel);
  const hash = sha256Text(`${repoName}\0${rel}`).slice(0, 8);
  return `${slug(repoName, 40)}--${slug(rel, 100)}--${hash}`;
}

export function entityPageRelPath(repoName: string, fileRel: string): string {
  return `entities/${entityPageId(repoName, fileRel)}.md`;
}

/** The pre-fix page name (source basename). Kept only as a redirect/alias path. */
export function legacyEntityRelPath(fileRel: string): string {
  return `entities/${path.posix.basename(toPosix(fileRel))}.md`;
}

/** All source files the synthesizer documents, as sorted posix paths relative to repoRoot. */
export function collectEntitySources(repoRoot: string): string[] {
  const out: string[] = [];
  function collect(dirRel: string) {
    const fullDir = path.join(repoRoot, dirRel);
    if (!fs.existsSync(fullDir)) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(fullDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP_DIR_NAMES.has(e.name)) continue;
      const rel = path.join(dirRel, e.name).replace(/\\/g, '/');
      if (e.isDirectory()) collect(rel);
      else if (e.isFile() && SOURCE_EXT_RE.test(e.name)) out.push(rel);
    }
  }
  for (const d of ENTITY_SCAN_DIRS) collect(d);
  return out.sort();
}

/** Hash of the exact bytes + identity that one entity page is generated from. */
export function entityInputHash(repoName: string, fileRel: string, sourceSha256: string): string {
  return sha256Text([ENTITY_GENERATOR_VERSION, repoName, toPosix(fileRel), sourceSha256].join('\0'));
}

export interface SourceInputs {
  entries: Record<string, string>;
  sourcesHash: string;
}

/** Hash every generation input (path + content hash) into one revision-independent fingerprint. */
export function computeSourceInputs(repoName: string, repoRoot: string, files?: string[]): SourceInputs {
  const list = files ?? collectEntitySources(repoRoot);
  const entries: Record<string, string> = {};
  for (const rel of list) entries[rel] = getFileSha256(path.join(repoRoot, rel));
  const lines = Object.keys(entries)
    .sort()
    .map((rel) => `${rel}\0${entries[rel]}`);
  const sourcesHash = sha256Text([ENTITY_GENERATOR_VERSION, repoName, ...lines].join('\n'));
  return { entries, sourcesHash };
}

export function synthesizeEntityMarkdown(
  repoName: string,
  repoRoot: string,
  fileRel: string,
  readSource: (fullPath: string) => string = (p) => fs.readFileSync(p, 'utf8'),
): { content: string; entityFilename: string; entityId: string; inputHash: string; entityPath: string } {
  const fullPath = path.join(repoRoot, fileRel);
  const ext = path.extname(fileRel);
  const baseName = path.basename(fileRel);
  const entityId = entityPageId(repoName, fileRel);
  const entityFilename = `${entityId}.md`;

  // Unreadable source is a real failure (caller decides); do not paper over it with ''.
  const rawContent = readSource(fullPath);

  const linesCount = rawContent.split(/\r?\n/).length;
  const sha256 = getFileSha256(fullPath);
  const lastCommitDate = getGitCommitDate(fileRel, repoRoot);
  const symbols = extractExportedSymbols(rawContent, ext);
  const inputHash = entityInputHash(repoName, fileRel, sha256);

  let category = 'utilities';
  if (fileRel.startsWith('modules/cache') || fileRel.startsWith('core/')) category = 'sync-tools';
  else if (fileRel.startsWith('modules/wiki')) category = 'wiki';
  else if (fileRel.startsWith('modules/obsidian')) category = 'adapters';
  else if (fileRel.startsWith('modules/notebooklm')) category = 'adapters';
  else if (fileRel.startsWith('tests/')) category = 'scaffolds';

  let symbolsSection = '';
  if (symbols.length > 0) {
    symbolsSection = `\n## Exported Symbols & API\n${symbols.map(s => `- \`${s}\``).join('\n')}\n`;
  }

  // No quotes/backticks: the cache's L0 abstract extractor reads this line verbatim.
  const summarySymbols = symbols.length > 0 ? ` Exports: ${symbols.slice(0, 12).join(', ')}.` : '';
  const summary = `Metadata inventory for ${toPosix(fileRel)} in ${repoName} (${linesCount} lines).${summarySymbols}`.replace(/["'`]/g, '');

  const content = `---
title: ${baseName}
category: ${category}
status: active
sourceRepository: ${repoName}
sourceFile: ${toPosix(fileRel)}
entityId: ${entityId}
generator: entity-synthesizer@${ENTITY_GENERATOR_VERSION}
generationKind: ${ENTITY_GENERATION_KIND}
semanticContent: false
inputHash: ${inputHash}
sha256: ${sha256}
lastCommit: ${lastCommitDate}
summary: ${summary}
---

# ${baseName}

> **Generated metadata inventory, not an explanation.** This page is produced
> automatically from file metadata (path, size, hash, exported symbol names). It
> does not describe behaviour or intent, and refreshing it does not mean the
> explanatory documentation for this file was re-synthesized.

## Overview
Metadata inventory for \`${toPosix(fileRel)}\` in **${repoName}**.

- **File Path:** \`${toPosix(fileRel)}\`
- **Lines of Code:** ${linesCount}
- **Last Modified:** \`${lastCommitDate}\`
- **SHA-256:** \`${sha256}\`
${symbolsSection}
## Source Citations
- Source: \`${toPosix(fileRel)}\`
- Repository: \`${repoName}\`
`;

  return { content, entityFilename, entityId, inputHash, entityPath: `entities/${entityFilename}` };
}

/**
 * True for a page written by this generator: either the pre-manifest template
 * (exact frontmatter keys + body sentence) or a current-version page (generator
 * frontmatter marker). Used only to adopt pages whose manifest entry is missing.
 */
export function isGeneratedEntityPage(content: string): boolean {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return false;
  const fm = m[1];
  const body = content.slice(m[0].length);
  const legacy =
    /^sourceRepository:/m.test(fm) && /^sourceFile:/m.test(fm) && /^sha256:/m.test(fm) && body.includes('Synthesized entity documentation for `');
  const current = /^generator:\s*entity-synthesizer@/m.test(fm);
  return legacy || current;
}

interface ManifestEntry {
  sha256: string;
  kind: 'entity' | 'legacy-alias';
  sourceFile?: string;
  sourceSha256?: string;
  inputHash?: string;
  targets?: string[];
  /** Source vanished but the page was hand-edited, so it was kept; surfaced, never deleted. */
  orphanedEdited?: boolean;
}

export interface GeneratedManifest {
  version: number;
  generator: string;
  repository: string;
  generationKind: string;
  semanticRegeneration: false;
  sourcesHash: string;
  outputsHash: string;
  files: Record<string, ManifestEntry>;
}

function buildAliasContent(basename: string, targets: Array<{ fileRel: string; id: string }>): string {
  const sorted = [...targets].sort((a, b) => a.fileRel.localeCompare(b.fileRel));
  const list = sorted.map((t) => `- [[${t.fileRel}|${t.id}]]`).join('\n');
  return `---
title: ${basename}
category: utilities
status: redirect
generator: entity-synthesizer@${ENTITY_GENERATOR_VERSION}
generationKind: legacy-alias
semanticContent: false
summary: Legacy page name for ${basename}; redirects to ${sorted.length} entity page${sorted.length === 1 ? '' : 's'}.
---

# ${basename} (moved)

Entity pages are now named by repository and full source path, because a source
basename is not unique. This legacy page name is kept so existing links keep
resolving.

${sorted.length === 1 ? 'Moved to:' : `Several source files share this name (${sorted.length}). Pick the one you mean:`}

${list}
`;
}

export function synthesizeAllEntities(options: SynthesizeOptions = {}): EntitySynthesisResult {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const repoName = options.repoName || path.basename(repoRoot);
  const wikiDir = options.targetWikiDir || path.join(repoRoot, 'wiki');
  const entitiesDir = path.join(wikiDir, 'entities');
  const manifestPath = path.join(wikiDir, GENERATED_MANIFEST_NAME);
  const dryRun = !!options.dryRun;
  const legacyAliases = options.legacyAliases !== false;

  const sourceFiles = collectEntitySources(repoRoot);
  const failures: EntitySynthesisFailure[] = [];
  const { entries: sourceHashes, sourcesHash } = computeSourceInputs(repoName, repoRoot, sourceFiles);

  // ---- 1. Build the complete desired output set in memory (no writes yet). ----
  const desired = new Map<string, { content: string; entry: ManifestEntry }>();
  const pathOwner = new Map<string, string>(); // lowercased page path -> source
  const byLegacyName = new Map<string, { basename: string; targets: Array<{ fileRel: string; id: string }> }>();

  for (const fileRel of sourceFiles) {
    let page;
    try {
      page = synthesizeEntityMarkdown(repoName, repoRoot, fileRel, options.readSource);
    } catch (err: any) {
      failures.push({ file: fileRel, stage: 'read', error: String(err?.message || err) });
      continue;
    }
    const key = page.entityPath.toLowerCase();
    if (pathOwner.has(key)) {
      failures.push({ file: fileRel, stage: 'collision', error: `entity page ${page.entityPath} already produced for ${pathOwner.get(key)}` });
      continue;
    }
    pathOwner.set(key, fileRel);
    desired.set(page.entityPath, {
      content: page.content,
      entry: {
        sha256: sha256Text(page.content),
        kind: 'entity',
        sourceFile: toPosix(fileRel),
        sourceSha256: sourceHashes[fileRel],
        inputHash: page.inputHash,
      },
    });
    const legacy = legacyEntityRelPath(fileRel);
    const lk = legacy.toLowerCase();
    if (!byLegacyName.has(lk)) byLegacyName.set(lk, { basename: path.posix.basename(legacy), targets: [] });
    byLegacyName.get(lk)!.targets.push({ fileRel: toPosix(fileRel), id: page.entityId });
  }

  if (legacyAliases) {
    for (const [lk, group] of byLegacyName) {
      if (pathOwner.has(lk)) continue; // an alias may never shadow a real entity page
      const legacyPath = `entities/${group.basename}`;
      const content = buildAliasContent(group.basename.replace(/\.md$/, ''), group.targets);
      desired.set(legacyPath, {
        content,
        entry: { sha256: sha256Text(content), kind: 'legacy-alias', targets: group.targets.map((t) => t.id).sort() },
      });
    }
  }

  const result: EntitySynthesisResult = {
    repository: repoName,
    status: 'OK',
    dryRun,
    generationKind: ENTITY_GENERATION_KIND,
    semanticRegeneration: false,
    sourceFilesScanned: sourceFiles.length,
    entitiesGenerated: 0,
    entitiesUpdated: 0,
    entitiesUnchanged: 0,
    entityFiles: [],
    aliasesWritten: 0,
    removed: [],
    preservedModified: [],
    renamed: [],
    legacyAdopted: 0,
    skippedHumanOwned: [],
    failures,
    sourcesHash,
    outputsHash: '',
    manifestPath,
  };

  // Required stage: a failed read means the output set is incomplete. Write nothing
  // so a partial set can never be mistaken for a complete generation.
  if (failures.length > 0) {
    result.status = 'FAILED';
    console.error(`[ENTITY-SYNTHESIZER] ${repoName}: FAILED (${failures.length} failure(s)); no pages written.`);
    return result;
  }

  // ---- 2. Establish ownership of what already exists on disk. ----
  const previous = readOwnershipManifest(manifestPath) as GeneratedManifest | null;
  const owned: Record<string, ManifestEntry> = { ...(previous?.files ?? {}) } as Record<string, ManifestEntry>;

  if (fs.existsSync(entitiesDir)) {
    for (const name of fs.readdirSync(entitiesDir)) {
      const rel = `entities/${name}`;
      const abs = path.join(entitiesDir, name);
      if (owned[rel] || !fs.statSync(abs).isFile()) continue;
      let text = '';
      try {
        text = fs.readFileSync(abs, 'utf8');
      } catch {
        continue;
      }
      // Pre-manifest generated page: provably ours by exact template signature.
      if (isGeneratedEntityPage(text)) {
        owned[rel] = { sha256: sha256Text(text), kind: 'entity' };
        result.legacyAdopted += 1;
      }
    }
  }

  // ---- 3. Reject writes that would overwrite files we do not own. ----
  const toWrite: string[] = [];
  for (const [rel, { content }] of desired) {
    const abs = path.join(wikiDir, rel);
    if (fs.existsSync(abs)) {
      const existing = fs.readFileSync(abs, 'utf8');
      if (existing === content) {
        if (desired.get(rel)!.entry.kind === 'entity') result.entitiesUnchanged += 1;
        continue;
      }
      if (!owned[rel]) {
        result.skippedHumanOwned.push(rel);
        if (desired.get(rel)!.entry.kind === 'entity') {
          failures.push({ file: rel, stage: 'conflict', error: 'a file not generated by this tool occupies this entity page path' });
        }
        continue;
      }
      toWrite.push(rel);
      if (desired.get(rel)!.entry.kind === 'entity') result.entitiesUpdated += 1;
      else result.aliasesWritten += 1;
    } else {
      toWrite.push(rel);
      if (desired.get(rel)!.entry.kind === 'entity') result.entitiesGenerated += 1;
      else result.aliasesWritten += 1;
    }
  }

  if (failures.length > 0) {
    result.status = 'FAILED';
    return result;
  }

  // Human-owned alias paths are not ours to claim in the manifest.
  for (const rel of result.skippedHumanOwned) desired.delete(rel);

  // ---- 4. Reconcile removed / renamed sources against ownership records. ----
  const keep = new Set(desired.keys());
  const plan = planOwnedRemovals({ baseDir: wikiDir, previous: { files: owned } as any, keep });
  result.preservedModified = plan.preservedModified.sort();
  result.removed = [...plan.remove].sort();

  const newBySourceSha = new Map<string, string>();
  for (const [rel, { entry }] of desired) if (entry.kind === 'entity' && entry.sourceSha256) newBySourceSha.set(entry.sourceSha256, rel);
  for (const rel of [...plan.remove, ...plan.preservedModified]) {
    const sha = owned[rel]?.sourceSha256;
    const to = sha ? newBySourceSha.get(sha) : undefined;
    if (to && to !== rel && owned[rel]?.kind === 'entity') result.renamed.push({ from: rel, to });
  }

  const finalFiles: Record<string, ManifestEntry> = {};
  for (const rel of [...desired.keys()].sort()) finalFiles[rel] = desired.get(rel)!.entry;
  // Edited orphans stay on disk. Carry their ORIGINAL record forward (original hash, so they keep
  // reading as "modified") so a later run can neither delete them nor re-adopt the edited text.
  for (const rel of plan.preservedModified) {
    if (owned[rel]) finalFiles[rel] = { ...owned[rel], orphanedEdited: true };
  }
  result.entityFiles = Object.entries(finalFiles)
    .filter(([, e]) => e.kind === 'entity' && !e.orphanedEdited)
    .map(([rel]) => rel.replace(/^entities\//, ''));
  result.outputsHash = sha256Text(
    Object.keys(finalFiles)
      .filter((rel) => !finalFiles[rel].orphanedEdited)
      .map((rel) => `${rel}\0${finalFiles[rel].sha256}`)
      .join('\n'),
  );

  // ---- 5. Apply (skipped entirely on dry run). ----
  if (!dryRun) {
    if (desired.size > 0) fs.mkdirSync(entitiesDir, { recursive: true });
    for (const rel of toWrite) {
      if (!desired.has(rel)) continue;
      fs.writeFileSync(path.join(wikiDir, rel), desired.get(rel)!.content, 'utf8');
    }
    applyOwnedRemovals(wikiDir, plan);
    const manifest: GeneratedManifest = {
      version: 1,
      generator: `entity-synthesizer@${ENTITY_GENERATOR_VERSION}`,
      repository: repoName,
      generationKind: ENTITY_GENERATION_KIND,
      semanticRegeneration: false,
      sourcesHash,
      outputsHash: result.outputsHash,
      files: finalFiles,
    };
    const before = readOwnershipManifest(manifestPath);
    if (!before || JSON.stringify(before) !== JSON.stringify(manifest)) writeJsonAtomic(manifestPath, manifest);
  }

  console.log(
    `[ENTITY-SYNTHESIZER] ${repoName}${dryRun ? ' (dry-run, nothing written)' : ''}: Scanned ${sourceFiles.length} source files -> ` +
      `Generated: ${result.entitiesGenerated}, Updated: ${result.entitiesUpdated}, Unchanged: ${result.entitiesUnchanged}, ` +
      `Removed: ${result.removed.length}, Preserved(edited): ${result.preservedModified.length} [metadata-inventory, not semantic]`,
  );
  return result;
}

export interface GeneratedFreshness {
  manifestPresent: boolean;
  sourcesHashCurrent: string;
  sourcesHashRecorded: string | null;
  /** Pages whose recorded inputHash no longer matches their current source bytes. */
  stale: Array<{ page: string; sourceFile: string }>;
  /** Sources that currently have no generated page. */
  missing: string[];
  /** Pages whose source no longer exists. */
  orphaned: string[];
  /** Pages that no longer match the content hash recorded when they were generated. */
  tampered: string[];
  /** Edited pages whose source is gone; kept for a human to resolve. Informational only. */
  preservedOrphans: string[];
  fresh: boolean;
}

/**
 * Pure read-only check: are the generated pages still derived from the CURRENT
 * source bytes? Never writes.
 */
export function checkGeneratedFreshness(options: { repoName?: string; repoRoot?: string; targetWikiDir?: string } = {}): GeneratedFreshness {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const repoName = options.repoName || path.basename(repoRoot);
  const wikiDir = options.targetWikiDir || path.join(repoRoot, 'wiki');
  const manifest = readOwnershipManifest(path.join(wikiDir, GENERATED_MANIFEST_NAME)) as GeneratedManifest | null;
  const sources = collectEntitySources(repoRoot);
  const { entries, sourcesHash } = computeSourceInputs(repoName, repoRoot, sources);

  const out: GeneratedFreshness = {
    manifestPresent: !!manifest,
    sourcesHashCurrent: sourcesHash,
    sourcesHashRecorded: manifest?.sourcesHash ?? null,
    stale: [],
    missing: [],
    orphaned: [],
    tampered: [],
    preservedOrphans: [],
    fresh: false,
  };
  if (!manifest) {
    out.missing = sources;
    return out;
  }

  const covered = new Set<string>();
  for (const [page, entry] of Object.entries(manifest.files) as Array<[string, ManifestEntry]>) {
    if (entry.orphanedEdited) {
      out.preservedOrphans.push(page);
      continue;
    }
    const abs = path.join(wikiDir, page);
    const pageSha = fs.existsSync(abs) ? sha256Text(fs.readFileSync(abs, 'utf8')) : null;
    if (pageSha !== entry.sha256) out.tampered.push(page);
    if (entry.kind !== 'entity' || !entry.sourceFile) continue;
    covered.add(entry.sourceFile);
    const currentSha = entries[entry.sourceFile];
    if (currentSha === undefined) out.orphaned.push(page);
    else if (entityInputHash(repoName, entry.sourceFile, currentSha) !== entry.inputHash) out.stale.push({ page, sourceFile: entry.sourceFile });
  }
  out.missing = sources.filter((s) => !covered.has(s));
  out.fresh =
    out.stale.length === 0 && out.missing.length === 0 && out.orphaned.length === 0 && out.tampered.length === 0 && manifest.sourcesHash === sourcesHash;
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('entity-synthesizer.ts')) {
  const result = synthesizeAllEntities({ dryRun: process.argv.includes('--dry-run') });
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'OK') process.exitCode = 1;
}
