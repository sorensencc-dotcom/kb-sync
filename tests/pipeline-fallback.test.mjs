import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const repoRoot = path.resolve('.');

function runBashCommand(args, env) {
  try {
    return execFileSync('bash', args, {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      encoding: 'utf8'
    });
  } catch (err) {
    const rawOutputs = [
      err.code,
      err.message,
      err.stderr,
      err.stdout,
      Array.isArray(err.output) ? err.output.filter(Boolean).join(' ') : ''
    ];
    const errorStr = rawOutputs.filter(Boolean).join(' ').replace(/\0/g, '');

    if (/E_ACCESSDENIED|CreateInstance|Service[\\/]+CreateInstance/i.test(errorStr)) {
      return null;
    }
    throw err;
  }
}

test('core/flatten.sh COMPACTION_ENABLED=true success path generates skeletonized pack and chunk.sh consumes it', (t) => {
  const packDir = '.tmp-pipeline-success-pack';
  const chunkDir = '.tmp-pipeline-success-chunks';
  const packFile = 'compacted_pack.txt';
  const packPath = path.join(repoRoot, packDir, packFile);
  const chunkDirPath = path.join(repoRoot, chunkDir);

  try {
    const flattenRes = runBashCommand([
      'core/flatten.sh',
      '--output', packDir,
      '--pack-name', packFile
    ], { COMPACTION_ENABLED: 'true' });

    if (flattenRes === null) {
      t.skip('Bash shell execution unavailable or restricted by OS permissions (E_ACCESSDENIED)');
      return;
    }

    assert.ok(fs.existsSync(packPath), 'Compact knowledge pack must exist');
    const content = fs.readFileSync(packPath, 'utf8');
    assert.ok(content.includes('COMPACTED CONTEXT ENGINE'), 'Header must contain Compacted Context Engine banner');
    assert.ok(content.includes('[COMPACTED SKELETON]') || content.includes('[COMPACTED OUTLINE]'), 'Pack must contain skeletonized or outlined file entries');

    const chunkRes = runBashCommand([
      'core/chunk.sh',
      '--file', packDir + '/' + packFile,
      '--output-dir', chunkDir
    ], {});

    if (chunkRes === null) {
      t.skip('Bash shell execution unavailable or restricted by OS permissions (E_ACCESSDENIED)');
      return;
    }

    assert.ok(fs.existsSync(chunkDirPath));
    const chunkFiles = fs.readdirSync(chunkDirPath).filter(f => f.startsWith('repo_knowledge_pack_part_'));
    assert.ok(chunkFiles.length > 0, 'chunk.sh must split compacted pack into chunks');

  } finally {
    if (fs.existsSync(path.join(repoRoot, packDir))) fs.rmSync(path.join(repoRoot, packDir), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    if (fs.existsSync(chunkDirPath)) fs.rmSync(chunkDirPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('core/flatten.sh COMPACTION_ENABLED=false fallback path generates standard pack and chunk.sh consumes it', (t) => {
  const packDir = '.tmp-pipeline-fallback-pack';
  const chunkDir = '.tmp-pipeline-fallback-chunks';
  const packFile = 'fallback_pack.txt';
  const packPath = path.join(repoRoot, packDir, packFile);
  const chunkDirPath = path.join(repoRoot, chunkDir);

  try {
    const flattenRes = runBashCommand([
      'core/flatten.sh',
      '--output', packDir,
      '--pack-name', packFile
    ], { COMPACTION_ENABLED: 'false' });

    if (flattenRes === null) {
      t.skip('Bash shell execution unavailable or restricted by OS permissions (E_ACCESSDENIED)');
      return;
    }

    assert.ok(fs.existsSync(packPath));
    const content = fs.readFileSync(packPath, 'utf8');
    assert.ok(content.includes('REWRITE LABS & CIC REPOSITORY KNOWLEDGE PACK'));

    const chunkRes = runBashCommand([
      'core/chunk.sh',
      '--file', packDir + '/' + packFile,
      '--output-dir', chunkDir
    ], {});

    if (chunkRes === null) {
      t.skip('Bash shell execution unavailable or restricted by OS permissions (E_ACCESSDENIED)');
      return;
    }

    assert.ok(fs.existsSync(chunkDirPath));
    const chunkFiles = fs.readdirSync(chunkDirPath).filter(f => f.startsWith('repo_knowledge_pack_part_'));
    assert.ok(chunkFiles.length > 0);

  } finally {
    if (fs.existsSync(path.join(repoRoot, packDir))) fs.rmSync(path.join(repoRoot, packDir), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    if (fs.existsSync(chunkDirPath)) fs.rmSync(chunkDirPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('core/flatten.sh compactor execution failure falls back to standard pack and chunk.sh succeeds', (t) => {
  const packDir = '.tmp-pipeline-fail-pack';
  const chunkDir = '.tmp-pipeline-fail-chunks';
  const packFile = 'fail_fallback_pack.txt';
  const packPath = path.join(repoRoot, packDir, packFile);
  const chunkDirPath = path.join(repoRoot, chunkDir);

  try {
    const flattenRes = runBashCommand([
      'core/flatten.sh',
      '--output', packDir,
      '--pack-name', packFile
    ], { COMPACTION_ENABLED: 'true', COMPACTION_CONFIG: 'non-existent-file.yaml' });

    if (flattenRes === null) {
      t.skip('Bash shell execution unavailable or restricted by OS permissions (E_ACCESSDENIED)');
      return;
    }

    assert.ok(fs.existsSync(packPath), 'Fallback pack must be created despite compactor failure');
    const content = fs.readFileSync(packPath, 'utf8');
    assert.ok(content.includes('REWRITE LABS & CIC REPOSITORY KNOWLEDGE PACK'), 'Must contain standard flattener header');

    const chunkRes = runBashCommand([
      'core/chunk.sh',
      '--file', packDir + '/' + packFile,
      '--output-dir', chunkDir
    ], {});

    if (chunkRes === null) {
      t.skip('Bash shell execution unavailable or restricted by OS permissions (E_ACCESSDENIED)');
      return;
    }

    assert.ok(fs.existsSync(chunkDirPath));
    const chunkFiles = fs.readdirSync(chunkDirPath).filter(f => f.startsWith('repo_knowledge_pack_part_'));
    assert.ok(chunkFiles.length > 0, 'chunk.sh must split fallback pack into chunks');

  } finally {
    if (fs.existsSync(path.join(repoRoot, packDir))) fs.rmSync(path.join(repoRoot, packDir), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    if (fs.existsSync(chunkDirPath)) fs.rmSync(chunkDirPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
