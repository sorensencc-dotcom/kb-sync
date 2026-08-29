import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { resolveVaultPaths } from '../../../modules/wiki/config-loader.mjs';

describe('resolveVaultPaths', () => {
  it('resolves using --vault-root CLI argument', () => {
    const target = 'C:\\dev\\dev-sandbox';
    const paths = resolveVaultPaths(['node', 'script.js', `--vault-root=${target}`], {});
    expect(paths.vaultRoot).toBe(path.resolve(target));
    expect(paths.wikiDir).toBe(path.join(path.resolve(target), 'wiki'));
    expect(paths.stagingDir).toBe(path.join(path.resolve(target), '_kb-sync-staging'));
    expect(paths.researchDir).toBe(path.join(path.resolve(target), 'wiki', 'research'));
    expect(paths.transactDir).toMatch(new RegExp(`^${path.resolve(target).replace(/\\/g, '\\\\')}[\\\\/]\\.transact-\\d+$`));
  });

  it('prefers CLI argument over VAULT_ROOT environment variable', () => {
    const cliTarget = 'C:\\dev\\cli-sandbox';
    const envTarget = 'C:\\dev\\env-sandbox';
    const paths = resolveVaultPaths(
      ['node', 'script.js', `--vault-root=${cliTarget}`],
      { VAULT_ROOT: envTarget }
    );
    expect(paths.vaultRoot).toBe(path.resolve(cliTarget));
  });

  it('resolves using VAULT_ROOT env var when no CLI arg present', () => {
    const target = 'C:\\dev\\custom-vault';
    const paths = resolveVaultPaths([], { VAULT_ROOT: target });
    expect(paths.vaultRoot).toBe(path.resolve(target));
    expect(paths.wikiDir).toBe(path.join(path.resolve(target), 'wiki'));
    expect(paths.stagingDir).toBe(path.join(path.resolve(target), '_kb-sync-staging'));
    expect(paths.researchDir).toBe(path.join(path.resolve(target), 'wiki', 'research'));
    expect(paths.transactDir).toMatch(new RegExp(`^${path.resolve(target).replace(/\\/g, '\\\\')}[\\\\/]\\.transact-\\d+$`));
  });

  it('falls back to process.cwd() when no overrides provided', () => {
    const paths = resolveVaultPaths([], {});
    const expectedRoot = path.resolve(process.cwd());
    expect(paths.vaultRoot).toBe(expectedRoot);
    expect(paths.wikiDir).toBe(path.join(expectedRoot, 'wiki'));
    expect(paths.stagingDir).toBe(path.join(expectedRoot, '_kb-sync-staging'));
    expect(paths.researchDir).toBe(path.join(expectedRoot, 'wiki', 'research'));
    expect(paths.transactDir).toMatch(new RegExp(`^${expectedRoot.replace(/\\/g, '\\\\')}[\\\\/]\\.transact-\\d+$`));
  });

  it('uses default process.argv and process.env when called with no arguments', () => {
    const paths = resolveVaultPaths();
    expect(paths).toBeDefined();
    expect(paths.vaultRoot).toBeDefined();
    expect(path.isAbsolute(paths.vaultRoot)).toBe(true);
    expect(path.isAbsolute(paths.wikiDir)).toBe(true);
    expect(path.isAbsolute(paths.stagingDir)).toBe(true);
    expect(path.isAbsolute(paths.researchDir)).toBe(true);
    expect(path.isAbsolute(paths.transactDir)).toBe(true);
  });
});
