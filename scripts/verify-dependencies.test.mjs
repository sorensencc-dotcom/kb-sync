import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { verifyDependencies } from './verify-dependencies.mjs';

test('accepts pinned compiler and tokenizer', async () => {
  const result = await verifyDependencies(process.cwd(), { runNpmCi: false });
  assert.deepEqual(result.required, { typescript: '5.4.5', 'js-tiktoken': '1.0.21' });
});

test('rejects lockfile version drift', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-sync-deps-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { typescript: '5.4.5', 'js-tiktoken': '1.0.21' } }));
  await fs.writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': { dependencies: { typescript: '5.3.0', 'js-tiktoken': '1.0.21' } } } }));
  await assert.rejects(() => verifyDependencies(root, { runNpmCi: false }), /typescript.*5\.4\.5/);
});
