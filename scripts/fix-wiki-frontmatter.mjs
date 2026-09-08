import path from 'node:path';
import { sweepStagingVault } from '../modules/wiki/autoheal-sweeper.mjs';
import { resolveVaultPaths } from '../modules/wiki/config-loader.mjs';

async function main() {
  const paths = resolveVaultPaths();
  const extra = process.argv.slice(2).find((arg) => arg && !arg.startsWith('-'));
  const allowDirty = process.argv.includes('--allow-dirty');
  const targetDir = extra ? path.resolve(process.cwd(), extra) : paths.wikiDir;
  console.log('Running autoheal (frontmatter pass) on:', targetDir);
  await sweepStagingVault({
    vaultRoot: paths.vaultRoot,
    targetDir,
    fix: true,
    verbose: true,
    allowDirty
  });
}

main().catch(console.error);
