import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('toolforge-kbsync-contract schema', () => {
  const schemaPath = path.resolve('modules/wiki/toolforge-kbsync-contract.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

  it('contains all required repositories in sourceRepository enum', () => {
    const repos = schema.properties.sourceRepository.enum;
    const expectedRepos = [
      'trm',
      'cic-ingestion',
      'toolforge',
      'kb-sync',
      'rewrite-docs',
      'rewrite-mcp',
      'cic-os',
      'charlie-deep-research',
      'sigil',
      'castironforge'
    ];

    for (const repo of expectedRepos) {
      expect(repos).toContain(repo);
    }
  });

  it('contains all required statuses in frontmatter status enum', () => {
    const statusEnum =
      schema.properties.payload.properties.stagingNotes.items.properties.frontmatter.properties.status.enum;
    const expectedStatuses = ['proposed', 'active', 'beta', 'archived', 'draft'];

    for (const status of expectedStatuses) {
      expect(statusEnum).toContain(status);
    }
  });

  it('maintains parity with validate-contract.mjs exports', async () => {
    const { ALLOWED_CATEGORIES, ALLOWED_STATUSES } = await import(
      '../../../modules/wiki/validate-contract.mjs'
    );
    expect(ALLOWED_CATEGORIES.has('research')).toBe(true);
    expect(ALLOWED_CATEGORIES.has('wiki')).toBe(true);
    expect(ALLOWED_STATUSES.has('proposed')).toBe(true);
    expect(ALLOWED_STATUSES.has('draft')).toBe(true);
  });
});
