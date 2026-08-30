import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

export interface CanonicalRepoEntry {
  name: string;
  canonicalPath: string;
  declaredDriftCommand?: string;
}

export const CANONICAL_REPOSITORIES: Record<string, CanonicalRepoEntry> = {
  'kb-sync': { name: 'kb-sync', canonicalPath: 'C:\\dev\\kb-sync', declaredDriftCommand: 'kb:drift' },
  'rewrite-docs': { name: 'rewrite-docs', canonicalPath: 'C:\\dev\\rewrite-docs' },
  'rewrite-mcp': { name: 'rewrite-mcp', canonicalPath: 'C:\\dev\\rewrite-mcp' },
  'trm': { name: 'trm', canonicalPath: 'C:\\dev\\trm' },
  'cic-ingestion': { name: 'cic-ingestion', canonicalPath: 'C:\\dev\\cic-ingestion' },
  'claude-skills': { name: 'claude-skills', canonicalPath: 'C:\\dev\\claude-skills' },
  'charlie-deep-research': { name: 'charlie-deep-research', canonicalPath: 'C:\\dev\\charlie-deep-research' },
};

export const DISALLOWED_DIR_PATTERNS = [
  'dev-sandbox',
  '.claude/worktrees',
  '.claude\\worktrees',
  '_kb-sync-staging',
  'node_modules',
  '.tmp'
];

