import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  deriveRepoWikiUrl,
  syncRepositoryWiki,
  reconcileFleetWikis,
  sanitizeSidebarContent,
  isForeignSidebarFragment,
  applyGuardedSidebar,
  listExistingWikiPageSlugs,
  KB_SYNC_ONLY_SIDEBAR_TARGETS,
  type FleetReconcileReport
} from '../modules/wiki/fleet-wiki-reconciler.ts';

test('deriveRepoWikiUrl constructs SSH wiki URLs for canonical names', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'url-test-'));
  try {
    const url = deriveRepoWikiUrl(tmpDir, 'kb-sync');
    assert.equal(url, 'git@github.com:sorensencc-dotcom/kb-sync.wiki.git');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('syncRepositoryWiki skips repositories without docs or wiki directory', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-repo-'));
  try {
    const result = syncRepositoryWiki('empty-repo', tmpDir, { dryRun: true });
    assert.equal(result.status, 'SKIPPED_NO_DOCS');
    assert.equal(result.filesPublished, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('reconcileFleetWikis handles non-existent paths gracefully', () => {
  const report = reconcileFleetWikis({
    repoList: ['non-existent-1', 'non-existent-2'],
    dryRun: true
  });
  assert.equal(report.summary.total_repositories, 2);
  assert.equal(report.summary.failed_count, 2);
  assert.equal(report.overall_status, 'FAILED');
});

test('isForeignSidebarFragment detects kb-sync sidebar stamped into marketplace', () => {
  const kbSyncSidebar = `### Knowledge Base Sync (\`kb-sync\`)\n- [[Home]]\n- [[Competitor Watchlist Drift Engine|competitor-watchlist-drift-engine]]\n`;
  assert.equal(isForeignSidebarFragment(kbSyncSidebar, 'toolforge-marketplace'), true);
  assert.equal(isForeignSidebarFragment(kbSyncSidebar, 'kb-sync'), false);
  assert.equal(
    isForeignSidebarFragment('### Toolforge Platform\n- [[Home]]\n', 'toolforge-marketplace'),
    false
  );
});

test('sanitizeSidebarContent strips missing pages and kb-sync-only foreign targets', () => {
  const contaminated = `### Toolforge Platform
- [[Home]]
- [[Quickstart|QUICKSTART]]
- [[Research Gaps Registry|trm-research-gaps]]
- [[Knowledge Base Sync (kb-sync)|kb-sync-readme]]
- [[Competitor Watchlist Drift Engine|competitor-watchlist-drift-engine]]
- [[Historical Revocation Verification|historical-revocation-verification]]
- [[Mobile WebSocket Heartbeats|mobile-websocket-heartbeats]]
- [[Documentation Catalog|DOCS_INDEX]]
`;
  const existing = new Set(['Home', 'QUICKSTART', 'DOCS_INDEX', 'trm-research-gaps', 'kb-sync-readme', 'competitor-watchlist-drift-engine', 'historical-revocation-verification', 'mobile-websocket-heartbeats']);
  const result = sanitizeSidebarContent(contaminated, existing, { repoName: 'toolforge-marketplace' });
  assert.equal(result.skippedForeign, false);
  assert.match(result.content, /\[\[Home\]\]/);
  assert.match(result.content, /QUICKSTART/);
  assert.match(result.content, /DOCS_INDEX/);
  for (const blocked of KB_SYNC_ONLY_SIDEBAR_TARGETS) {
    assert.equal(result.content.includes(blocked), false, `expected ${blocked} stripped`);
    assert.ok(result.removedTargets.includes(blocked), `expected ${blocked} in removedTargets`);
  }
});

test('sanitizeSidebarContent skips entire foreign kb-sync sidebar for other products', () => {
  const foreign = `### Knowledge Base Sync (\`kb-sync\`)
- [[Home]]
- [[Competitor Watchlist Drift Engine|competitor-watchlist-drift-engine]]
`;
  const existing = new Set(['Home', 'competitor-watchlist-drift-engine']);
  const result = sanitizeSidebarContent(foreign, existing, { repoName: 'toolforge-marketplace' });
  assert.equal(result.skippedForeign, true);
  assert.equal(result.content.trim(), '');
});

test('applyGuardedSidebar prefers skip/generate over stamping foreign fragments', () => {
  const wikiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marketplace-wiki-'));
  try {
    fs.writeFileSync(path.join(wikiDir, 'Home.md'), '# Home\n');
    fs.writeFileSync(path.join(wikiDir, 'QUICKSTART.md'), '# Quickstart\n');
    fs.writeFileSync(path.join(wikiDir, 'competitor-watchlist-drift-engine.md'), '# foreign leak\n');

    const sourceSidebar = path.join(wikiDir, 'source-sidebar.md');
    fs.writeFileSync(
      sourceSidebar,
      `### Knowledge Base Sync (\`kb-sync\`)\n- [[Home]]\n- [[Competitor Watchlist Drift Engine|competitor-watchlist-drift-engine]]\n`
    );

    const result = applyGuardedSidebar({
      repoName: 'toolforge-marketplace',
      wikiDir,
      sourceSidebarPath: sourceSidebar,
    });

    assert.equal(result.skippedForeign, true);
    assert.equal(result.mode, 'skipped-foreign-generated-default');
    const written = fs.readFileSync(path.join(wikiDir, '_Sidebar.md'), 'utf8');
    assert.match(written, /toolforge-marketplace Wiki/);
    assert.equal(written.includes('competitor-watchlist-drift-engine'), false);
    assert.equal(written.includes('Knowledge Base Sync'), false);
  } finally {
    fs.rmSync(wikiDir, { recursive: true, force: true });
  }
});

test('applyGuardedSidebar respects marketplace allowlist even when foreign pages exist on disk', () => {
  const wikiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marketplace-allow-'));
  try {
    fs.writeFileSync(path.join(wikiDir, 'Home.md'), '# Home\n');
    fs.writeFileSync(path.join(wikiDir, 'QUICKSTART.md'), '# Quickstart\n');
    fs.writeFileSync(path.join(wikiDir, 'trm-research-gaps.md'), '# should not link\n');
    fs.writeFileSync(path.join(wikiDir, 'kb-sync-readme.md'), '# should not link\n');

    const sourceSidebar = path.join(wikiDir, 'source-sidebar.md');
    fs.writeFileSync(
      sourceSidebar,
      `### Toolforge Platform
- [[Home]]
- [[Quickstart|QUICKSTART]]
- [[Research Gaps Registry|trm-research-gaps]]
- [[Knowledge Base Sync (kb-sync)|kb-sync-readme]]
`
    );

    const result = applyGuardedSidebar({
      repoName: 'toolforge-marketplace',
      wikiDir,
      sourceSidebarPath: sourceSidebar,
    });

    assert.equal(result.skippedForeign, false);
    assert.ok(result.removedTargets.includes('trm-research-gaps'));
    assert.ok(result.removedTargets.includes('kb-sync-readme'));
    const written = fs.readFileSync(path.join(wikiDir, '_Sidebar.md'), 'utf8');
    assert.match(written, /\[\[Home\]\]/);
    assert.match(written, /QUICKSTART/);
    assert.equal(written.includes('trm-research-gaps'), false);
    assert.equal(written.includes('kb-sync-readme'), false);
  } finally {
    fs.rmSync(wikiDir, { recursive: true, force: true });
  }
});

test('listExistingWikiPageSlugs ignores underscore nav files', () => {
  const wikiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slugs-'));
  try {
    fs.writeFileSync(path.join(wikiDir, 'Home.md'), '#');
    fs.writeFileSync(path.join(wikiDir, '_Sidebar.md'), '#');
    fs.writeFileSync(path.join(wikiDir, '_Footer.md'), '#');
    const slugs = listExistingWikiPageSlugs(wikiDir);
    assert.equal(slugs.has('Home'), true);
    assert.equal(slugs.has('_Sidebar'), false);
    assert.equal(slugs.has('_Footer'), false);
  } finally {
    fs.rmSync(wikiDir, { recursive: true, force: true });
  }
});
