import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateAllowedDiff } from './normalized-diff-guard.mjs';

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

/**
 * Recursively scans directory for markdown files.
 * @param {string} dir 
 * @param {string} [relPrefix=''] 
 * @returns {string[]} array of relative file paths
 */
function scanMarkdownFiles(dir, relPrefix = '') {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const relPath = relPrefix ? path.join(relPrefix, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (entry.name !== '.git' && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
        results.push(...scanMarkdownFiles(path.join(dir, entry.name), relPath));
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(relPath);
    }
  }
  return results;
}

/**
 * Executes the Gated Climb Auto-Repair Loop for a target directory of Markdown documents.
 * 
 * @param {object} options
 * @param {string} options.targetDir - Path to target directory containing markdown files
 * @param {object} [options.provider] - RepairProvider instance
 * @param {number} [options.maxRetries=3] - Maximum repair iterations
 * @param {string} [options.validatorScript] - Path to validate-contract.mjs
 * @param {function} [options.validatorFn] - Optional custom validator function for testing
 * @param {string} [options.runId] - Unique run identifier
 * @param {string} [options.baseDir] - Base directory for output folders
 * @param {string} [options.stagedProposalsDir] - Path for promoted staged proposals
 * @param {string} [options.quarantineDir] - Path for quarantine bundles
 * @param {string} [options.logsDir] - Path for audit logs
 * @param {string} [options.auditLogPath] - Explicit path to auto-repair-audit.jsonl
 * @returns {Promise<object>} Result summary of repair execution
 */
