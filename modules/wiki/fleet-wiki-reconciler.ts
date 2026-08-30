import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { CANONICAL_REPOSITORIES } from './cross-repo-drift-scanner.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

export interface FleetRepoSyncResult {
  repository: string;
  repoPath: string;
  remoteWikiUrl: string;
  status: 'SYNCHRONIZED' | 'UP_TO_DATE' | 'SKIPPED_NO_DOCS' | 'FAILED';
  filesPublished: number;
  remoteWikiHead?: string;
  localCodeHead?: string;
  error?: string;
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

function copyFlatAndPreserve(srcDir: string, destDir: string): number {
  if (!fs.existsSync(srcDir)) return 0;
  let copied = 0;

  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullSrc = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.wiki-publish-temp') continue;
        walk(fullSrc);
      } else if (entry.isFile() && /\.(md|png|svg|jpg|jpeg|gif|html|mermaid)$/i.test(entry.name)) {
        const flatDest = path.join(destDir, entry.name);
        fs.copyFileSync(fullSrc, flatDest);

        const relPath = path.relative(srcDir, fullSrc);
        const nestedDest = path.join(destDir, relPath);
        fs.mkdirSync(path.dirname(nestedDest), { recursive: true });
        fs.copyFileSync(fullSrc, nestedDest);

        copied += 1;
      }
    }
  }

  walk(srcDir);
  return copied;
}

export function syncRepositoryWiki(repoName: string, repoPath: string, options: { dryRun?: boolean; force?: boolean } = {}): FleetRepoSyncResult {
  const remoteWikiUrl = deriveRepoWikiUrl(repoPath, repoName);
  const tempPublishDir = path.join(repoPath, '.wiki-publish-temp');

  let docSourceDir = path.join(repoPath, 'wiki');
  if (!fs.existsSync(docSourceDir)) {
    const altDocs = path.join(repoPath, 'docs');
    if (fs.existsSync(altDocs)) {
      docSourceDir = altDocs;
    } else {
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

  try {
    if (fs.existsSync(tempPublishDir)) {
      fs.rmSync(tempPublishDir, { recursive: true, force: true });
    }

    console.log(`[FLEET-RECONCILER] Syncing ${repoName} -> ${remoteWikiUrl}...`);
    execSync(`git clone "${remoteWikiUrl}" "${tempPublishDir}"`, { stdio: ['pipe', 'pipe', 'ignore'], timeout: 30000 });

    const filesCopied = copyFlatAndPreserve(docSourceDir, tempPublishDir);

    // Navigation templates
    const homePath = path.join(tempPublishDir, 'Home.md');
    if (!fs.existsSync(homePath)) {
      const readmePath = path.join(repoPath, 'README.md');
      const homeContent = fs.existsSync(readmePath)
        ? fs.readFileSync(readmePath, 'utf8')
        : `# ${repoName} Documentation Wiki\n\nWelcome to the official documentation for **${repoName}**.`;
      fs.writeFileSync(homePath, homeContent, 'utf8');
    }

    const sidebarPath = path.join(tempPublishDir, '_Sidebar.md');
    if (!fs.existsSync(sidebarPath)) {
      let sidebar = `### ${repoName} Wiki\n- [[Home]]\n\n#### Navigation\n`;
      const entries = fs.readdirSync(docSourceDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith('.md') && e.name !== 'Home.md') {
          const title = e.name.replace(/\.md$/, '');
          sidebar += `- [[${title}]]\n`;
        }
      }
      fs.writeFileSync(sidebarPath, sidebar, 'utf8');
    }

    const footerPath = path.join(tempPublishDir, '_Footer.md');
    fs.writeFileSync(footerPath, `---\n*Automated Fleet Wiki Sync • Generated at ${new Date().toISOString()}*`, 'utf8');

    execSync('git add -A', { cwd: tempPublishDir, stdio: ['pipe', 'pipe', 'ignore'] });
    const status = execSync('git status --porcelain', { cwd: tempPublishDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();

    let remoteWikiHead = '';
    let syncStatus: FleetRepoSyncResult['status'] = 'UP_TO_DATE';

    if (status && !options.dryRun) {
      execSync(`git commit -m "docs(wiki): automated fleet reconciliation for ${repoName}"`, { cwd: tempPublishDir, stdio: ['pipe', 'pipe', 'ignore'] });
      execSync('git push origin HEAD', { cwd: tempPublishDir, stdio: ['pipe', 'pipe', 'ignore'], timeout: 30000 });
      syncStatus = 'SYNCHRONIZED';
      console.log(`[FLEET-RECONCILER] ✓ Successfully pushed updates for ${repoName}`);
    } else if (!status) {
      console.log(`[FLEET-RECONCILER] ✓ ${repoName} wiki is already up to date`);
    }

    try {
      remoteWikiHead = execSync('git rev-parse HEAD', { cwd: tempPublishDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    } catch {}

    // Emit receipt
    const receipt = {
      repository: repoName,
      remote_wiki_url: remoteWikiUrl,
      local_code_head: localCodeHead,
      remote_wiki_head: remoteWikiHead,
      verified_at: new Date().toISOString(),
      system_time_epoch_ms: Date.now(),
      total_pages_published: filesCopied,
      sync_status: syncStatus
    };
    fs.writeFileSync(path.join(repoPath, '.wiki-sync-receipt.json'), JSON.stringify(receipt, null, 2), 'utf8');

    // Clean up temporary clone
    try {
      fs.rmSync(tempPublishDir, { recursive: true, force: true });
    } catch {}

    return {
      repository: repoName,
      repoPath,
      remoteWikiUrl,
      status: syncStatus,
      filesPublished: filesCopied,
      remoteWikiHead,
      localCodeHead
    };
  } catch (err: any) {
    console.warn(`[FLEET-RECONCILER] ⚠️ Warning: Failed to sync ${repoName}: ${err.message}`);
    // Clean up temporary clone on failure
    try {
      if (fs.existsSync(tempPublishDir)) fs.rmSync(tempPublishDir, { recursive: true, force: true });
    } catch {}

    return {
      repository: repoName,
      repoPath,
      remoteWikiUrl,
      status: 'FAILED',
      filesPublished: 0,
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
    }
  }

  let overallStatus: FleetReconcileReport['overall_status'] = 'SUCCESS';
  if (failedCount > 0) {
    overallStatus = synchronizedCount > 0 || upToDateCount > 0 ? 'PARTIAL' : 'FAILED';
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
      total_files_published: totalFilesPublished
    }
  };

  const outputPath = options.outputPath || path.join(REPO_ROOT, '.fleet-wiki-sync-report.json');
  try {
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
  } catch {}

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
