import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { CANONICAL_REPOSITORIES } from './cross-repo-drift-scanner.ts';
import { synthesizeAllEntities, type EntitySynthesisResult } from './entity-synthesizer.ts';
import {
  PUBLISH_MANIFEST_NAME,
  applyOwnedRemovals,
  planFlatCopies,
  planOwnedRemovals,
  readOwnershipManifest,
  sha256File,
  toPosix,
  writeJsonAtomic,
} from './generated-ownership.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

/**
 * BUG(contamination): fleet reconciler previously stamped source `_Sidebar.md`
 * (including kb-sync-wiki fragments such as competitor-watchlist-drift-engine,
 * historical-revocation-verification, mobile-websocket-heartbeats, kb-sync-readme,
 * trm-research-gaps) into other product wikis like toolforge-marketplace.
 * Prefer fail/skip of foreign sidebar fragments over copying kb-sync-wiki
 * sidebars across repos. Only keep wiki-link lines whose targets exist as pages
 * in the destination wiki (and, when configured, appear on that product allowlist).
 */
export const PRODUCT_SIDEBAR_ALLOWLISTS: Record<string, readonly string[]> = {
  'toolforge-marketplace': [
    'Home',
    'QUICKSTART',
    'INDEX',
    'GOVERNANCE',
    'TOOL_CREATION_GUIDE',
    'OPERATOR_GUIDE',
    'OPERATOR-COMMANDS',
    'PRODUCTION_PREREQUISITES',
    'OLLAMA_DEPLOYMENT_GUIDE',
    'OLLAMA_PROVIDER_SETUP',
    'ROLLBACK_RUNBOOK',
    'whichllm-model-selection-evaluator',
    'KB_SYNC_DAG',
    'DOCS_INDEX',
    'Log',
    'CHECKLIST',
  ],
};

const SIDEBAR_LINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/;
const FOREIGN_SIDEBAR_MARKERS = ['kb-sync', 'knowledge base sync'];

/** Known kb-sync-only page slugs that must never be restamped into other product sidebars. */
export const KB_SYNC_ONLY_SIDEBAR_TARGETS: ReadonlySet<string> = new Set([
  'trm-research-gaps',
  'kb-sync-readme',
  'historical-revocation-verification',
  'mobile-websocket-heartbeats',
  'competitor-watchlist-drift-engine',
]);

export interface FleetRepoSyncResult {
  repository: string;
  repoPath: string;
  remoteWikiUrl: string;
  /** DRY_RUN_PENDING: a dry run found changes that a real run would publish (never "healthy"). */
  status: 'SYNCHRONIZED' | 'UP_TO_DATE' | 'SKIPPED_NO_DOCS' | 'FAILED' | 'DRY_RUN_PENDING';
  filesPublished: number;
  remoteWikiHead?: string;
  localCodeHead?: string;
  error?: string;
  /** Which required stage failed ('generation' | 'publication'). */
  stage?: 'generation' | 'publication';
  generation?: { kind: string; sourcesHash: string };
  flatCollisions?: number;
  staleRemoved?: number;
}

export interface FleetReconcileReport {
  version: string;
  timestamp: string;
  system_time_epoch_ms: number;
  overall_status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  repositories: FleetRepoSyncResult[];
  summary: {
    total_repositories: number;
    synchronized_count: number;
    up_to_date_count: number;
    skipped_count: number;
    failed_count: number;
    dry_run_pending_count: number;
    total_files_published: number;
  };
}

