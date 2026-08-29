import path from 'node:path';

/**
 * Resolves normalized absolute paths for vault-related directories.
 *
 * @param {string[]} [args=process.argv] - Command-line arguments.
 * @param {Record<string, string | undefined>} [env=process.env] - Environment variables.
 * @returns {{ vaultRoot: string, wikiDir: string, stagingDir: string, researchDir: string, transactDir: string }}
 */
export function resolveVaultPaths(args = process.argv, env = process.env) {
  const cliArg = args.find(arg => typeof arg === 'string' && arg.startsWith('--vault-root='));
  let cliOverride = null;
  if (cliArg) {
    const rawVal = cliArg.slice('--vault-root='.length);
    cliOverride = rawVal.replace(/^["']|["']$/g, '');
  }
  const envOverride = env.VAULT_ROOT;
  const resolvedRoot = path.resolve(cliOverride || envOverride || process.cwd());

  return {
    vaultRoot: resolvedRoot,
    wikiDir: path.join(resolvedRoot, 'wiki'),
    stagingDir: path.join(resolvedRoot, '_kb-sync-staging'),
    researchDir: path.join(resolvedRoot, 'wiki', 'research'),
    transactDir: path.join(resolvedRoot, `.transact-${Date.now()}`)
  };
}
