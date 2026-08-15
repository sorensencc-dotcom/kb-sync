import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const COMPRESS_AFTER_HOURS = 24;
const COMPRESS_AFTER_MS = COMPRESS_AFTER_HOURS * 60 * 60 * 1000;
const RETENTION_DAYS = 14;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const now = Date.now();

console.log(`[LOG-ROTATE] Starting log rotation & compression (compress > ${COMPRESS_AFTER_HOURS}h, purge > ${RETENTION_DAYS}d)...`);

let compressedCount = 0;
let deletedCount = 0;

/**
 * Gzip compresses a file and deletes the uncompressed original if successful.
 */
async function compressFile(filePath) {
  const gzPath = `${filePath}.gz`;
  try {
    const source = fs.createReadStream(filePath);
    const destination = fs.createWriteStream(gzPath);
    const gzip = zlib.createGzip({ level: 9 });

    await pipeline(source, gzip, destination);

    // Preserve original file modification time
    const stats = fs.statSync(filePath);
    fs.utimesSync(gzPath, stats.atime, stats.mtime);

    // Remove uncompressed original
    fs.unlinkSync(filePath);
    compressedCount++;
    console.log(`[LOG-ROTATE] Compressed: ${path.basename(filePath)} -> ${path.basename(gzPath)}`);
  } catch (err) {
    console.warn(`[LOG-ROTATE] Warning: Failed compressing ${path.basename(filePath)}: ${err.message}`);
    // Clean up partial .gz file if failure occurred
    if (fs.existsSync(gzPath)) {
      try { fs.unlinkSync(gzPath); } catch {}
    }
  }
}

/**
 * Recursively scans a directory for log compression and retention pruning.
 */
async function processLogDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) return;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      await processLogDirectory(fullPath);
      // Clean up empty directories
      try {
        if (fs.readdirSync(fullPath).length === 0) {
          fs.rmdirSync(fullPath);
        }
      } catch {}
      continue;
    }

    if (!entry.isFile()) continue;

    try {
      const stats = fs.statSync(fullPath);
      const ageMs = now - stats.mtimeMs;

      // 1. Purge files older than retention policy (14 days)
      if (ageMs > RETENTION_MS) {
        fs.unlinkSync(fullPath);
        console.log(`[LOG-ROTATE] Purged expired log: ${entry.name}`);
        deletedCount++;
        continue;
      }

      // 2. Compress uncompressed .log or .txt files older than 24 hours
      if (
        (entry.name.endsWith('.log') || entry.name.endsWith('.txt')) &&
        !entry.name.endsWith('.gz') &&
        ageMs > COMPRESS_AFTER_MS
      ) {
        await compressFile(fullPath);
      }
    } catch (err) {
      console.warn(`[LOG-ROTATE] Warning: Could not process ${entry.name}: ${err.message}`);
    }
  }
}

// 1. Process logs/ directory
const logDir = path.join(repoRoot, 'logs');
await processLogDirectory(logDir);

// 2. Cleanup .nlm_pack.backup.* directories
try {
  const rootEntries = fs.readdirSync(repoRoot);
  const packBackups = rootEntries.filter((e) => e.startsWith('.nlm_pack.backup.'));
  if (packBackups.length > 5) {
    const sorted = packBackups
      .map((name) => {
        const fullPath = path.join(repoRoot, name);
        const mtime = fs.statSync(fullPath).mtimeMs;
        return { name, fullPath, mtime };
      })
      .sort((a, b) => a.mtime - b.mtime);

    const toDelete = sorted.slice(0, sorted.length - 5);
    for (const item of toDelete) {
      if (now - item.mtime > RETENTION_MS || sorted.length > 5) {
        try {
          fs.rmSync(item.fullPath, { recursive: true, force: true });
          console.log(`[LOG-ROTATE] Deleted old pack backup directory: ${item.name}`);
          deletedCount++;
        } catch (err) {
          console.warn(`[LOG-ROTATE] Warning: Could not delete ${item.name}: ${err.message}`);
        }
      }
    }
  }
} catch (err) {
  console.warn(`[LOG-ROTATE] Warning: Pack backup cleanup encountered an issue: ${err.message}`);
}

console.log(
  `[LOG-ROTATE] Rotation complete (${compressedCount} files compressed, ${deletedCount} expired items purged).`
);
