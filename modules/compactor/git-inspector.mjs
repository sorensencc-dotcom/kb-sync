import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { normalizeRepoPath } from './path-utils.mjs';

/**
 * Computes 12-char SHA-256 content hash of file content on disk.
 * @param {string} fullPath 
 * @returns {string} 12-character truncated content hash
 */
export function getFileContentHash(fullPath) {
  try {
    const buffer = fs.readFileSync(fullPath);
    return crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 12);
  } catch (_) {
    return 'unknown-hash';
  }
}

/**
 * Parses git status -z including rename (R) and copy (C) source and target pairs.
 * @param {string} repoRoot 
 * @returns {Set<string>|null} Set of normalized relative dirty paths, or null on execution error
 */
export function getGitDirtyFiles(repoRoot) {
  try {
    const output = execFileSync('git', ['status', '--porcelain', '-z'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      maxBuffer: 10 * 1024 * 1024
    });

    const dirtyFiles = new Set();
    const tokens = output.split('\0');
    let i = 0;

    while (i < tokens.length) {
      const token = tokens[i];
      if (!token) { i++; continue; }
      
      const statusCode = token.slice(0, 2);
      const filePath = token.slice(3);

      if (filePath) {
        try { dirtyFiles.add(normalizeRepoPath(filePath, repoRoot)); } catch (_) {}
      }

      // Renames (R) and Copies (C) emit a second NUL-terminated token containing the target path
      if (statusCode.includes('R') || statusCode.includes('C')) {
        i++;
        if (i < tokens.length && tokens[i]) {
          try { dirtyFiles.add(normalizeRepoPath(tokens[i], repoRoot)); } catch (_) {}
        }
      }
      i++;
    }

    return dirtyFiles;
  } catch (err) {
    return null; // Fail-Closed: Return null to force ALL files to Full
  }
}

/**
 * Bulk fetches all files modified within recent N days in ONE single Git log call.
 * @param {string} repoRoot 
 * @param {number} windowDays 
 * @returns {Set<string>|null} Set of normalized relative recently modified paths, or null on error
 */
export function getBulkRecentlyModifiedFiles(repoRoot, windowDays) {
  if (windowDays === 0) return new Set();

  try {
    const sinceDate = `${windowDays} days ago`;
    const output = execFileSync('git', ['log', `--since=${sinceDate}`, '--name-only', '--format=', '-z'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      maxBuffer: 20 * 1024 * 1024
    });

    const recentFiles = new Set();
    const paths = output.split('\0').filter(Boolean);
    for (const p of paths) {
      try { recentFiles.add(normalizeRepoPath(p, repoRoot)); } catch (_) {}
    }
    return recentFiles;
  } catch (err) {
    return null; // Fail-Closed: Force all to Full if git log fails
  }
}
