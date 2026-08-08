import fs from 'node:fs';
import crypto from 'node:crypto';
import Ajv from 'ajv';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildDagGraph } from '../core/dag.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRootDir = path.resolve(__dirname, '../..');

export function getPaths(rootDir = defaultRootDir) {
  const nlmDir = path.join(rootDir, '.nlm_pack');
  const gensDir = path.join(nlmDir, 'generations');
  const pointerFile = path.join(nlmDir, 'current_generation.json');
  const docsFile = path.join(rootDir, 'docs', 'KB_SYNC_DAG.md');
  return { nlmDir, gensDir, pointerFile, docsFile };
}

export function getDeterministicTimestamp(rootDir, fileList) {
  if (process.env.SOURCE_DATE_EPOCH) {
    const epoch = Number(process.env.SOURCE_DATE_EPOCH);
    if (!Number.isNaN(epoch)) return new Date(epoch * 1000).toISOString();
  }

  let latest = null;
  for (const f of fileList) {
    try {
      const gitBin = process.platform === 'win32' ? 'git.exe' : 'git';
      const out = execFileSync(gitBin, ['log', '-1', '--format=%cI', '--', f], {
        cwd: rootDir,
        encoding: 'utf8'
      }).trim();
      if (out) {
        const d = new Date(out);
        if (!latest || d > latest) latest = d;
      }
    } catch {
      // File untracked or git unavailable; skip.
    }
  }

  return latest ? latest.toISOString() : new Date(0).toISOString();
}

export function ensureDirs(rootDir = defaultRootDir) {
  const { nlmDir, gensDir, docsFile } = getPaths(rootDir);
  if (!fs.existsSync(nlmDir)) fs.mkdirSync(nlmDir, { recursive: true });
  if (!fs.existsSync(gensDir)) fs.mkdirSync(gensDir, { recursive: true });
  if (!fs.existsSync(path.dirname(docsFile))) fs.mkdirSync(path.dirname(docsFile), { recursive: true });
}


export function validateGeneration(rootDir, genDirName) {
  try {
    const ajv = new Ajv();
    const dagSchema = JSON.parse(fs.readFileSync(path.join(rootDir, 'kb-sync/schemas/dag.schema.v2.json'), 'utf8'));
    const adjSchema = JSON.parse(fs.readFileSync(path.join(rootDir, 'kb-sync/schemas/adjacency.schema.v2.json'), 'utf8'));
    delete dagSchema.$schema;
    delete adjSchema.$schema;
    const validateDag = ajv.compile(dagSchema);
    const validateAdj = ajv.compile(adjSchema);

    const { gensDir } = getPaths(rootDir);
    const genPath = path.join(gensDir, genDirName);
    if (!fs.existsSync(genPath) || !fs.statSync(genPath).isDirectory()) return false;

    const manifestPath = path.join(genPath, 'manifest.json');
    const dagPath = path.join(genPath, 'dag.json');
    const adjPath = path.join(genPath, 'adjacency.json');
    const docPath = path.join(genPath, 'KB_SYNC_DAG.md');

    if (!fs.existsSync(manifestPath) || !fs.existsSync(dagPath) || !fs.existsSync(adjPath) || !fs.existsSync(docPath)) {
      return false;
    }

    const dagJson = JSON.parse(fs.readFileSync(dagPath, 'utf8'));
    if (!validateDag(dagJson)) return false;
    const adjJson = JSON.parse(fs.readFileSync(adjPath, 'utf8'));
    if (!validateAdj(adjJson)) return false;

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const sigs = manifest.signatures || {};
    const expectedDag = sigs['dag.json'] || manifest.sha256;
    const expectedAdj = sigs['adjacency.json'];
    const expectedDoc = sigs['KB_SYNC_DAG.md'];

    if (!expectedDag || !expectedAdj || !expectedDoc) return false;

    const hDag = crypto.createHash('sha256').update(fs.readFileSync(dagPath)).digest('hex');
    const hAdj = crypto.createHash('sha256').update(fs.readFileSync(adjPath)).digest('hex');
    const hDoc = crypto.createHash('sha256').update(fs.readFileSync(docPath)).digest('hex');

    if (expectedDag !== hDag || expectedAdj !== hAdj || expectedDoc !== hDoc) return false;

    return true;
  } catch {
    return false;
  }
}

