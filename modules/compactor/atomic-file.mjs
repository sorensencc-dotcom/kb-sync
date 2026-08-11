import fs from 'node:fs';
import path from 'node:path';

/**
 * Atomically replaces destPath with srcPath with Windows file-locking retry safety.
 * Preserves prior file intact on failure.
 */
export function replaceFileAtomically(srcPath, destPath) {
  const dir = path.dirname(destPath);
  const bakPath = path.join(dir, `.bak.${path.basename(destPath)}.${Date.now()}`);
  let hasBackup = false;

  try {
    if (fs.existsSync(destPath)) {
      fs.copyFileSync(destPath, bakPath);
      hasBackup = true;
    }

    // Attempt native atomic rename
    try {
      fs.renameSync(srcPath, destPath);
    } catch (err) {
      // Windows fallback if target file is locked or cross-device boundary
      fs.copyFileSync(srcPath, destPath);
      fs.unlinkSync(srcPath);
    }

    // Clean up temporary backup on success
    if (hasBackup && fs.existsSync(bakPath)) {
      fs.unlinkSync(bakPath);
    }
  } catch (err) {
    // Restore backup if promotion failed
    if (hasBackup && fs.existsSync(bakPath)) {
      fs.copyFileSync(bakPath, destPath);
      fs.unlinkSync(bakPath);
    }
    if (fs.existsSync(srcPath)) fs.unlinkSync(srcPath);
    throw new Error(`Atomic File Replacement Failure for "${destPath}": ${err.message}`);
  }
}
