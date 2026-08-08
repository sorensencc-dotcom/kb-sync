import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

test('build-dag.mjs builds initial generation and passes --check-only', () => {
  const rootDir = process.cwd();

  // 1. Execute build-dag CLI runner to build initial generation
  const buildOutput = execSync('node kb-sync/scripts/build-dag.mjs', { cwd: rootDir, encoding: 'utf8' });
  assert.ok(buildOutput.includes('[SUCCESS] Generated DAG build:'), 'Build output should indicate success');

  // 2. Verify current_generation.json pointer exists and is valid
  const pointerFile = path.join(rootDir, '.nlm_pack', 'current_generation.json');
  assert.ok(fs.existsSync(pointerFile), 'current_generation.json must exist after build');

  const pointer = JSON.parse(fs.readFileSync(pointerFile, 'utf8'));
  assert.ok(pointer.active_generation, 'pointer file must specify active_generation');
  assert.ok(pointer.sha256, 'pointer file must specify sha256');

  // 3. Verify docs/KB_SYNC_DAG.md exists
  const docsFile = path.join(rootDir, 'docs', 'KB_SYNC_DAG.md');
  assert.ok(fs.existsSync(docsFile), 'docs/KB_SYNC_DAG.md must exist after build');

  // 4. Verify generation directory artifacts
  const genDir = path.join(rootDir, '.nlm_pack', 'generations', pointer.active_generation);
  assert.ok(fs.existsSync(path.join(genDir, 'dag.json')), 'dag.json must exist in generation dir');
  assert.ok(fs.existsSync(path.join(genDir, 'adjacency.json')), 'adjacency.json must exist in generation dir');
  assert.ok(fs.existsSync(path.join(genDir, 'KB_SYNC_DAG.md')), 'KB_SYNC_DAG.md must exist in generation dir');
  assert.ok(fs.existsSync(path.join(genDir, 'manifest.json')), 'manifest.json must exist in generation dir');

  // 5. Execute --check-only to verify health check returns 0 and produces output
  const checkOutput = execSync('node kb-sync/scripts/build-dag.mjs --check-only', { cwd: rootDir, encoding: 'utf8' });
  assert.ok(checkOutput.includes('[OK] KBSync DAG Health Check PASS'), 'Check output should indicate PASS');
});

test('build-dag.mjs --recover restores active generation on corrupt pointer', () => {
  const rootDir = process.cwd();

  // Corrupt current_generation.json pointer
  const pointerFile = path.join(rootDir, '.nlm_pack', 'current_generation.json');
  fs.writeFileSync(pointerFile, JSON.stringify({ active_generation: 'non_existent_gen', sha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' }));

  // Run --recover
  const recoverOutput = execSync('node kb-sync/scripts/build-dag.mjs --recover', { cwd: rootDir, encoding: 'utf8' });
  assert.ok(recoverOutput.includes('[Recovery] Successfully recovered'), 'Recovery output should indicate success');

  // Verify health check passes after recovery
  const checkOutput = execSync('node kb-sync/scripts/build-dag.mjs --check-only', { cwd: rootDir, encoding: 'utf8' });
  assert.ok(checkOutput.includes('[OK] KBSync DAG Health Check PASS'));
});
