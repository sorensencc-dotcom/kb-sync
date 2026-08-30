import { describe, it, expect, vi, beforeEach } from 'vitest';
import { autohealMetadata, sweepStagingVault } from '../../../modules/wiki/autoheal-sweeper.mjs';
import fs from 'fs/promises';
import path from 'path';

vi.mock('fs/promises');
vi.mock('../../../modules/wiki/config-loader.mjs', () => ({
  resolveVaultPaths: vi.fn().mockReturnValue({
    vaultRoot: '/mock/vault',
    wikiDir: '/mock/vault/wiki',
    stagingDir: '/mock/vault/_kb-sync-staging',
    researchDir: '/mock/vault/wiki/research',
    transactDir: '/mock/vault/.transact-123'
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

  it('rewrites wikilinks with section anchors and custom labels', async () => {
    const content = 'See [[KnownTarget#architecture|Architecture Diagram]] and [[UnknownTarget#subheading]].';
    const index = new Map([
      ['KnownTarget', 'kb-sync/wiki/daemons/KnownTarget']
    ]);
    
    const result = await autohealMetadata('test.md', content, { repoName: 'kb-sync', index });
    
    expect(result.content).toContain('[[kb-sync/wiki/daemons/KnownTarget#architecture|Architecture Diagram]]');
    expect(result.content).toContain('[[kb-sync/wiki/research/UnknownTarget#subheading]]');
    expect(result.repairs).toContain('rewrote_wikilinks');
  });

  it('handles CRLF line endings in frontmatter and body seamlessly', async () => {
    const rawContent = '---\r\ntitle: CRLF Note\r\ncategory: Research\r\nstatus: Active\r\n---\r\n# CRLF Header\r\n\r\n[[Target]]\r\n';
    const result = await autohealMetadata('wiki/research/crlf-note.md', rawContent, { repoName: 'kb-sync' });

    expect(result.content).toContain('category: research');
    expect(result.content).toContain('status: active');
    expect(result.content).toContain('[[kb-sync/wiki/research/Target]]');
    expect(result.repairs).toContain('normalized_category');
    expect(result.repairs).toContain('rewrote_wikilinks');
  });

  it('handles empty files gracefully by injecting frontmatter defaults', async () => {
    const rawContent = '';
    const result = await autohealMetadata('wiki/research/empty-test.md', rawContent, { repoName: 'kb-sync' });

    expect(result.content.startsWith('---')).toBe(true);
    expect(result.content).toContain('title: empty-test');
    expect(result.content).toContain('category: research');
    expect(result.content).toContain('status: draft');
    expect(result.repairs).toContain('injected_frontmatter');
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
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('.repair-manifest.json'),
      expect.any(String),
      'utf-8'
    );
    expect(report.status).toBe('PARTIAL');
  });

  it('reports APPLIED status and generates manifest entries when fix is true', async () => {
    fs.readdir.mockResolvedValue([
      { name: 'test1.md', isDirectory: () => false }
    ]);
    
    fs.readFile.mockImplementation(async () => '# Title\n[[Target]]');
    fs.writeFile.mockResolvedValue(undefined);

    const report = await sweepStagingVault({ fix: true, dryRun: false, allowDirty: true });
    
    expect(report.status).toBe('APPLIED');
    expect(report.manifestEntries.length).toBe(1);
    expect(report.manifestEntries[0].status).toBe('APPLIED');
    expect(report.manifestEntries[0].beforeSha256).toBeDefined();
    expect(report.manifestEntries[0].afterSha256).toBeDefined();
  });
});
