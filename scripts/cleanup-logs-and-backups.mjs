import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const MAX_AGE_DAYS = 14;
const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
const now = Date.now();

console.log(`[CLEANUP] Starting log and pack backup retention cleanup (max age: ${MAX_AGE_DAYS} days)...`);

let deletedCount = 0;

// 1. Cleanup logs directory
const logDir = path.join(repoRoot, 'logs');
if (fs.existsSync(logDir)) {
  const files = fs.readdirSync(logDir);
  for (const file of files) {
    const filePath = path.join(logDir, file);
    try {
      const stats = fs.statSync(filePath);
      if (stats.isFile() && (now - stats.mtimeMs) > MAX_AGE_MS) {
        fs.unlinkSync(filePath);
        console.log(`[CLEANUP] Deleted old log file: ${file}`);
        deletedCount++;
      }
    } catch (err) {
      console.warn(`[CLEANUP] Warning: Could not process ${file}: ${err.message}`);
    }
  }
}

// 2. Cleanup .nlm_pack.backup.* directories
const entries = fs.readdirSync(repoRoot);
const packBackups = entries.filter(e => e.startsWith('.nlm_pack.backup.'));
if (packBackups.length > 5) {
  // Sort by mtime ascending
  const sorted = packBackups.map(name => {
    const fullPath = path.join(repoRoot, name);
    const mtime = fs.statSync(fullPath).mtimeMs;
    return { name, fullPath, mtime };
  }).sort((a, b) => a.mtime - b.mtime);

  // Keep top 5 newest; delete older ones
  const toDelete = sorted.slice(0, sorted.length - 5);
  for (const item of toDelete) {
    if ((now - item.mtime) > MAX_AGE_MS || sorted.length > 5) {
      try {
        fs.rmSync(item.fullPath, { recursive: true, force: true });
        console.log(`[CLEANUP] Deleted old pack backup directory: ${item.name}`);
        deletedCount++;
      } catch (err) {
        console.warn(`[CLEANUP] Warning: Could not delete ${item.name}: ${err.message}`);
      }
    }
  }
}

console.log(`[CLEANUP] Log and pack backup cleanup complete (${deletedCount} items purged).`);