export function checkHealth(rootDir = defaultRootDir) {
  const { gensDir, pointerFile, docsFile } = getPaths(rootDir);
  if (!fs.existsSync(pointerFile)) return { healthy: false, reason: 'Missing pointer file' };
  try {
    const ptr = JSON.parse(fs.readFileSync(pointerFile, 'utf8'));
    const activeGen = ptr.active_generation;
    if (!activeGen) return { healthy: false, reason: 'Pointer file missing active_generation' };

    const genPath = path.join(gensDir, activeGen);
    if (!fs.existsSync(genPath)) return { healthy: false, reason: `Missing generation directory: ${activeGen}` };

    const genDocPath = path.join(genPath, 'KB_SYNC_DAG.md');
    const docExists = fs.existsSync(docsFile);
    if (!docExists) return { healthy: false, reason: 'Missing docs/KB_SYNC_DAG.md' };

    const docContent = fs.readFileSync(docsFile, 'utf8');
    const genDocContent = fs.readFileSync(genDocPath, 'utf8');
    if (docContent !== genDocContent) return { healthy: false, reason: 'Doc content mismatch with active generation' };

    if (!validateGeneration(rootDir, activeGen)) {
      return { healthy: false, reason: 'Active generation failed schema or hash validation' };
    }

    return { healthy: true, activeGen };
  } catch (err) {
    return { healthy: false, reason: err.message };
  }
}

export function atomicRenameSync(tmpPath, destPath) {
  const maxRetries = 5;
  const backoffMs = 100;
  for (let i = 0; i < maxRetries; i++) {
    try {
      // Node fs.renameSync calls Win32 MoveFileExW(MOVEFILE_REPLACE_EXISTING) on Windows,
      // providing 100% OS-level atomic file replacement when it succeeds.
      fs.renameSync(tmpPath, destPath);
      return;
    } catch (err) {
      if (i === maxRetries - 1) {
        throw new Error(`Atomic rename failed from ${tmpPath} to ${destPath}: ${err.message}`);
      }
      const start = Date.now();
      while (Date.now() - start < backoffMs) {} // Sync backoff sleep
    }
  }
}

