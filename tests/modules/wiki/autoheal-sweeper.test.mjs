import { describe, it, expect, vi, beforeEach } from 'vitest';
import { autohealMetadata, sweepStagingVault } from '../../../modules/wiki/autoheal-sweeper.mjs';
import fs from 'fs/promises';
import path from 'path';

vi.mock('fs/promises');
vi.mock('../../../modules/wiki/config-loader.mjs', () => ({
  resolveVaultPaths: vi.fn().mockResolvedValue({
    stagingRoot: '/mock/staging',
    manifestPath: '/mock/manifest.json'
  })
}));

describe('autohealMetadata', () => {
  it('injects missing frontmatter for raw markdown', async () => {
    const rawContent = '# Title\n\nSome text.';
    const result = await autohealMetadata('test-file.md', rawContent, { repoName: 'kb-sync' });
    
    expect(result.content.startsWith('---')).toBe(true);
    expect(result.content).toContain('title: test-file');
    expect(result.content).toContain('category: wiki');
    expect(result.content).toContain('status: draft');
    expect(result.content).toContain('sourceRepository: kb-sync');
    expect(result.repairs).toContain('injected_frontmatter');
  });

  it('uses research category for research paths', async () => {
    const rawContent = '# Title\n\nSome text.';
    const result = await autohealMetadata('research/test.md', rawContent, { repoName: 'kb-sync' });
    
    expect(result.content).toContain('category: research');
  });

  it('repairs partial frontmatter while preserving custom fields', async () => {
    const content = '---\ntitle: custom title\ncustom_field: true\n---\nText.';
    const result = await autohealMetadata('test.md', content, { repoName: 'kb-sync' });
    
    expect(result.content).toContain('title: custom title');
    expect(result.content).toContain('custom_field: true');
    expect(result.content).toContain('category: wiki');
    expect(result.content).toContain('status: draft');
    expect(result.content).toContain('sourceRepository: kb-sync');
    expect(result.repairs).toContain('added_missing_fields');
  });

  it('normalizes category spaces and casing', async () => {
    const content = '---\ncategory: Some Category\n---\nText.';
    const result = await autohealMetadata('test.md', content, { repoName: 'kb-sync' });
    
    expect(result.content).toContain('category: some-category');
    expect(result.repairs).toContain('normalized_category');
  });

  it('normalizes status casing and synonyms', async () => {
    const cases = [
      { input: 'WIP', output: 'draft' },
      { input: 'Review', output: 'proposed' },
      { input: 'Active', output: 'active' }
    ];
    
    for (const c of cases) {
      const content = `---\nstatus: ${c.input}\n---\nText.`;
      const result = await autohealMetadata('test.md', content, { repoName: 'kb-sync' });
      expect(result.content).toContain(`status: ${c.output}`);
      expect(result.repairs).toContain('normalized_status');
    }
  });

  it('rewrites manifest-aware wikilinks', async () => {
    const content = 'Link to [[KnownTarget]] and [[KnownTarget|Custom Label]]. Unknown [[UnknownTarget]].';
    const index = new Map([
      ['KnownTarget', 'kb-sync/wiki/daemons/KnownTarget']
    ]);
    
    const result = await autohealMetadata('test.md', content, { repoName: 'kb-sync', index });
    
    expect(result.content).toContain('[[kb-sync/wiki/daemons/KnownTarget]]');
    expect(result.content).toContain('[[kb-sync/wiki/daemons/KnownTarget|Custom Label]]');
    expect(result.content).toContain('[[kb-sync/wiki/research/UnknownTarget]]');
    expect(result.repairs).toContain('rewrote_wikilinks');
  });

  it('ignores code blocks when rewriting wikilinks', async () => {
    const content = 'Text.\n```md\n[[KnownTarget]]\n```\n`[[KnownTarget]]`';
    const index = new Map([
      ['KnownTarget', 'kb-sync/wiki/daemons/KnownTarget']
    ]);
    
    const result = await autohealMetadata('test.md', content, { repoName: 'kb-sync', index });
    
    expect(result.content).toContain('```md\n[[KnownTarget]]\n```');
    expect(result.content).toContain('`[[KnownTarget]]`');
    expect(result.repairs).not.toContain('rewrote_wikilinks');
  });

  it('ignores already-prefixed wikilinks', async () => {
    const content = '[[kb-sync/wiki/KnownTarget]] [[toolforge/wiki/KnownTarget]] [[trm/wiki/KnownTarget]]';
    const index = new Map([
      ['KnownTarget', 'kb-sync/wiki/daemons/KnownTarget']
    ]);
    
    const result = await autohealMetadata('test.md', content, { repoName: 'kb-sync', index });
    
    expect(result.content).toContain(content);
    expect(result.repairs).not.toContain('rewrote_wikilinks');
  });
});

describe('sweepStagingVault', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sweeps and reports on vault files', async () => {
    fs.readdir.mockResolvedValue([
      { name: 'test1.md', isDirectory: () => false },
      { name: 'test2.md', isDirectory: () => false }
    ]);
    
    fs.readFile.mockImplementation(async (filePath) => {
      if (filePath === '/mock/manifest.json') {
        return JSON.stringify({ index: { 'KnownTarget': 'kb-sync/wiki/daemons/KnownTarget' } });
      }
      return '# Title\n[[KnownTarget]]';
    });
    
    fs.writeFile.mockResolvedValue(undefined);

    const report = await sweepStagingVault({ dryRun: false });
    
    expect(report.filesScanned).toBe(2);
    expect(report.filesHealed).toBe(2);
    expect(report.repairs.length).toBeGreaterThan(0);
    
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('.autoheal-report.json'),
      expect.any(String),
      'utf-8'
    );
  });
});
