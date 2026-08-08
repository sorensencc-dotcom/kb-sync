import fs from 'node:fs';
import path from 'node:path';
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

export function ensureDirs(rootDir = defaultRootDir) {
  const { nlmDir, gensDir, docsFile } = getPaths(rootDir);
  if (!fs.existsSync(nlmDir)) fs.mkdirSync(nlmDir, { recursive: true });
  if (!fs.existsSync(gensDir)) fs.mkdirSync(gensDir, { recursive: true });
  if (!fs.existsSync(path.dirname(docsFile))) fs.mkdirSync(path.dirname(docsFile), { recursive: true });
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

    const manifestPath = path.join(genPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return { healthy: false, reason: 'Missing manifest.json in generation' };

    const dagPath = path.join(genPath, 'dag.json');
    if (!fs.existsSync(dagPath)) return { healthy: false, reason: 'Missing dag.json in generation' };

    const adjPath = path.join(genPath, 'adjacency.json');
    if (!fs.existsSync(adjPath)) return { healthy: false, reason: 'Missing adjacency.json in generation' };

    const genDocPath = path.join(genPath, 'KB_SYNC_DAG.md');
    if (!fs.existsSync(genDocPath)) return { healthy: false, reason: 'Missing KB_SYNC_DAG.md in generation' };

    const docExists = fs.existsSync(docsFile);
    if (!docExists) return { healthy: false, reason: 'Missing docs/KB_SYNC_DAG.md' };

    const docContent = fs.readFileSync(docsFile, 'utf8');
    const genDocContent = fs.readFileSync(genDocPath, 'utf8');
    if (docContent !== genDocContent) return { healthy: false, reason: 'Doc content mismatch with active generation' };

    return { healthy: true, activeGen };
  } catch (err) {
    return { healthy: false, reason: err.message };
  }
}

export function atomicRenameSync(tmpPath, destPath) {
  if (fs.existsSync(destPath)) {
    try {
      fs.unlinkSync(destPath);
    } catch {
      fs.copyFileSync(tmpPath, destPath);
      try { fs.unlinkSync(tmpPath); } catch {}
      return;
    }
  }
  try {
    fs.renameSync(tmpPath, destPath);
  } catch {
    fs.copyFileSync(tmpPath, destPath);
    try { fs.unlinkSync(tmpPath); } catch {}
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

    const manifestPath = path.join(genPath, 'manifest.json');
    const srcDoc = path.join(genPath, 'KB_SYNC_DAG.md');
    const dagPath = path.join(genPath, 'dag.json');
    const adjPath = path.join(genPath, 'adjacency.json');

    if (!fs.existsSync(manifestPath) || !fs.existsSync(srcDoc) || !fs.existsSync(dagPath) || !fs.existsSync(adjPath)) {
      continue;
    }

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

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
    const validDirs = dirs.filter(d => {
      const genPath = path.join(gensDir, d);
      return (
        fs.existsSync(path.join(genPath, 'manifest.json')) &&
        fs.existsSync(path.join(genPath, 'dag.json')) &&
        fs.existsSync(path.join(genPath, 'adjacency.json')) &&
        fs.existsSync(path.join(genPath, 'KB_SYNC_DAG.md'))
      );
    }).sort().reverse();

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
  const commitTimestamp = new Date().toISOString();

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
    sha256: dag.metadata.content_hash
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