export async function runGatedClimbRepair(options = {}) {
  if (!options.targetDir) {
    throw new Error('targetDir is required');
  }

  const targetDir = path.resolve(options.targetDir);
  if (!fs.existsSync(targetDir)) {
    throw new Error(`Target directory does not exist: '${targetDir}'`);
  }

  const maxRetries = options.maxRetries ?? 3;
  const runId = options.runId || (`run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  const baseDir = options.baseDir ? path.resolve(options.baseDir) : path.dirname(targetDir);
  const stagedProposalsDir = options.stagedProposalsDir ? path.resolve(options.stagedProposalsDir) : path.join(baseDir, 'staged-proposals');
  const quarantineDir = options.quarantineDir ? path.resolve(options.quarantineDir) : path.join(baseDir, '_quarantine');
  const logsDir = options.logsDir ? path.resolve(options.logsDir) : path.join(baseDir, 'logs');
  const auditLogPath = options.auditLogPath ? path.resolve(options.auditLogPath) : path.join(logsDir, 'auto-repair-audit.jsonl');
  
  const defaultValidatorScript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'validate-contract.mjs');
  const validatorScript = options.validatorScript || defaultValidatorScript;

  const lock = acquireLock(targetDir, options.lockOptions);

  const originalContents = new Map();
  const latestRepairedContents = new Map();
  const rejectionReasons = new Map();

  // Populate initial file snapshot
  const initialFiles = scanMarkdownFiles(targetDir);
  for (const relFile of initialFiles) {
    verifyPathContainment(targetDir, relFile);
    const fullPath = path.resolve(targetDir, relFile);
    const content = fs.readFileSync(fullPath, 'utf8');
    originalContents.set(relFile, content);
    latestRepairedContents.set(relFile, content);
  }

  function runValidatorInternal(dirPath) {
    if (typeof options.validatorFn === 'function') {
      return options.validatorFn(dirPath);
    }

    try {
      const stdout = execSync(`node "${validatorScript}" --json "${dirPath}"`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      return { status: 0, json: JSON.parse(stdout) };
    } catch (err) {
      const stdout = err.stdout ? err.stdout.toString() : '';
      let json = null;
      try {
        json = JSON.parse(stdout);
      } catch {}
      return { status: err.status || 1, json };
    }
  }

  let attempts = 0;
  let validationResult = null;
  let passed = false;
  let destinationPath = null;
  let finalQuarantinePath = null;

  try {
    while (attempts <= maxRetries) {
      validationResult = runValidatorInternal(targetDir);
      const errors = (validationResult.json && Array.isArray(validationResult.json.errors))
        ? validationResult.json.errors
        : [];

      if (errors.length === 0 || (validationResult.json && validationResult.json.exit_code === 0)) {
        passed = true;
        break;
      }

      if (attempts === maxRetries) {
        passed = false;
        break;
      }

      attempts++;

      // Group errors by file
      const errorsByFile = new Map();
      for (const err of errors) {
        const fileKey = err.file ? path.relative(targetDir, path.resolve(targetDir, err.file)) : null;
        if (fileKey) {
          if (!errorsByFile.has(fileKey)) {
            errorsByFile.set(fileKey, []);
          }
          errorsByFile.get(fileKey).push(err);
        } else {
          // If no specific file field, attach to all scanned files
          for (const relFile of originalContents.keys()) {
            if (!errorsByFile.has(relFile)) errorsByFile.set(relFile, []);
            errorsByFile.get(relFile).push(err);
          }
        }
      }

      let modifiedCount = 0;

      for (const [relFile, fileErrors] of errorsByFile.entries()) {
        const canonicalFile = verifyPathContainment(targetDir, relFile);
        if (!fs.existsSync(canonicalFile)) continue;

        const currentContent = fs.readFileSync(canonicalFile, 'utf8');
        const origContent = originalContents.get(relFile) ?? currentContent;
        if (!originalContents.has(relFile)) {
          originalContents.set(relFile, currentContent);
        }

        if (!options.provider || typeof options.provider.repair !== 'function') {
          continue;
        }

        let repairedContent;
        try {
          repairedContent = await options.provider.repair(currentContent, fileErrors, options);
        } catch (repairErr) {
          rejectionReasons.set(relFile, repairErr.message);
          continue;
        }

        latestRepairedContents.set(relFile, repairedContent);

        try {
          validateAllowedDiff(origContent, repairedContent, fileErrors);
          fs.writeFileSync(canonicalFile, repairedContent, 'utf8');
          modifiedCount++;
        } catch (diffErr) {
          rejectionReasons.set(relFile, diffErr.message);
        }
      }

      if (modifiedCount === 0) {
        // No modifications could be made, stop retrying
        break;
      }
    }

    // Final validation check
    validationResult = runValidatorInternal(targetDir);
    const finalErrors = (validationResult.json && Array.isArray(validationResult.json.errors))
      ? validationResult.json.errors
      : [];
    passed = Boolean(validationResult.json && validationResult.json.exit_code === 0 && finalErrors.length === 0);

    if (passed) {
      destinationPath = path.join(stagedProposalsDir, runId);
      fs.mkdirSync(stagedProposalsDir, { recursive: true });
      lock.release();
      fs.renameSync(targetDir, destinationPath);
    } else {
      finalQuarantinePath = path.join(quarantineDir, runId);
      const tmpQuarantineRunDir = path.join(baseDir, '.tmp-quarantine', runId);
      fs.mkdirSync(tmpQuarantineRunDir, { recursive: true });
      fs.mkdirSync(quarantineDir, { recursive: true });

      const filesToQuarantine = new Set();
      for (const err of finalErrors) {
        if (err.file) {
          filesToQuarantine.add(path.relative(targetDir, path.resolve(targetDir, err.file)));
        }
      }
      if (filesToQuarantine.size === 0) {
        for (const f of originalContents.keys()) {
          filesToQuarantine.add(f);
        }
      }

      for (const relFile of filesToQuarantine) {
        const fileSlug = path.basename(relFile, '.md').replace(/[^a-zA-Z0-9_-]/g, '_');
        const bundleDir = path.join(tmpQuarantineRunDir, fileSlug);
        fs.mkdirSync(bundleDir, { recursive: true });

        const fullTargetFile = path.resolve(targetDir, relFile);
        const orig = originalContents.get(relFile) || (fs.existsSync(fullTargetFile) ? fs.readFileSync(fullTargetFile, 'utf8') : '');
        const rep = latestRepairedContents.get(relFile) || orig;
        const reason = rejectionReasons.get(relFile) || 'Retries expired without resolving all validation errors';
        const diags = finalErrors.filter(e => e.file && (e.file === relFile || path.basename(e.file) === path.basename(relFile)));

        fs.writeFileSync(path.join(bundleDir, 'original.md'), orig, 'utf8');
        fs.writeFileSync(path.join(bundleDir, 'repaired_latest.md'), rep, 'utf8');

        const manifest = {
          run_id: runId,
          file: relFile,
          file_slug: fileSlug,
          timestamp: new Date().toISOString(),
          reason,
          diagnostics: diags,
          attempts
        };
        fs.writeFileSync(path.join(bundleDir, 'quarantine_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
      }

      fs.renameSync(tmpQuarantineRunDir, finalQuarantinePath);

      try {
        fs.rmdirSync(path.join(baseDir, '.tmp-quarantine'));
      } catch {}
    }
  } finally {
    lock.release();
  }

  // Audit Logging
  const logEntry = {
    timestamp: new Date().toISOString(),
    run_id: runId,
    target_dir: targetDir,
    status: passed ? 'PASS' : 'QUARANTINED',
    retries_used: attempts,
    promoted_to: destinationPath,
    quarantined_to: finalQuarantinePath,
    errors: validationResult && validationResult.json ? (validationResult.json.errors || []) : []
  };

  try {
    fs.mkdirSync(path.dirname(auditLogPath), { recursive: true });
    fs.appendFileSync(auditLogPath, JSON.stringify(logEntry) + '\n', 'utf8');
  } catch (loggerErr) {
    try {
      const fallbackDir = fs.existsSync(targetDir)
        ? targetDir
        : (destinationPath && fs.existsSync(destinationPath) ? destinationPath : baseDir);
      const flagPath = path.join(fallbackDir, '.audit-degraded.flag');
      fs.writeFileSync(flagPath, JSON.stringify({ error: loggerErr.message, timestamp: new Date().toISOString() }), 'utf8');
    } catch {}
  }

  return {
    runId,
    status: passed ? 'PASS' : 'QUARANTINED',
    passed,
    retriesUsed: attempts,
    promotedPath: destinationPath,
    quarantinePath: finalQuarantinePath,
    auditLogPath
  };
}
