import { sweepStagingVault } from '../modules/wiki/autoheal-sweeper.mjs';
import { resolveVaultPaths } from '../modules/wiki/config-loader.mjs';

async function main() {
  const paths = resolveVaultPaths();
  console.log('Running autoheal (frontmatter pass) on:', paths.wikiDir);
  await sweepStagingVault({
    vaultRoot: paths.vaultRoot,
    targetDir: paths.wikiDir,
    fix: true,
    verbose: true
  });
}

main().catch(console.error);
