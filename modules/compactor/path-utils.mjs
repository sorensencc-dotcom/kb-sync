import path from 'node:path';
import fs from 'node:fs';

/**
 * Normalizes a repository path and verifies that symlinks do not escape the repo root.
 */
export function normalizeRepoPath(inputPath, repoRoot) {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new Error('Invalid path input: Path must be a non-empty string');
  }

  const resolvedRepoRoot = path.resolve(repoRoot);
  const absolutePath = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(resolvedRepoRoot, inputPath);

  const relative = path.relative(resolvedRepoRoot, absolutePath);

  if (relative === '' || relative === '.') {
    throw new Error(`Security Exception: Cannot target repository root directory: "${inputPath}"`);
  }

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Security Exception: Path traversal outside repository root: "${inputPath}"`);
  }

  // Symlink Safety Check: Reject symbolic links that escape repository boundary
  if (fs.existsSync(absolutePath)) {
    const realPath = fs.realpathSync(absolutePath);
    const realRelative = path.relative(resolvedRepoRoot, realPath);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      throw new Error(`Security Exception: Symbolic link escapes repository root: "${inputPath}" -> "${realPath}"`);
    }
  }

  return relative.replace(/\\/g, '/');
}

export function matchGlobPattern(filePath, pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`).test(filePath);
}
