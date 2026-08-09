import fs from 'node:fs';
import path from 'node:path';

const LOCK_FILENAME = '.gated-climb.lock';

/**
 * Normalizes Windows drive letter to uppercase for consistent path comparisons.
 * @param {string} p
 * @returns {string}
 */
function normalizeDrive(p) {
  const resolved = path.resolve(p);
  if (process.platform === 'win32' && /^[a-z]:/i.test(resolved)) {
    return resolved[0].toUpperCase() + resolved.slice(1);
  }
  return resolved;
}

/**
 * Canonicalizes path p, resolving existing ancestor directories via fs.realpathSync.
 * @param {string} p
 * @returns {string}
 */
function getCanonicalPath(p) {
  const absolutePath = path.resolve(p);
  if (fs.existsSync(absolutePath)) {
    return normalizeDrive(fs.realpathSync(absolutePath));
  }

  let curr = absolutePath;
  const remaining = [];
  while (!fs.existsSync(curr) && curr !== path.parse(curr).root) {
    remaining.unshift(path.basename(curr));
    curr = path.dirname(curr);
  }

  const realAncestor = fs.existsSync(curr) ? fs.realpathSync(curr) : curr;
  return normalizeDrive(path.join(realAncestor, ...remaining));
}

/**
 * Acquires a lock on targetDir before validation/repair.
 * @param {string} targetDir 
 * @param {object} [options]
 * @param {number} [options.staleMs=60000]
 * @returns {{ lockPath: string, targetDir: string, release: () => void }}
 */
export function acquireLock(targetDir, options = {}) {
  const resolvedTarget = path.resolve(targetDir);
  const lockPath = path.join(resolvedTarget, LOCK_FILENAME);
  const staleMs = options.staleMs ?? 60000;

  if (fs.existsSync(lockPath)) {
    let isStale = false;
    try {
      const content = fs.readFileSync(lockPath, 'utf8');
      const data = JSON.parse(content);
      
      const age = Date.now() - (data.createdAt || 0);
      if (age > staleMs) {
        isStale = true;
      } else if (data.pid) {
        try {
          // process.kill(pid, 0) tests if process exists
          process.kill(data.pid, 0);
        } catch (e) {
          if (e.code === 'ESRCH') {
            isStale = true;
          }
        }
      }
    } catch {
      // Corrupt or unparseable lock file is treated as stale
      isStale = true;
    }

    if (isStale) {
      try {
        fs.unlinkSync(lockPath);
      } catch {}
    } else {
      const err = new Error(`Lock acquisition failed: '${LOCK_FILENAME}' already exists and is active in '${resolvedTarget}'`);
      err.code = 'ERR_LOCK_ACTIVE';
      throw err;
    }
  }

  const lockData = JSON.stringify({ pid: process.pid, createdAt: Date.now() }, null, 2);

  try {
    fs.writeFileSync(lockPath, lockData, { flag: 'wx' });
  } catch (err) {
    if (err.code === 'EEXIST') {
      const lockErr = new Error(`Lock acquisition failed: '${LOCK_FILENAME}' already exists in '${resolvedTarget}'`);
      lockErr.code = 'ERR_LOCK_ACQUISITION_FAILED';
      throw lockErr;
    }
    throw err;
  }

  return {
    lockPath,
    targetDir: resolvedTarget,
    release() {
      try {
        if (fs.existsSync(lockPath)) {
          fs.unlinkSync(lockPath);
        }
      } catch {}
    }
  };
}

/**
 * Verifies that filePath resolves within targetDir after canonicalizing existing ancestors and symlinks.
 * Throws ERR_PATH_TRAVERSAL_VIOLATION if filePath resolves outside targetDir.
 * @param {string} targetDir 
 * @param {string} filePath 
 * @returns {string} canonical path of target file
 */
export function verifyPathContainment(targetDir, filePath) {
  const targetCanonical = getCanonicalPath(targetDir);
  const resolvedTargetFilePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(targetDir, filePath);
  const fileCanonical = getCanonicalPath(resolvedTargetFilePath);

  const relative = path.relative(targetCanonical, fileCanonical);
  const isContained = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));

  if (!isContained) {
    const err = new Error(`Path traversal violation: '${filePath}' resolves outside target directory '${targetDir}'`);
    err.code = 'ERR_PATH_TRAVERSAL_VIOLATION';
    throw err;
  }

  return fileCanonical;
}
