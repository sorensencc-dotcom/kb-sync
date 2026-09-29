import fs from 'node:fs';
import path from 'node:path';

function sleepSpin(ms) {
  const start = Date.now();
  while (Date.now() - start < ms);
}

export function acquireLock(lockPath, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5000;
  const staleTtlMs = options.staleTtlMs ?? 30000;
  const start = Date.now();
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  while (Date.now() - start < timeoutMs) {
    try {
      if (fs.existsSync(lockPath)) {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > staleTtlMs) {
          try {
            fs.unlinkSync(lockPath);
          } catch {}
        }
      }
      fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      return {
        release() {
          try {
            fs.unlinkSync(lockPath);
          } catch {}
        },
      };
    } catch {
      sleepSpin(25);
    }
  }

  throw new Error(`Failed to acquire lock on ${lockPath} within ${timeoutMs}ms`);
}

export function atomicWriteJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lock = acquireLock(`${filePath}.lock`);
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    fs.renameSync(tmpPath, filePath);
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch {}
    lock.release();
  }
}

function readJsonObject(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

export function createTransaction(runId, notebookId, sourceGeneration, options = {}) {
  const baseDir = options.baseDir || path.join(process.cwd(), '_kb-sync-staging', 'trm');
  const walPath = path.join(baseDir, 'transactions', `${runId}.wal.json`);
  const stagedMutations = {};

  return {
    stageMutation(table, mutation) {
      stagedMutations[table] ??= [];
      stagedMutations[table].push(mutation);
      atomicWriteJson(walPath, { runId, notebookId, sourceGeneration, stagedMutations });
    },

    commitTransaction(currentGeneration) {
      if (currentGeneration !== sourceGeneration) {
        this.rollback();
        return false;
      }

      for (const [table, mutations] of Object.entries(stagedMutations)) {
        const destPath = path.join(baseDir, `${table}.json`);
        const currentData = readJsonObject(destPath);
        for (const mutation of mutations) {
          const id = mutation.id || mutation.fact_id || mutation.key;
          if (id) currentData[id] = mutation;
        }
        atomicWriteJson(destPath, currentData);
      }

      this.rollback();
      return true;
    },

    rollback() {
      try {
        fs.unlinkSync(walPath);
      } catch {}
    },
  };
}
