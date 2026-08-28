import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { verifyDependencies } from './verify-dependencies.mjs';

test('accepts pinned compiler and tokenizer', async () => {
  const result = await verifyDependencies(process.cwd());
  assert.deepEqual(result.required, { typescript: '5.4.5', 'js-tiktoken': '1.0.21' });
});

test('rejects lockfile version drift', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-sync-deps-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { typescript: '5.4.5', 'js-tiktoken': '1.0.21' } }));
  await fs.writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': { dependencies: { typescript: '5.3.0', 'js-tiktoken': '1.0.21' } } } }));
  await assert.rejects(() => verifyDependencies(root), /typescript.*5\.4\.5/);
});

async function createFixture({ typescript = '5.4.5', tokenizer = '1.0.21' } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-sync-deps-'));
  const manifest = { devDependencies: { typescript: '5.4.5', 'js-tiktoken': '1.0.21' } };
  const lock = { lockfileVersion: 3, packages: { '': { devDependencies: manifest.devDependencies } } };
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(root, 'package-lock.json'), JSON.stringify(lock));
  await fs.mkdir(path.join(root, 'node_modules', 'typescript'), { recursive: true });
  await fs.mkdir(path.join(root, 'node_modules', 'js-tiktoken'), { recursive: true });
  await fs.writeFile(path.join(root, 'node_modules', 'typescript', 'package.json'), JSON.stringify({ version: typescript }));
  await fs.writeFile(path.join(root, 'node_modules', 'js-tiktoken', 'package.json'), JSON.stringify({ version: tokenizer }));
  return root;
}

test('rejects missing installed dependency', async () => {
  const root = await createFixture();
  await fs.rm(path.join(root, 'node_modules', 'js-tiktoken'), { recursive: true, force: true });
  await assert.rejects(() => verifyDependencies(root), /js-tiktoken.*installed.*missing/);
});

test('rejects installed version drift', async () => {
  const root = await createFixture({ typescript: '5.3.0' });
  await assert.rejects(() => verifyDependencies(root), /typescript.*installed.*5\.3\.0/);
});