export function isDisallowedPath(targetPath: string): boolean {
  const normalized = targetPath.replace(/\//g, '\\');
  return DISALLOWED_DIR_PATTERNS.some(pat => normalized.includes(pat));
}

export interface RepoScanResult {
  repository: string;
  path: string;
  isCanonical: boolean;
  exists: boolean;
  status: 'NO_DRIFT' | 'DRIFT_DETECTED' | 'APPLIED' | 'PARTIAL' | 'BLOCKED' | 'DEGRADED' | 'UNAVAILABLE';
  telemetry_source: 'NATIVE_DRIFT_TELEMETRY' | 'FALLBACK_GIT_INSPECTION' | 'UNAVAILABLE';
  timestamp?: string;
  system_time_epoch_ms?: number;
  sources_checked: number;
  stale_pages_count: number;
  dirty_worktree_count: number;
  violations: string[];
}

export interface CrossRepoDriftReport {
  version: string;
  timestamp: string;
  system_time_epoch_ms: number;
  overall_status: 'CLEAN' | 'DRIFT_DETECTED' | 'DEGRADED' | 'BLOCKED';
  repositories: RepoScanResult[];
  summary: {
    total_repositories: number;
    clean_repositories: number;
    drifted_repositories: number;
    degraded_repositories: number;
    total_stale_pages: number;
    total_dirty_worktrees: number;
    canonical_coverage_count: number;
  };
}

export interface ScannerOptions {
  baseDir?: string;
  repoList?: string[];
  customPathMap?: Record<string, string>;
  useSelfForKbSync?: boolean;
  allowDisallowedPaths?: boolean;
  executeSubCommands?: boolean;
  maxSkewMs?: number;
  outputPath?: string;
}

export function validateIsoUtcTimestamp(timestamp: string, maxSkewMs: number = 60000): { valid: boolean; reason?: string } {
  if (!timestamp || typeof timestamp !== 'string') {
    return { valid: false, reason: 'Timestamp is missing or not a string' };
  }
  const parsed = Date.parse(timestamp);
  if (isNaN(parsed)) {
    return { valid: false, reason: 'Timestamp is not a valid ISO date' };
  }
  if (parsed > Date.now() + maxSkewMs) {
    return { valid: false, reason: `Timestamp is future-dated (${timestamp} > current time + ${maxSkewMs}ms skew tolerance)` };
  }
  return { valid: true };
}

export function resolveRepoPath(repoName: string, options: ScannerOptions = {}): { path: string; isCanonical: boolean } {
  if (options.customPathMap && options.customPathMap[repoName]) {
    const custom = options.customPathMap[repoName];
    return { path: custom, isCanonical: custom.toLowerCase() === CANONICAL_REPOSITORIES[repoName]?.canonicalPath.toLowerCase() };
  }

  if (repoName === 'kb-sync' && options.useSelfForKbSync) {
    return { path: REPO_ROOT, isCanonical: false };
  }

  if (options.baseDir) {
    const candidate = path.resolve(options.baseDir, repoName);
    const isCanonical = candidate.toLowerCase() === CANONICAL_REPOSITORIES[repoName]?.canonicalPath.toLowerCase();
    return { path: candidate, isCanonical };
  }

  if (CANONICAL_REPOSITORIES[repoName]) {
    return { path: CANONICAL_REPOSITORIES[repoName].canonicalPath, isCanonical: true };
  }

  const fallback = path.resolve(REPO_ROOT, '..', repoName);
  return { path: fallback, isCanonical: false };
}

export function scanRepository(repoName: string, repoPath: string, options: ScannerOptions = {}): RepoScanResult {
  const { executeSubCommands = false, maxSkewMs = 60000, allowDisallowedPaths = false } = options;
  const violations: string[] = [];
  const canonicalEntry = CANONICAL_REPOSITORIES[repoName];
  const isCanonical = canonicalEntry ? repoPath.toLowerCase() === canonicalEntry.canonicalPath.toLowerCase() : false;

  if (!allowDisallowedPaths && isDisallowedPath(repoPath)) {
    violations.push('DISALLOWED_PATH_SANDBOX_OR_WORKTREE');
    return {
      repository: repoName,
      path: repoPath,
      isCanonical: false,
      exists: fs.existsSync(repoPath),
      status: 'BLOCKED',
      telemetry_source: 'UNAVAILABLE',
      sources_checked: 0,
      stale_pages_count: 0,
      dirty_worktree_count: 0,
      violations
    };
  }

  if (!fs.existsSync(repoPath)) {
    return {
      repository: repoName,
      path: repoPath,
      isCanonical,
      exists: false,
      status: 'UNAVAILABLE',
      telemetry_source: 'UNAVAILABLE',
      sources_checked: 0,
      stale_pages_count: 0,
      dirty_worktree_count: 0,
      violations: ['REPOSITORY_DIRECTORY_NOT_FOUND']
    };
  }

  // Check dirty worktree via Git
  let dirtyWorktreeCount = 0;
  try {
    const gitStatus = execSync('git status --porcelain', { cwd: repoPath, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = gitStatus.split(/\r?\n/).filter(l => l.trim().length > 0);
    dirtyWorktreeCount = lines.length;
    if (dirtyWorktreeCount > 0) {
      violations.push(`DIRTY_WORKTREE (${dirtyWorktreeCount} uncommitted/untracked files)`);
    }
  } catch {
    violations.push('GIT_UNAVAILABLE_OR_NOT_A_REPO');
  }

  // Check declared drift command from package.json
  let driftScript: string | null = null;
  const pkgPath = path.join(repoPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.scripts) {
        if (pkg.scripts['kb:drift']) driftScript = 'kb:drift';
        else if (pkg.scripts['drift:check']) driftScript = 'drift:check';
        else if (pkg.scripts['drift:detect']) driftScript = 'drift:detect';
        else if (pkg.scripts['drift']) driftScript = 'drift';
      }
    } catch {
      violations.push('MALFORMED_PACKAGE_JSON');
    }
  }

  if (executeSubCommands && driftScript) {
    try {
      execSync(`npm run ${driftScript}`, { cwd: repoPath, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 30000 });
    } catch {
      violations.push(`EXECUTION_FAILED_FOR_SCRIPT (${driftScript})`);
    }
  }

  // Check for native .drift-report.json
  const driftReportPath = path.join(repoPath, '.drift-report.json');
  if (fs.existsSync(driftReportPath)) {
    try {
      const rawReport = JSON.parse(fs.readFileSync(driftReportPath, 'utf8'));
      const tsCheck = validateIsoUtcTimestamp(rawReport.timestamp, maxSkewMs);
      if (!tsCheck.valid) {
        violations.push(`INVALID_TIMESTAMP: ${tsCheck.reason}`);
      }

      const sourcesChecked = rawReport.summary?.total_sources_checked ?? (Array.isArray(rawReport.drifted_sources) ? rawReport.drifted_sources.length : 0);
      const stalePages = rawReport.summary?.stale_pages_count ?? (Array.isArray(rawReport.drifted_sources) ? rawReport.drifted_sources.length : 0);

      let status: RepoScanResult['status'] = 'NO_DRIFT';
      if (rawReport.status === 'DRIFT_DETECTED' || stalePages > 0) {
        status = 'DRIFT_DETECTED';
      } else if (rawReport.status === 'APPLIED') {
        status = 'APPLIED';
      } else if (rawReport.status === 'PARTIAL') {
        status = 'PARTIAL';
      } else if (rawReport.status === 'BLOCKED') {
        status = 'BLOCKED';
      }

      return {
        repository: repoName,
        path: repoPath,
        isCanonical,
        exists: true,
        status,
        telemetry_source: 'NATIVE_DRIFT_TELEMETRY',
        timestamp: rawReport.timestamp,
        system_time_epoch_ms: rawReport.system_time_epoch_ms || (rawReport.timestamp ? Date.parse(rawReport.timestamp) : undefined),
        sources_checked: sourcesChecked,
        stale_pages_count: stalePages,
        dirty_worktree_count: dirtyWorktreeCount,
        violations
      };
    } catch {
      violations.push('MALFORMED_DRIFT_REPORT_JSON');
    }
  }

  // Fallback Git inspection: clearly separate from native drift telemetry
  violations.push('MISSING_NATIVE_DRIFT_TELEMETRY');
  return {
    repository: repoName,
    path: repoPath,
    isCanonical,
    exists: true,
    status: 'DEGRADED',
    telemetry_source: 'FALLBACK_GIT_INSPECTION',
    timestamp: new Date().toISOString(),
    system_time_epoch_ms: Date.now(),
    sources_checked: 0,
    stale_pages_count: 0,
    dirty_worktree_count: dirtyWorktreeCount,
    violations
  };
}

export function scanCrossRepoDrift(options: ScannerOptions = {}): CrossRepoDriftReport {
  const repoList = options.repoList || Object.keys(CANONICAL_REPOSITORIES);

  const results: RepoScanResult[] = [];
  let totalStalePages = 0;
  let totalDirtyWorktrees = 0;
  let cleanRepos = 0;
  let driftedRepos = 0;
  let degradedRepos = 0;
  let blockedRepos = 0;
  let canonicalCoverageCount = 0;

  for (const repoName of repoList) {
    const { path: resolvedPath, isCanonical } = resolveRepoPath(repoName, options);
    const result = scanRepository(repoName, resolvedPath, options);
    results.push(result);

    if (result.isCanonical) canonicalCoverageCount++;
    totalStalePages += result.stale_pages_count;
    totalDirtyWorktrees += result.dirty_worktree_count;

    if (result.status === 'DRIFT_DETECTED') {
      driftedRepos++;
    } else if (result.status === 'BLOCKED') {
      blockedRepos++;
    } else if (result.status === 'DEGRADED' || result.status === 'UNAVAILABLE' || result.violations.some(v => v.startsWith('INVALID_TIMESTAMP') || v.includes('MISSING_NATIVE_DRIFT_TELEMETRY'))) {
      degradedRepos++;
    } else if (result.status === 'NO_DRIFT' || result.status === 'APPLIED') {
      cleanRepos++;
    }
  }

  let overallStatus: CrossRepoDriftReport['overall_status'] = 'CLEAN';
  if (blockedRepos > 0) {
    overallStatus = 'BLOCKED';
  } else if (driftedRepos > 0) {
    overallStatus = 'DRIFT_DETECTED';
  } else if (degradedRepos > 0) {
    overallStatus = 'DEGRADED';
  }

  const now = new Date();
  const report: CrossRepoDriftReport = {
    version: '1.1.0',
    timestamp: now.toISOString(),
    system_time_epoch_ms: now.getTime(),
    overall_status: overallStatus,
    repositories: results,
    summary: {
      total_repositories: results.length,
      clean_repositories: cleanRepos,
      drifted_repositories: driftedRepos,
      degraded_repositories: degradedRepos,
      total_stale_pages: totalStalePages,
      total_dirty_worktrees: totalDirtyWorktrees,
      canonical_coverage_count: canonicalCoverageCount
    }
  };

  const outputPath = options.outputPath || path.join(REPO_ROOT, '.cross-repo-drift-report.json');
  try {
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
  } catch {}

  return report;
}

// CLI handler
if (process.argv[1] && process.argv[1].endsWith('cross-repo-drift-scanner.ts')) {
  const args = process.argv.slice(2);
  const options: ScannerOptions = {
    executeSubCommands: false
  };

  let exitZeroOnDrift = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--execute-checks') options.executeSubCommands = true;
    else if (args[i] === '--exit-zero' || args[i] === '--allow-drift') exitZeroOnDrift = true;
    else if (args[i] === '--use-self') options.useSelfForKbSync = true;
    else if (args[i] === '--allow-sandbox') options.allowDisallowedPaths = true;
    else if (args[i] === '--base-dir' && args[i + 1]) {
      options.baseDir = args[i + 1];
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      options.outputPath = args[i + 1];
      i++;
    }
  }

  const report = scanCrossRepoDrift(options);
  console.log(`[CROSS-REPO-DRIFT] overall_status=${report.overall_status} repos_checked=${report.summary.total_repositories} canonical_coverage=${report.summary.canonical_coverage_count}/${report.summary.total_repositories} drifted=${report.summary.drifted_repositories} degraded=${report.summary.degraded_repositories} dirty_worktrees=${report.summary.total_dirty_worktrees}`);
  
  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  }

  if (!exitZeroOnDrift && report.overall_status !== 'CLEAN') {
    process.exit(1);
  }
}