export function runRecovery(rootDir = defaultRootDir) {
  console.log('[Recovery] Running recovery scan across generations...');
  const { gensDir, pointerFile, docsFile } = getPaths(rootDir);
  if (!fs.existsSync(gensDir)) {
    console.error('[Recovery] Generations directory does not exist.');
    return false;
  }

  const dirs = fs.readdirSync(gensDir).sort().reverse();
  for (const d of dirs) {
    const genPath = path.join(gensDir, d);
    if (!fs.statSync(genPath).isDirectory()) continue;

    if (!validateGeneration(rootDir, d)) {
      continue;
    }

    try {
      const manifestPath = path.join(genPath, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const srcDoc = path.join(genPath, 'KB_SYNC_DAG.md');

      // Atomic doc update
      const tmpDoc = `${docsFile}.tmp`;
      fs.copyFileSync(srcDoc, tmpDoc);
      atomicRenameSync(tmpDoc, docsFile);

      // Atomic pointer swap
      const tmpPtr = `${pointerFile}.tmp`;
      fs.writeFileSync(
        tmpPtr,
        JSON.stringify({ active_generation: d, sha256: manifest.sha256 || manifest.content_hash }, null, 2)
      );
      atomicRenameSync(tmpPtr, pointerFile);

      console.log(`[Recovery] Successfully recovered to generation ${d}`);
      return true;
    } catch (err) {
      console.error(`[Recovery] Failed restoring generation ${d}: ${err.message}`);
      continue;
    }
  }

  console.error('[Recovery] No valid candidate generation found for recovery.');
  return false;
}

export function runGC(rootDir = defaultRootDir) {
  const { nlmDir, gensDir, pointerFile } = getPaths(rootDir);
  const lockFile = path.join(nlmDir, 'gc.lock');

  if (!fs.existsSync(gensDir)) return;

  try {
    fs.writeFileSync(lockFile, String(Date.now()), { flag: 'wx' });
  } catch {
    // Lock present or error, proceed carefully
  }

  try {
    let activeGen = null;
    if (fs.existsSync(pointerFile)) {
      try {
        const ptr = JSON.parse(fs.readFileSync(pointerFile, 'utf8'));
        activeGen = ptr.active_generation;
      } catch {}
    }

    const dirs = fs.readdirSync(gensDir).filter(d => fs.statSync(path.join(gensDir, d)).isDirectory());
    const validDirs = dirs.filter(d => validateGeneration(rootDir, d)).sort().reverse();

    const toRetain = new Set();
    if (activeGen && validDirs.includes(activeGen)) {
      toRetain.add(activeGen);
    }

    let count = 0;
    for (const d of validDirs) {
      if (d !== activeGen && count < 3) {
        toRetain.add(d);
        count++;
      }
    }

    for (const d of dirs) {
      if (!toRetain.has(d)) {
        fs.rmSync(path.join(gensDir, d), { recursive: true, force: true });
      }
    }
  } finally {
    if (fs.existsSync(lockFile)) {
      try { fs.unlinkSync(lockFile); } catch {}
    }
  }
}

function runCli() {
  const args = process.argv.slice(2);
  const isCheckOnly = args.includes('--check-only');
  const isRecover = args.includes('--recover');
  const isGc = args.includes('--gc');

  ensureDirs();

  if (isCheckOnly) {
    const health = checkHealth();
    if (health.healthy) {
      console.log(`[OK] KBSync DAG Health Check PASS (Active: ${health.activeGen})`);
      process.exit(0);
    } else {
      console.error(`[FAIL] KBSync DAG Health Check FAIL: ${health.reason}`);
      process.exit(1);
    }
  }

  if (isRecover) {
    const ok = runRecovery();
    process.exit(ok ? 0 : 1);
  }

  if (isGc) {
    runGC();
    console.log('[GC] Garbage collection completed.');
    process.exit(0);
  }

  // Main Build Path: check health first, auto-recover if unhealthy
  const health = checkHealth();
  if (!health.healthy) {
    console.log(`[Warning] Health check failed (${health.reason}). Attempting auto-recovery...`);
    runRecovery();
  }

  const { gensDir, pointerFile, docsFile } = getPaths();
  const statusFile = path.join(defaultRootDir, 'KB_SYNC_STATUS.md');
  const fileList = fs.existsSync(statusFile) ? ['KB_SYNC_STATUS.md', 'README.md'] : ['README.md'];
  const commitTimestamp = getDeterministicTimestamp(defaultRootDir, fileList);

  const { dag, adjacency, markdownDoc, genId } = buildDagGraph({
    chunks: [],
    backlinks: [],
    fileList,
    commitTimestamp
  });

  const targetGenDir = path.join(gensDir, genId);
  fs.mkdirSync(targetGenDir, { recursive: true });

  fs.writeFileSync(path.join(targetGenDir, 'dag.json'), JSON.stringify(dag, null, 2));
  fs.writeFileSync(path.join(targetGenDir, 'adjacency.json'), JSON.stringify(adjacency, null, 2));
  fs.writeFileSync(path.join(targetGenDir, 'KB_SYNC_DAG.md'), markdownDoc);

  const manifest = {
    generation_id: genId,
    created_at: dag.metadata.created_at,
    sha256: dag.metadata.content_hash,
    signatures: {
      'dag.json': crypto.createHash('sha256').update(fs.readFileSync(path.join(targetGenDir, 'dag.json'))).digest('hex'),
      'adjacency.json': crypto.createHash('sha256').update(fs.readFileSync(path.join(targetGenDir, 'adjacency.json'))).digest('hex'),
      'KB_SYNC_DAG.md': crypto.createHash('sha256').update(fs.readFileSync(path.join(targetGenDir, 'KB_SYNC_DAG.md'))).digest('hex')
    }
  };
  fs.writeFileSync(path.join(targetGenDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // Atomic doc update
  const tmpDoc = `${docsFile}.tmp`;
  fs.writeFileSync(tmpDoc, markdownDoc);
  atomicRenameSync(tmpDoc, docsFile);

  // Atomic pointer swap
  const tmpPtr = `${pointerFile}.tmp`;
  fs.writeFileSync(
    tmpPtr,
    JSON.stringify({ active_generation: genId, sha256: dag.metadata.content_hash }, null, 2)
  );
  atomicRenameSync(tmpPtr, pointerFile);

  // Run GC after build
  runGC();

  console.log(`[SUCCESS] Generated DAG build: ${genId}`);
}

const mainFile = process.argv[1] ? fs.realpathSync(process.argv[1]) : '';
const thisFile = fs.realpathSync(__filename);
if (mainFile === thisFile) {
  runCli();
}

