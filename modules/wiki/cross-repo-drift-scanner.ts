import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

export interface RepoScanResult {
  repository: string;
  path: string;
  exists: boolean;
  status: 'NO_DRIFT' | 'DRIFT_DETECTED' | 'APPLIED' | 'PARTIAL' | 'BLOCKED' | 'UNAVAILABLE';
  telemetry_source: 'DRIFT_REPORT' | 'FALLBACK_GIT' | 'UNAVAILABLE';
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
  };
}

export interface ScannerOptions {
  baseDir?: string;
  repoList?: string[];
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

export function scanRepository(repoName: string, repoPath: string, options: ScannerOptions = {}): RepoScanResult {
  const { executeSubCommands = false, maxSkewMs = 60000 } = options;
  const violations: string[] = [];

  if (!fs.existsSync(repoPath)) {
    return {
      repository: repoName,
      path: repoPath,
      exists: false,
      status: 'UNAVAILABLE',
      telemetry_source: 'UNAVAILABLE',
      sources_checked: 0,
      stale_pages_count: 0,
      dirty_worktree_count: 0,
      violations: ['REPOSITORY_DIRECTORY_NOT_FOUND']
    };
  }

  // Check dirty worktree
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

  // Look for package.json and drift scripts
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

  // Check for .drift-report.json
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
        exists: true,
        status,
        telemetry_source: 'DRIFT_REPORT',
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

  // Fallback telemetry when no .drift-report.json exists
  violations.push('MISSING_DRIFT_TELEMETRY');
  return {
    repository: repoName,
    path: repoPath,
    exists: true,
    status: dirtyWorktreeCount > 0 ? 'PARTIAL' : 'NO_DRIFT',
    telemetry_source: 'FALLBACK_GIT',
    timestamp: new Date().toISOString(),
    system_time_epoch_ms: Date.now(),
    sources_checked: 0,
    stale_pages_count: 0,
    dirty_worktree_count: dirtyWorktreeCount,
    violations
  };
}

export function scanCrossRepoDrift(options: ScannerOptions = {}): CrossRepoDriftReport {
  const baseDir = options.baseDir || path.resolve(REPO_ROOT, '..');
  const defaultRepos = ['kb-sync', 'rewrite-docs', 'rewrite-mcp', 'trm', 'cic-ingestion', 'claude-skills', 'charlie-deep-research'];
  const repoList = options.repoList || defaultRepos;

  const results: RepoScanResult[] = [];
  let totalStalePages = 0;
  let totalDirtyWorktrees = 0;
  let cleanRepos = 0;
  let driftedRepos = 0;
  let degradedRepos = 0;

  for (const repoName of repoList) {
    const repoPath = repoName === 'kb-sync' ? REPO_ROOT : path.join(baseDir, repoName);
    const result = scanRepository(repoName, repoPath, options);
    results.push(result);

    totalStalePages += result.stale_pages_count;
    totalDirtyWorktrees += result.dirty_worktree_count;

    if (result.status === 'DRIFT_DETECTED') {
      driftedRepos++;
    } else if (result.status === 'UNAVAILABLE' || result.violations.some(v => v.startsWith('INVALID_TIMESTAMP') || v === 'MISSING_DRIFT_TELEMETRY')) {
      degradedRepos++;
    } else if (result.status === 'NO_DRIFT' || result.status === 'APPLIED') {
      cleanRepos++;
    }
  }

  let overallStatus: CrossRepoDriftReport['overall_status'] = 'CLEAN';
  if (driftedRepos > 0) {
    overallStatus = 'DRIFT_DETECTED';
  } else if (degradedRepos > 0) {
    overallStatus = 'DEGRADED';
  }

  const now = new Date();
  const report: CrossRepoDriftReport = {
    version: '1.0.0',
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
      total_dirty_worktrees: totalDirtyWorktrees
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

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--execute-checks') options.executeSubCommands = true;
    else if (args[i] === '--base-dir' && args[i + 1]) {
      options.baseDir = args[i + 1];
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      options.outputPath = args[i + 1];
      i++;
    }
  }

  const report = scanCrossRepoDrift(options);
  console.log(`[CROSS-REPO-DRIFT] overall_status=${report.overall_status} repos_checked=${report.summary.total_repositories} drifted=${report.summary.drifted_repositories} degraded=${report.summary.degraded_repositories} dirty_worktrees=${report.summary.total_dirty_worktrees}`);
  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  }
}
