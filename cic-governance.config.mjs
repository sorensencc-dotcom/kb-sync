/**
 * cic-governance.config.mjs
 *
 * Cast Iron Charlie (CIC) Governance Adapter Configuration for kb-sync.
 */

export default {
  schemaVersion: 1,
  repository: 'kb-sync',
  rootDir: '.',
  categories: [
    'manifest',
    'spec',
    'amendment',
    'pipeline',
    'governance',
    'readme',
    'template',
    'schema',
    'lineage',
    'daemons',
    'utilities',
    'sync-tools',
    'adapters',
    'mcp-servers',
    'scaffolds',
    'prototypes',
    'wiki',
    'lessons',
    'research',
    'operations'
  ],
  statuses: ['active', 'candidate', 'draft', 'archived', 'beta', 'blocked'],
  mandatoryKeys: ['title', 'category', 'status'],
  includeGlobs: [
    'docs/governance/**/*.md',
    'docs/meta/**/*.md'
  ],
  excludeGlobs: [
    'node_modules/**',
    '.git/**',
    '.obsidian/**',
    '_archive/**',
    '.wiki-publish-temp/**',
    '.context/**',
    '.ijfw/**'
  ],
  testCommands: [
    {
      name: 'smoke:path-normalizer',
      command: 'node',
      args: ['--test', 'tests/path-normalizer-verification.ts'],
      timeoutMs: 5000,
      smoke: true,
      expectedExitCode: 0
    }
  ],
  hookInstaller: {
    command: 'node',
    args: ['scripts/install-git-hooks.mjs']
  },
  pathMappings: {
    automationPaths: ['scripts/**/*.mjs', 'scripts/**/*.ps1', 'modules/**/*.ts', 'modules/**/*.sh'],
    generatedArtifacts: ['wiki/research/*.md', '.drift-report.json', '.validation-report.json'],
    governedDocs: ['docs/governance/**/*.md', 'docs/meta/**/*.md']
  }
};
