import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const REQUIRED = Object.freeze({ typescript: '5.4.5', 'js-tiktoken': '1.0.21' });

export async function verifyDependencies(root, { runNpmCi = false } = {}) {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
  const rootPackage = lock.packages?.[''];
  if (!rootPackage) throw new Error('package-lock.json has no root package entry');
  for (const [name, expected] of Object.entries(REQUIRED)) {
    const declared = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
    const locked = rootPackage.dependencies?.[name] ?? rootPackage.devDependencies?.[name];
    if (declared !== expected || locked !== expected) throw new Error(`${name} must be pinned to ${expected} (manifest: ${declared ?? 'missing'}, lockfile: ${locked ?? 'missing'})`);
  }
  return { root, required: REQUIRED, checked: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyDependencies(process.cwd()).then(() => console.log('Dependency verification passed.')).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