export function deriveRepoWikiUrl(repoPath: string, defaultRepoName: string): string {
  try {
    const originUrl = execSync('git remote get-url origin', { cwd: repoPath, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (originUrl.includes('github.com')) {
      const match = originUrl.match(/github\.com[:/]([^/]+)\/([^/.]+?)(\.git)?$/);
      if (match) {
        return `git@github.com:${match[1]}/${match[2]}.wiki.git`;
      }
    }
  } catch {}
  return `git@github.com:sorensencc-dotcom/${defaultRepoName}.wiki.git`;
}

export function extractSidebarLinkTarget(line: string): string | null {
  const match = line.match(SIDEBAR_LINK_RE);
  if (!match) return null;
  return (match[2] ?? match[1]).trim() || null;
}

export function listExistingWikiPageSlugs(wikiDir: string): Set<string> {
  const slugs = new Set<string>();
  if (!fs.existsSync(wikiDir)) return slugs;
  for (const entry of fs.readdirSync(wikiDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith('.md')) continue;
    if (entry.name.startsWith('_')) continue;
    slugs.add(entry.name.replace(/\.md$/i, ''));
  }
  return slugs;
}

export function isForeignSidebarFragment(sidebarContent: string, repoName: string): boolean {
  const repo = repoName.toLowerCase();
  if (repo.includes('kb-sync')) return false;
  // Only inspect title/header lines — link labels may mention other products without
  // meaning the whole sidebar was copied from that product.
  const headerLines = sidebarContent
    .split(/\r?\n/)
    .filter((line) => /^(#{1,6}|\*{0,2}#{1,6})\s/.test(line.trim()) || /^(###|####)\s/.test(line))
    .slice(0, 6)
    .join('\n')
    .toLowerCase();
  if (!headerLines.trim()) return false;
  if (headerLines.includes(repo)) return false;
  return FOREIGN_SIDEBAR_MARKERS.some((marker) => headerLines.includes(marker));
}

function compactEmptySidebarSections(content: string): string {
  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isHeader = /^(#{1,6}|\*{0,2}#{1,6})\s/.test(line.trim()) || /^(###|####)\s/.test(line);
    if (!isHeader) {
      out.push(line);
      continue;
    }
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    const next = lines[j];
    const nextIsHeader =
      next !== undefined &&
      (/^(#{1,6}|\*{0,2}#{1,6})\s/.test(next.trim()) || /^(###|####)\s/.test(next));
    const hasLinkBeforeNextHeader = (() => {
      for (let k = i + 1; k < lines.length; k++) {
        const candidate = lines[k];
        if (/^(#{1,6}|\*{0,2}#{1,6})\s/.test(candidate.trim()) || /^(###|####)\s/.test(candidate)) {
          return false;
        }
        if (extractSidebarLinkTarget(candidate)) return true;
      }
      return false;
    })();
    if (!hasLinkBeforeNextHeader && (nextIsHeader || next === undefined)) {
      continue;
    }
    out.push(line);
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '\n');
}

export function sanitizeSidebarContent(
  sidebarContent: string,
  existingPages: Set<string>,
  options: { allowlist?: ReadonlySet<string> | readonly string[]; repoName?: string } = {}
): { content: string; removedTargets: string[]; skippedForeign: boolean } {
  if (options.repoName && isForeignSidebarFragment(sidebarContent, options.repoName)) {
    const removed: string[] = [];
    for (const line of sidebarContent.split(/\r?\n/)) {
      const target = extractSidebarLinkTarget(line);
      if (target) removed.push(target);
    }
    return { content: '', removedTargets: removed, skippedForeign: true };
  }

  const allowlist = options.allowlist
    ? (options.allowlist instanceof Set ? options.allowlist : new Set(options.allowlist))
    : null;
  const removedTargets: string[] = [];
  const kept: string[] = [];

  for (const line of sidebarContent.split(/\r?\n/)) {
    const target = extractSidebarLinkTarget(line);
    if (!target) {
      kept.push(line);
      continue;
    }
    const exists = existingPages.has(target);
    const allowed = !allowlist || allowlist.has(target);
    const blockedForeign =
      !!options.repoName &&
      !options.repoName.toLowerCase().includes('kb-sync') &&
      KB_SYNC_ONLY_SIDEBAR_TARGETS.has(target);
    if (exists && allowed && !blockedForeign) {
      kept.push(line);
    } else {
      removedTargets.push(target);
    }
  }

  return {
    content: compactEmptySidebarSections(kept.join('\n')),
    removedTargets,
    skippedForeign: false,
  };
}

function resolveProductAllowlist(repoName: string): Set<string> | undefined {
  const list = PRODUCT_SIDEBAR_ALLOWLISTS[repoName];
  return list ? new Set(list) : undefined;
}

function generateDefaultSidebar(repoName: string, wikiDir: string, allowlist?: Set<string>): string {
  let sidebar = `### **${repoName} Wiki**\n\n* [[Home]]\n\n---\n\n### **Documentation**\n`;
  const files = fs
    .readdirSync(wikiDir)
    .filter((f: string) => f.endsWith('.md') && !f.startsWith('_') && f !== 'Home.md')
    .sort();
  for (const f of files) {
    const title = f.replace(/\.md$/, '');
    if (allowlist && !allowlist.has(title)) continue;
    sidebar += `* [[${title}]]\n`;
  }
  return sidebar;
}

/**
 * Apply sidebar for a target wiki: never stamp foreign fragments; drop links to
 * pages that are missing (or outside the product allowlist).
 */
export function applyGuardedSidebar(options: {
  repoName: string;
  wikiDir: string;
  sourceSidebarPath?: string;
  curatedSidebarPath?: string;
}): { wrote: boolean; removedTargets: string[]; skippedForeign: boolean; mode: string } {
  const { repoName, wikiDir } = options;
  const sidebarPath = path.join(wikiDir, '_Sidebar.md');
  const allowlist = resolveProductAllowlist(repoName);
  const existingPages = listExistingWikiPageSlugs(wikiDir);

  let candidate = '';
  let mode = 'generate-default';

  if (options.curatedSidebarPath && fs.existsSync(options.curatedSidebarPath)) {
    candidate = fs.readFileSync(options.curatedSidebarPath, 'utf8');
    mode = 'curated-remote';
  } else if (options.sourceSidebarPath && fs.existsSync(options.sourceSidebarPath)) {
    candidate = fs.readFileSync(options.sourceSidebarPath, 'utf8');
    mode = 'source-docs';
  } else if (fs.existsSync(sidebarPath)) {
    candidate = fs.readFileSync(sidebarPath, 'utf8');
    mode = 'existing-dest';
  }

  const sanitized = candidate
    ? sanitizeSidebarContent(candidate, existingPages, { allowlist, repoName })
    : { content: '', removedTargets: [] as string[], skippedForeign: false };

  let finalContent = sanitized.content;
  let finalMode = mode;

  if (!finalContent.trim() || sanitized.skippedForeign) {
    finalContent = generateDefaultSidebar(repoName, wikiDir, allowlist);
    finalMode = sanitized.skippedForeign ? 'skipped-foreign-generated-default' : 'generate-default';
    if (sanitized.skippedForeign) {
      console.warn(
        `[FLEET-RECONCILER] Skipping foreign sidebar fragment for ${repoName}; generating default from local pages only`
      );
    }
  }

  if (sanitized.removedTargets.length > 0) {
    console.warn(
      `[FLEET-RECONCILER] Stripped ${sanitized.removedTargets.length} non-local sidebar link(s) for ${repoName}: ${sanitized.removedTargets.join(', ')}`
    );
  }

  fs.writeFileSync(sidebarPath, finalContent.endsWith('\n') ? finalContent : finalContent + '\n', 'utf8');
  return {
    wrote: true,
    removedTargets: sanitized.removedTargets,
    skippedForeign: sanitized.skippedForeign,
    mode: finalMode,
  };
}

export interface DocCopyResult {
  /** Source documents copied (each counted once, regardless of nested+flat copies). */
  copied: number;
  /** destination-relative path -> sha256 of what was written there */
  written: Record<string, string>;
  flatCollisions: Array<{ basename: string; files: string[]; flatWinner: string | null }>;
}

const DOC_FILE_RE = /\.(md|png|svg|jpg|jpeg|gif|html|mermaid)$/i;

/**
 * Copy documentation trees into the publish checkout.
 *
 * Every file is written at its nested (relative) path. A flat basename copy
 * (for flat GitHub-wiki URLs) is added ONLY when it is unambiguous - previously
 * any two files sharing a basename silently overwrote each other at the root.
 * Later directories in `srcDirs` overlay earlier ones on identical relative paths.
 */
export function copyDocsCollisionSafe(srcDirs: string[], destDir: string): DocCopyResult {
  const files = new Map<string, string>(); // rel(posix) -> absolute source
  for (const srcDir of srcDirs) {
    if (!fs.existsSync(srcDir)) continue;
    const walk = (currentDir: string) => {
      for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
        const fullSrc = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.wiki-publish-temp') continue;
          walk(fullSrc);
        } else if (entry.isFile() && DOC_FILE_RE.test(entry.name)) {
          // Never blindly stamp navigation from a source tree - sidebar is applied
          // via applyGuardedSidebar so foreign kb-sync fragments cannot leak.
          if (entry.name === '_Sidebar.md' || entry.name === '_Footer.md') continue;
          files.set(toPosix(path.relative(srcDir, fullSrc)), fullSrc);
        }
      }
    };
    walk(srcDir);
  }

  const { flat, collisions } = planFlatCopies([...files.keys()]);
  const written: Record<string, string> = {};
  const put = (rel: string, fullSrc: string) => {
    const dest = path.join(destDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(fullSrc, dest);
    written[rel] = sha256File(dest) ?? '';
  };
  for (const [rel, fullSrc] of files) {
    put(rel, fullSrc);
    if (rel.includes('/') && flat.has(rel)) put(path.posix.basename(rel), fullSrc);
  }
  return { copied: files.size, written, flatCollisions: collisions };
}

export interface SyncRepositoryOptions {
  /**
   * Genuinely non-mutating: nothing is written to the repository (no entity pages,
   * manifest, receipt or temp files) and nothing is pushed. The remote is only read,
   * into an OS temp directory.
   */
  dryRun?: boolean;
  force?: boolean;
  /** Override the derived wiki remote (tests use a local bare repository). */
  remoteWikiUrl?: string;
  /** Test seam for the generation stage. */
  synthesize?: typeof synthesizeAllEntities;
}

export function syncRepositoryWiki(repoName: string, repoPath: string, options: SyncRepositoryOptions = {}): FleetRepoSyncResult {
  const remoteWikiUrl = options.remoteWikiUrl || deriveRepoWikiUrl(repoPath, repoName);
  const dryRun = !!options.dryRun;
  const synthesize = options.synthesize || synthesizeAllEntities;

  // REQUIRED stage: a failed generation must stop publication and must never be reported healthy.
  let generation: EntitySynthesisResult;
  try {
    generation = synthesize({
      repoName,
      repoRoot: repoPath,
      targetWikiDir: path.join(repoPath, 'wiki'),
      dryRun,
    });
  } catch (err: any) {
    console.error(`[FLEET-RECONCILER] Entity synthesis FAILED for ${repoName}:`, err);
    return {
      repository: repoName,
      repoPath,
      remoteWikiUrl,
      status: 'FAILED',
      filesPublished: 0,
      stage: 'generation',
      error: `entity synthesis threw: ${String(err?.message || err)}`,
    };
  }
  if (generation.status !== 'OK') {
    const detail = generation.failures.slice(0, 5).map((f) => `${f.file} (${f.stage}: ${f.error})`).join('; ');
    console.error(`[FLEET-RECONCILER] Entity synthesis FAILED for ${repoName}: ${detail}`);
    return {
      repository: repoName,
      repoPath,
      remoteWikiUrl,
      status: 'FAILED',
      filesPublished: 0,
      stage: 'generation',
      error: `entity synthesis failed for ${generation.failures.length} file(s): ${detail}`,
      generation: { kind: generation.generationKind, sourcesHash: generation.sourcesHash },
    };
  }
  const generationPending =
    generation.entitiesGenerated + generation.entitiesUpdated + generation.removed.length + generation.aliasesWritten > 0;

  let docSourceDir = path.join(repoPath, 'wiki');
  if (!fs.existsSync(docSourceDir)) {
    const altDocs = path.join(repoPath, 'docs');
    if (fs.existsSync(altDocs)) {
      docSourceDir = altDocs;
    } else if (!(dryRun && generationPending)) {
      return {
        repository: repoName,
        repoPath,
        remoteWikiUrl,
        status: 'SKIPPED_NO_DOCS',
        filesPublished: 0
      };
    }
  }

  let localCodeHead = '';
  try {
    localCodeHead = execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch {}

  // Dry run keeps every scratch file outside the repository.
  const dryScratch = dryRun ? fs.mkdtempSync(path.join(os.tmpdir(), 'kb-fleet-dry-')) : '';
  const tempPublishDir = dryRun ? path.join(dryScratch, 'wiki') : path.join(repoPath, '.wiki-publish-temp');
  const curatedSidebarBackup = dryRun ? path.join(dryScratch, 'sidebar-curated-backup.md') : path.join(repoPath, '.wiki-sidebar-curated-backup.md');
  const cleanup = () => {
    try {
      if (dryRun) fs.rmSync(dryScratch, { recursive: true, force: true });
      else if (fs.existsSync(tempPublishDir)) fs.rmSync(tempPublishDir, { recursive: true, force: true });
    } catch {}
  };

  try {
    if (!dryRun && fs.existsSync(tempPublishDir)) {
      fs.rmSync(tempPublishDir, { recursive: true, force: true });
    }

    console.log(`[FLEET-RECONCILER] ${dryRun ? '(dry-run) ' : ''}Syncing ${repoName} -> ${remoteWikiUrl}...`);
    execSync(`git clone "${remoteWikiUrl}" "${tempPublishDir}"`, { stdio: ['pipe', 'pipe', 'ignore'], timeout: 30000 });

    // Capture curated remote sidebar before doc copy (copy skips _Sidebar.md).
    const curatedRemoteSidebar = path.join(tempPublishDir, '_Sidebar.md');
    if (fs.existsSync(curatedRemoteSidebar)) {
      fs.copyFileSync(curatedRemoteSidebar, curatedSidebarBackup);
    } else if (fs.existsSync(curatedSidebarBackup)) {
      fs.rmSync(curatedSidebarBackup, { force: true });
    }

    // Also copy docs/ if wiki/ was primary
    const docsExtra = path.join(repoPath, 'docs');
    const docDirs = [docSourceDir];
    if (docSourceDir !== docsExtra && fs.existsSync(docsExtra)) docDirs.push(docsExtra);
    const copy = copyDocsCollisionSafe(docDirs, tempPublishDir);
    const filesCopied = copy.copied;
    if (copy.flatCollisions.length > 0) {
      console.warn(
        `[FLEET-RECONCILER] ${repoName}: ${copy.flatCollisions.length} basename collision(s); flat copies skipped for ambiguous names (nested paths published): ` +
          copy.flatCollisions.slice(0, 5).map((c) => c.basename).join(', ')
      );
    }

    // Reconcile pages this publisher wrote earlier but no longer produces. Only files recorded in the
    // previous publish manifest AND still byte-identical are removed; anything else is left alone.
    const manifestPath = path.join(tempPublishDir, PUBLISH_MANIFEST_NAME);
    const removal = planOwnedRemovals({
      baseDir: tempPublishDir,
      previous: readOwnershipManifest(manifestPath),
      keep: new Set(Object.keys(copy.written)),
    });
    const removedStale = applyOwnedRemovals(tempPublishDir, removal);
    if (removal.preservedModified.length > 0) {
      console.warn(`[FLEET-RECONCILER] ${repoName}: kept ${removal.preservedModified.length} previously published page(s) edited on the remote: ${removal.preservedModified.slice(0, 5).join(', ')}`);
    }
    const publishManifest: Record<string, { sha256: string }> = {};
    for (const rel of Object.keys(copy.written).sort()) publishManifest[rel] = { sha256: copy.written[rel] };
    writeJsonAtomic(manifestPath, { version: 1, generator: 'fleet-wiki-reconciler', repository: repoName, files: publishManifest });

    // Preserve curated Home.md if present, else fallback to README
    const homePath = path.join(tempPublishDir, 'Home.md');
    if (!fs.existsSync(homePath)) {
      const sourceHome = path.join(docSourceDir, 'Home.md');
      const readmePath = path.join(repoPath, 'README.md');
      let homeContent = '';
      if (fs.existsSync(sourceHome)) {
        homeContent = fs.readFileSync(sourceHome, 'utf8');
      } else if (fs.existsSync(readmePath)) {
        homeContent = fs.readFileSync(readmePath, 'utf8');
      } else {
        homeContent = `# ${repoName} Documentation Wiki\n\nWelcome to the official documentation for **${repoName}**.`;
      }
      homeContent += `\n\n---\n*Last Synchronized: ${new Date().toISOString()} - Fleet Reconciler*\n`;
      fs.writeFileSync(homePath, homeContent, 'utf8');
    }

    const sourceSidebar = path.join(docSourceDir, '_Sidebar.md');
    applyGuardedSidebar({
      repoName,
      wikiDir: tempPublishDir,
      sourceSidebarPath: fs.existsSync(sourceSidebar) ? sourceSidebar : undefined,
      curatedSidebarPath: fs.existsSync(curatedSidebarBackup) ? curatedSidebarBackup : undefined,
    });
    if (fs.existsSync(curatedSidebarBackup)) {
      try { fs.rmSync(curatedSidebarBackup, { force: true }); } catch {}
    }

    const footerPath = path.join(tempPublishDir, '_Footer.md');
    fs.writeFileSync(footerPath, `---\n*Automated Fleet Wiki Sync - Generated at ${new Date().toISOString()}*`, 'utf8');

    execSync('git add -A', { cwd: tempPublishDir, stdio: ['pipe', 'pipe', 'ignore'] });
    const status = execSync('git status --porcelain', { cwd: tempPublishDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    // _Footer.md embeds a timestamp, so ignore it when deciding whether real content changed.
    const pendingContent = status.split(/\r?\n/).filter((l) => l.trim() && !/_Footer\.md$/.test(l.trim())).length > 0;

    let remoteWikiHead = '';
    let syncStatus: FleetRepoSyncResult['status'] = 'UP_TO_DATE';

    if (dryRun) {
      // A dry run never claims the wiki is current while changes are pending.
      syncStatus = pendingContent || generationPending ? 'DRY_RUN_PENDING' : 'UP_TO_DATE';
      console.log(`[FLEET-RECONCILER] (dry-run) ${repoName}: ${syncStatus}; nothing pushed, no receipt written`);
    } else if (pendingContent) {
      execSync(`git commit -m "docs(wiki): automated fleet reconciliation for ${repoName}"`, { cwd: tempPublishDir, stdio: ['pipe', 'pipe', 'ignore'] });
      execSync('git push origin HEAD', { cwd: tempPublishDir, stdio: ['pipe', 'pipe', 'ignore'], timeout: 30000 });
      syncStatus = 'SYNCHRONIZED';
      console.log(`[FLEET-RECONCILER] Pushed updates for ${repoName}`);
    } else {
      console.log(`[FLEET-RECONCILER] ${repoName} wiki is already up to date`);
    }

    try {
      remoteWikiHead = execSync('git rev-parse HEAD', { cwd: tempPublishDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    } catch {}

    if (!dryRun) {
      // Verify against the remote itself: the receipt must name a head the remote actually has.
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: tempPublishDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
      let remoteSeen = '';
      try {
        remoteSeen = execSync(`git ls-remote origin "refs/heads/${branch}"`, { cwd: tempPublishDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 30000 })
          .trim()
          .split(/\s+/)[0] || '';
      } catch {}
      if (!remoteWikiHead || remoteSeen !== remoteWikiHead) {
        throw new Error(`publication not verified: local wiki head ${remoteWikiHead || '<none>'} != remote head ${remoteSeen || '<none>'}`);
      }
    }

    if (!dryRun) {
      // Emit receipt (only after the remote head was verified above).
      const receipt = {
        repository: repoName,
        remote_wiki_url: remoteWikiUrl,
        local_code_head: localCodeHead,
        remote_wiki_head: remoteWikiHead,
        verified_at: new Date().toISOString(),
        system_time_epoch_ms: Date.now(),
        total_pages_published: filesCopied,
        sync_status: syncStatus,
        source_inputs_hash: generation.sourcesHash,
        generation_kind: generation.generationKind,
        semantic_regeneration: false,
        flat_name_collisions: copy.flatCollisions.length,
        stale_pages_removed: removedStale
      };
      fs.writeFileSync(path.join(repoPath, '.wiki-sync-receipt.json'), JSON.stringify(receipt, null, 2), 'utf8');
    }

    cleanup();

    return {
      repository: repoName,
      repoPath,
      remoteWikiUrl,
      status: syncStatus,
      filesPublished: filesCopied,
      remoteWikiHead,
      localCodeHead,
      generation: { kind: generation.generationKind, sourcesHash: generation.sourcesHash },
      flatCollisions: copy.flatCollisions.length,
      staleRemoved: removedStale
    };
  } catch (err: any) {
    console.warn(`[FLEET-RECONCILER] Warning: Failed to sync ${repoName}: ${err.message}`);
    cleanup();

    return {
      repository: repoName,
      repoPath,
      remoteWikiUrl,
      status: 'FAILED',
      filesPublished: 0,
      stage: 'publication',
      error: err.message
    };
  }
}

export function reconcileFleetWikis(options: { repoList?: string[]; dryRun?: boolean; outputPath?: string } = {}): FleetReconcileReport {
  const repoList = options.repoList || Object.keys(CANONICAL_REPOSITORIES);
  const results: FleetRepoSyncResult[] = [];

  let synchronizedCount = 0;
  let upToDateCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let dryRunPendingCount = 0;
  let totalFilesPublished = 0;

  for (const repoName of repoList) {
    const entry = CANONICAL_REPOSITORIES[repoName];
    const targetPath = entry ? entry.canonicalPath : path.resolve(REPO_ROOT, '..', repoName);
    if (!fs.existsSync(targetPath)) {
      results.push({
        repository: repoName,
        repoPath: targetPath,
        remoteWikiUrl: `git@github.com:sorensencc-dotcom/${repoName}.wiki.git`,
        status: 'FAILED',
        filesPublished: 0,
        error: 'Repository directory does not exist'
      });
      failedCount++;
      continue;
    }

    const result = syncRepositoryWiki(repoName, targetPath, options);
    results.push(result);

    if (result.status === 'SYNCHRONIZED') {
      synchronizedCount++;
      totalFilesPublished += result.filesPublished;
    } else if (result.status === 'UP_TO_DATE') {
      upToDateCount++;
      totalFilesPublished += result.filesPublished;
    } else if (result.status === 'SKIPPED_NO_DOCS') {
      skippedCount++;
    } else if (result.status === 'FAILED') {
      failedCount++;
    } else if (result.status === 'DRY_RUN_PENDING') {
      dryRunPendingCount++;
    }
  }

  let overallStatus: FleetReconcileReport['overall_status'] = 'SUCCESS';
  if (failedCount > 0) {
    overallStatus = synchronizedCount > 0 || upToDateCount > 0 ? 'PARTIAL' : 'FAILED';
  } else if (dryRunPendingCount > 0) {
    // A dry run that found pending work is not a clean fleet.
    overallStatus = 'PARTIAL';
  }

  const report: FleetReconcileReport = {
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    system_time_epoch_ms: Date.now(),
    overall_status: overallStatus,
    repositories: results,
    summary: {
      total_repositories: results.length,
      synchronized_count: synchronizedCount,
      up_to_date_count: upToDateCount,
      skipped_count: skippedCount,
      failed_count: failedCount,
      dry_run_pending_count: dryRunPendingCount,
      total_files_published: totalFilesPublished
    }
  };

  // A dry run must not mutate the repository: only write the report when a path was given explicitly.
  const outputPath = options.outputPath || (options.dryRun ? '' : path.join(REPO_ROOT, '.fleet-wiki-sync-report.json'));
  if (outputPath) {
    try {
      fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
    } catch {}
  }

  return report;
}

if (process.argv[1] && process.argv[1].endsWith('fleet-wiki-reconciler.ts')) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const report = reconcileFleetWikis({ dryRun });
  console.log(`[FLEET-RECONCILER] Finished: status=${report.overall_status} synchronized=${report.summary.synchronized_count} up_to_date=${report.summary.up_to_date_count} failed=${report.summary.failed_count}`);
  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  }
}
