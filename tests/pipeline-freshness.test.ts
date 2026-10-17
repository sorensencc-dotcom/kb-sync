/**
 * Regression tests for the source -> synthesis -> wiki -> retrieval freshness repair.
 * Everything runs against temporary git repositories, local bare repositories (as the
 * "remote wiki") and temporary SQLite files. Nothing touches the real wiki or network.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  synthesizeAllEntities,
  checkGeneratedFreshness,
  entityPageId,
  entityPageRelPath,
  legacyEntityRelPath,
} from '../modules/wiki/entity-synthesizer.ts';
import {
  GENERATED_MANIFEST_NAME,
  PUBLISH_MANIFEST_NAME,
  planFlatCopies,
  planOwnedRemovals,
  readOwnershipManifest,
  sha256Text,
} from '../modules/wiki/generated-ownership.mjs';
import { evaluateReceiptFreshness, scanRepository, scanCrossRepoDrift } from '../modules/wiki/cross-repo-drift-scanner.ts';
import { syncRepositoryWiki } from '../modules/wiki/fleet-wiki-reconciler.ts';
import { runPipeline, evaluatePipelineStatus, type PipelineOptions } from '../modules/wiki/pipeline-runner.ts';
import { publishWiki, removeDirRobust } from '../scripts/sync-github-wiki.mjs';
import { getDatabase } from '../modules/cache/db-schema.mjs';

// Make commits inside the temporary clones independent of the machine's git identity.
process.env.GIT_AUTHOR_NAME = 'kb-sync-test';
process.env.GIT_AUTHOR_EMAIL = 'kb-sync-test@example.invalid';
process.env.GIT_COMMITTER_NAME = 'kb-sync-test';
process.env.GIT_COMMITTER_EMAIL = 'kb-sync-test@example.invalid';

const tmpDirs: string[] = [];
after(() => {
  for (const d of tmpDirs) {
    try {
      removeDirRobust(d);
    } catch {
      /* Windows may briefly hold git/sqlite handles; a leftover temp dir must not fail the suite */
    }
  }
});

function tmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `kbs-${prefix}-`));
  tmpDirs.push(d);
  return d;
}

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return (r.stdout || '').trim();
}

function write(root: string, rel: string, content: string) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function read(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function mkRepo(files: Record<string, string>): string {
  const dir = tmp('repo');
  git(dir, 'init', '-q', '-b', 'main');
  for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

/** A local bare repository standing in for the remote GitHub wiki, seeded so `main` exists. */
function mkBareRemote(): string {
  const dir = tmp('remote');
  git(dir, 'init', '-q', '--bare', '-b', 'main');
  const seed = tmp('seed');
  git(seed, 'init', '-q', '-b', 'main');
  write(seed, 'Seed.md', '# seed page that predates the pipeline\n');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-q', '-m', 'seed');
  git(seed, 'push', '-q', dir, 'HEAD:main');
  return dir;
}

function remoteHead(remote: string): string {
  return git(remote, 'rev-parse', 'main');
}

function cloneRemote(remote: string): string {
  const dir = tmp('inspect');
  fs.rmSync(dir, { recursive: true, force: true });
  git(os.tmpdir(), 'clone', '-q', remote, dir);
  return dir;
}

/** path -> sha of every file below root (ignoring .git), to prove a run mutated nothing. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out[path.relative(root, full).replace(/\\/g, '/')] = sha256Text(fs.readFileSync(full, 'utf8'));
    }
  };
  walk(root);
  return out;
}

const stubs = {
  detectDrift: () => ({ status: 'NO_DRIFT', stale_pages_count: 0 }),
  validateContract: () => ({ ok: true, detail: 'stub contract validator ok' }),
};

const AUTH = 'export function login(user: string) { return user; }\n';
const BILLING = 'export function charge(cents: number) { return cents; }\n';

// ---------------------------------------------------------------------------
// 1. Same-named source files produce distinct pages
// ---------------------------------------------------------------------------
test('1. same-named source files produce distinct, collision-safe pages (and keep legacy links)', () => {
  const repo = mkRepo({ 'src/auth/index.ts': AUTH, 'src/billing/index.ts': BILLING });
  const res = synthesizeAllEntities({ repoName: 'demo', repoRoot: repo });
  assert.equal(res.status, 'OK');
  assert.equal(res.entitiesGenerated, 2);

  const authPage = entityPageRelPath('demo', 'src/auth/index.ts');
  const billingPage = entityPageRelPath('demo', 'src/billing/index.ts');
  assert.notEqual(authPage, billingPage);
  const auth = read(path.join(repo, 'wiki'), authPage);
  const billing = read(path.join(repo, 'wiki'), billingPage);
  assert.match(auth, /sourceFile: src\/auth\/index\.ts/);
  assert.match(auth, /login/);
  assert.match(billing, /sourceFile: src\/billing\/index\.ts/);
  assert.match(billing, /charge/);
  assert.doesNotMatch(auth, /charge/);

  // Identity depends on repository AND full path, not just the basename.
  assert.notEqual(entityPageId('repo-one', 'x/a.ts'), entityPageId('repo-two', 'x/a.ts'));
  assert.notEqual(entityPageId('demo', 'a/b-c.ts'), entityPageId('demo', 'a-b/c.ts'));

  // The old basename page name still resolves, as a disambiguation page listing both.
  const legacy = read(path.join(repo, 'wiki'), legacyEntityRelPath('src/auth/index.ts'));
  assert.equal(legacyEntityRelPath('src/auth/index.ts'), legacyEntityRelPath('src/billing/index.ts'));
  assert.match(legacy, /Several source files share this name \(2\)/);
  assert.ok(legacy.includes(entityPageId('demo', 'src/auth/index.ts')));
  assert.ok(legacy.includes(entityPageId('demo', 'src/billing/index.ts')));

  // Honest labelling: this is a metadata inventory, not semantic content.
  assert.match(auth, /generationKind: metadata-inventory/);
  assert.match(auth, /semanticContent: false/);
  assert.equal(res.semanticRegeneration, false);
});

test('1b. flat basename copies are only published when unambiguous', () => {
  const { flat, collisions } = planFlatCopies(['index.ts.md', 'a/index.ts.md', 'b/index.ts.md', 'x/only.md', 'p/Same.md', 'q/same.md']);
  assert.ok(flat.has('index.ts.md'), 'root-level file keeps the flat name');
  assert.ok(flat.has('x/only.md'));
  assert.ok(!flat.has('a/index.ts.md') && !flat.has('b/index.ts.md'));
  assert.ok(!flat.has('p/Same.md') && !flat.has('q/same.md'), 'case-insensitive collision publishes no flat copy');
  assert.equal(collisions.length, 2);
});

// ---------------------------------------------------------------------------
// 2. A relevant source change invalidates dependent content
// ---------------------------------------------------------------------------
test('2. a source change invalidates only the dependent page until regeneration', () => {
  const repo = mkRepo({ 'src/auth/index.ts': AUTH, 'src/billing/index.ts': BILLING });
  synthesizeAllEntities({ repoName: 'demo', repoRoot: repo });
  assert.equal(checkGeneratedFreshness({ repoName: 'demo', repoRoot: repo }).fresh, true);

  write(repo, 'src/auth/index.ts', AUTH + 'export function logout() {}\n');
  const stale = checkGeneratedFreshness({ repoName: 'demo', repoRoot: repo });
  assert.equal(stale.fresh, false);
  assert.deepEqual(stale.stale.map((s) => s.sourceFile), ['src/auth/index.ts']);
  assert.equal(stale.sourcesHashCurrent === stale.sourcesHashRecorded, false);

  write(repo, 'src/new/extra.ts', 'export const extra = 1;\n');
  assert.deepEqual(checkGeneratedFreshness({ repoName: 'demo', repoRoot: repo }).missing, ['src/new/extra.ts']);

  const res = synthesizeAllEntities({ repoName: 'demo', repoRoot: repo });
  assert.equal(res.entitiesUpdated, 1);
  assert.equal(res.entitiesGenerated, 1);
  assert.equal(res.entitiesUnchanged, 1);
  assert.match(read(path.join(repo, 'wiki'), entityPageRelPath('demo', 'src/auth/index.ts')), /logout/);
  assert.equal(checkGeneratedFreshness({ repoName: 'demo', repoRoot: repo }).fresh, true);
});

// ---------------------------------------------------------------------------
// 3. Old or revision-mismatched receipts cannot establish current freshness
// ---------------------------------------------------------------------------
test('3. evaluateReceiptFreshness rejects old, mismatched, unpublished and unverifiable receipts', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const head = 'a'.repeat(40);
  const good = {
    repository: 'demo',
    remote_wiki_url: 'x',
    local_code_head: head,
    remote_wiki_head: 'b'.repeat(40),
    verified_at: '2026-10-17T11:00:00Z',
    total_pages_published: 3,
    sync_status: 'SYNCHRONIZED' as const,
  };
  assert.equal(evaluateReceiptFreshness(good, head, { now, repository: 'demo' }).fresh, true);
  const reasons = (r: any, h: string | null = head) => evaluateReceiptFreshness(r, h, { now, repository: 'demo' }).reasons.join('|');
  assert.match(reasons({ ...good, verified_at: '2026-09-29T02:56:27Z' }), /RECEIPT_EXPIRED/);
  assert.match(reasons({ ...good, local_code_head: 'c'.repeat(40) }), /RECEIPT_REVISION_MISMATCH/);
  assert.match(reasons({ ...good, local_code_head: '' }), /RECEIPT_REVISION_MISSING/);
  assert.match(reasons({ ...good, remote_wiki_head: '' }), /RECEIPT_REMOTE_HEAD_MISSING/);
  assert.match(reasons({ ...good, sync_status: 'PREPARED_NOT_PUSHED' }), /RECEIPT_STATUS_NOT_PUBLISHED/);
  assert.match(reasons({ ...good, verified_at: '2026-10-18T12:00:00Z' }), /RECEIPT_FUTURE_DATED/);
  assert.match(reasons({ ...good, repository: 'other' }), /RECEIPT_REPOSITORY_MISMATCH/);
  assert.match(reasons(good, null), /RECEIPT_REPO_HEAD_UNAVAILABLE/);
  assert.equal(evaluateReceiptFreshness(null, head).fresh, false);
});

test('3b. the cross-repo scanner does not report CLEAN on a stale receipt or an old drift report', () => {
  const repo = mkRepo({ 'README.md': '# demo\n' });
  const head = git(repo, 'rev-parse', 'HEAD');
  const outputPath = path.join(tmp('scan'), 'report.json');
  const scan = (extra: object = {}) =>
    scanCrossRepoDrift({ repoList: ['demo'], customPathMap: { demo: repo }, allowDisallowedPaths: true, outputPath, ...extra });
  const nowIso = () => new Date().toISOString();
  const driftReport = (timestamp: string) =>
    write(repo, '.drift-report.json', JSON.stringify({ timestamp, status: 'NO_DRIFT', drifted_sources: [], summary: { total_sources_checked: 5, stale_pages_count: 0 } }));
  const receipt = (over: object) =>
    write(repo, '.wiki-sync-receipt.json', JSON.stringify({ repository: 'demo', remote_wiki_url: 'x', local_code_head: head, remote_wiki_head: 'b'.repeat(40), verified_at: nowIso(), total_pages_published: 1, sync_status: 'SYNCHRONIZED', ...over }));

  // Matching, recent receipt + recent drift report => clean.
  driftReport(nowIso());
  receipt({});
  let r = scan();
  assert.equal(r.repositories[0].remote_sync_status, 'SYNCHRONIZED');
  assert.equal(r.overall_status, 'CLEAN');

  // Receipt for a different revision (the "SYNCHRONIZED" claim is about old code) => not clean.
  receipt({ local_code_head: 'd'.repeat(40) });
  r = scan();
  assert.equal(r.repositories[0].remote_sync_status, 'STALE_RECEIPT');
  assert.ok(r.repositories[0].violations.some((v) => v.startsWith('RECEIPT_REVISION_MISMATCH')));
  assert.notEqual(r.overall_status, 'CLEAN');
  assert.equal(r.summary.clean_repositories, 0);

  // Receipt with an empty remote head (as the old publisher wrote) => not clean.
  receipt({ remote_wiki_head: '' });
  assert.equal(scan().repositories[0].remote_sync_status, 'STALE_RECEIPT');

  // Matching revision but old => not clean.
  receipt({ verified_at: '2026-09-29T02:56:27.279Z' });
  r = scan();
  assert.equal(r.repositories[0].remote_sync_status, 'STALE_RECEIPT');
  assert.ok(r.repositories[0].violations.some((v) => v.startsWith('RECEIPT_EXPIRED')));
  assert.notEqual(r.overall_status, 'CLEAN');

  // A fresh receipt cannot rescue an old "no drift" report: history is not a current check.
  receipt({});
  driftReport('2026-09-01T00:00:00Z');
  r = scan();
  assert.ok(r.repositories[0].violations.some((v) => v.startsWith('STALE_DRIFT_REPORT')));
  assert.equal(r.repositories[0].status, 'DEGRADED');
  assert.notEqual(r.overall_status, 'CLEAN');

  // Direct single-repo API agrees.
  assert.equal(scanRepository('demo', repo, { allowDisallowedPaths: true }).status, 'DEGRADED');
});

// ---------------------------------------------------------------------------
// 4. Required generation failure prevents a healthy end-to-end result
// ---------------------------------------------------------------------------
test('4a. an unreadable source fails generation and writes no partial output', () => {
  const repo = mkRepo({ 'src/auth/index.ts': AUTH, 'src/billing/index.ts': BILLING });
  const res = synthesizeAllEntities({
    repoName: 'demo',
    repoRoot: repo,
    readSource: (p) => {
      if (p.includes('billing')) throw new Error('EACCES simulated');
      return fs.readFileSync(p, 'utf8');
    },
  });
  assert.equal(res.status, 'FAILED');
  assert.equal(res.failures[0].stage, 'read');
  assert.equal(fs.existsSync(path.join(repo, 'wiki', 'entities')), false);
  assert.equal(fs.existsSync(path.join(repo, 'wiki', GENERATED_MANIFEST_NAME)), false);
});

test('4b. fleet publication stops on generation failure: FAILED, nothing pushed, no receipt', () => {
  const repo = mkRepo({ 'src/auth/index.ts': AUTH, 'wiki/Home.md': '# demo\n' });
  const remote = mkBareRemote();
  const seedHead = remoteHead(remote);
  const failing = () => ({ status: 'FAILED', failures: [{ file: 'src/auth/index.ts', stage: 'read', error: 'boom' }], generationKind: 'metadata-inventory', sourcesHash: 'x' }) as any;
  const r = syncRepositoryWiki('demo', repo, { remoteWikiUrl: remote, synthesize: failing });
  assert.equal(r.status, 'FAILED');
  assert.equal(r.stage, 'generation');
  assert.equal(fs.existsSync(path.join(repo, '.wiki-sync-receipt.json')), false);
  assert.equal(fs.existsSync(path.join(repo, '.wiki-publish-temp')), false);
  assert.equal(remoteHead(remote), seedHead, 'nothing may be pushed after a failed generation');

  const thrown = syncRepositoryWiki('demo', repo, { remoteWikiUrl: remote, synthesize: () => { throw new Error('kaboom'); } });
  assert.equal(thrown.status, 'FAILED');
  assert.equal(thrown.stage, 'generation');
});

test('4c. pipeline: required stage failure => FAILED, downstream not run, never healthy', async () => {
  const repo = mkRepo({ 'src/auth/index.ts': AUTH });
  const dbPath = path.join(tmp('db'), 'k.db');
  const failing = (() => ({ status: 'FAILED', failures: [{ file: 'src/auth/index.ts', stage: 'read', error: 'boom' }] })) as any;
  const state = await runPipeline({ repoRoot: repo, repoName: 'demo', dbPath, synthesize: failing, ...stubs });
  assert.equal(state.overall, 'FAILED');
  assert.equal(state.stages.source_checked.status, 'ok');
  assert.equal(state.stages.generation_complete.status, 'failed');
  for (const s of ['content_validated', 'publication_prepared', 'indexing_complete'] as const) assert.equal(state.stages[s].status, 'not_run');
  assert.equal(fs.existsSync(dbPath), false, 'nothing may be indexed after a failed generation');
  const status = evaluatePipelineStatus({ repoRoot: repo, repoName: 'demo' });
  assert.equal(status.overall, 'FAILED');

  // A failing validator also blocks a healthy result even though generation succeeded.
  const v = await runPipeline({ repoRoot: repo, repoName: 'demo', dbPath, validateContract: () => ({ ok: false, detail: 'contract broke' }), detectDrift: stubs.detectDrift });
  assert.equal(v.stages.generation_complete.status, 'ok');
  assert.equal(v.stages.content_validated.status, 'failed');
  assert.equal(v.overall, 'FAILED');
  assert.equal(v.stages.indexing_complete.status, 'not_run');
});

test('4d. an interrupted run is reported, not treated as healthy', () => {
  const repo = mkRepo({ 'src/a.ts': 'export const a = 1;\n' });
  write(repo, '.pipeline-state.json', JSON.stringify({ version: 1, repository: 'demo', overall: 'IN_PROGRESS', started_at: new Date().toISOString(), mode: { publish: false, semantic: null }, sources_hash: 'x', stages: {} }));
  const s = evaluatePipelineStatus({ repoRoot: repo, repoName: 'demo' });
  assert.notEqual(s.overall, 'HEALTHY');
  assert.notEqual(s.overall, 'LOCAL_ONLY');
  assert.ok(s.reasons.some((r) => r.startsWith('RUN_INTERRUPTED')));
});

// ---------------------------------------------------------------------------
// 5. Deleted / renamed sources reconcile without destroying authored content
// ---------------------------------------------------------------------------
const LEGACY_PAGE = `---
title: gone.ts
category: utilities
status: active
sourceRepository: demo
sourceFile: src/gone.ts
sha256: 0000
lastCommit: 2026-01-01T00:00:00-05:00
---

# gone.ts

## Overview
Synthesized entity documentation for \`src/gone.ts\` in **demo**.
`;

test('5a. removed and renamed sources reconcile; authored and edited pages are preserved', () => {
  const repo = mkRepo({
    'src/a.ts': 'export const a = 1;\n',
    'src/b.ts': 'export const b = 2;\n',
    'src/d.ts': 'export const d = 4;\n',
    'wiki/Home.md': '# human home\n',
    'wiki/entities/HUMAN-NOTES.md': '# written by a person\n',
    'wiki/entities/gone.ts.md': LEGACY_PAGE,
  });
  const wiki = path.join(repo, 'wiki');
  const first = synthesizeAllEntities({ repoName: 'demo', repoRoot: repo });
  assert.equal(first.status, 'OK');
  assert.equal(first.legacyAdopted, 1, 'pre-manifest generated page is adopted by exact signature');
  assert.ok(first.removed.includes('entities/gone.ts.md'), 'its source no longer exists, so it is removed');
  assert.equal(fs.existsSync(path.join(wiki, 'entities', 'gone.ts.md')), false);
  assert.equal(read(wiki, 'entities/HUMAN-NOTES.md'), '# written by a person\n');
  assert.equal(read(wiki, 'Home.md'), '# human home\n');

  const pageA = entityPageRelPath('demo', 'src/a.ts');
  const pageB = entityPageRelPath('demo', 'src/b.ts');
  const pageD = entityPageRelPath('demo', 'src/d.ts');
  assert.ok(fs.existsSync(path.join(wiki, pageA)) && fs.existsSync(path.join(wiki, pageB)));

  // A person annotates a generated page, then its source is deleted.
  fs.appendFileSync(path.join(wiki, pageD), '\nHAND-WRITTEN NOTE worth keeping\n');
  fs.rmSync(path.join(repo, 'src/a.ts'));
  fs.rmSync(path.join(repo, 'src/d.ts'));
  fs.renameSync(path.join(repo, 'src/b.ts'), path.join(repo, 'src/b2.ts'));

  const second = synthesizeAllEntities({ repoName: 'demo', repoRoot: repo });
  assert.equal(second.status, 'OK');
  const pageB2 = entityPageRelPath('demo', 'src/b2.ts');
  assert.ok(second.removed.includes(pageA));
  assert.ok(second.removed.includes(pageB));
  assert.deepEqual(second.renamed, [{ from: pageB, to: pageB2 }]);
  assert.equal(fs.existsSync(path.join(wiki, pageA)), false);
  assert.equal(fs.existsSync(path.join(wiki, pageB)), false);
  assert.ok(fs.existsSync(path.join(wiki, pageB2)));
  assert.equal(fs.existsSync(path.join(wiki, legacyEntityRelPath('src/a.ts'))), false, 'alias for the deleted source is removed too');

  // The edited page is kept, flagged, and survives further runs without being re-adopted and deleted.
  assert.deepEqual(second.preservedModified, [pageD]);
  assert.match(read(wiki, pageD), /HAND-WRITTEN NOTE worth keeping/);
  const third = synthesizeAllEntities({ repoName: 'demo', repoRoot: repo });
  assert.deepEqual(third.preservedModified, [pageD]);
  assert.match(read(wiki, pageD), /HAND-WRITTEN NOTE worth keeping/);
  assert.equal(read(wiki, 'entities/HUMAN-NOTES.md'), '# written by a person\n');

  const f = checkGeneratedFreshness({ repoName: 'demo', repoRoot: repo });
  assert.equal(f.fresh, true);
  assert.deepEqual(f.preservedOrphans, [pageD]);
  const manifest = readOwnershipManifest(path.join(wiki, GENERATED_MANIFEST_NAME)) as any;
  assert.equal(manifest.files[pageD].orphanedEdited, true);
});

test('5b. ownership plan never removes unknown or edited files and refuses path traversal', () => {
  const dir = tmp('own');
  write(dir, 'owned.md', 'generated');
  write(dir, 'edited.md', 'generated but edited');
  write(dir, 'human.md', 'mine');
  const previous = {
    files: {
      'owned.md': { sha256: sha256Text('generated') },
      'edited.md': { sha256: sha256Text('generated') },
      '../escape.md': { sha256: sha256Text('x') },
    },
  };
  const plan = planOwnedRemovals({ baseDir: dir, previous: previous as any, keep: new Set() });
  assert.deepEqual(plan.remove, ['owned.md']);
  assert.deepEqual(plan.preservedModified, ['edited.md']);
  assert.deepEqual(plan.unsafe, ['../escape.md']);
  // Unknown ownership (no manifest) means nothing is removable.
  assert.deepEqual(planOwnedRemovals({ baseDir: dir, previous: null, keep: new Set() }).remove, []);
});

test('5c. the publisher removes obsolete generated pages from the wiki but keeps pages it does not own', async () => {
  const repo = mkRepo({ 'src/a.ts': 'export const a = 1;\n', 'src/b.ts': 'export const b = 2;\n', 'wiki/Home.md': '# demo\n' });
  const remote = mkBareRemote();
  const publish = () => publishWiki({ repoRoot: repo, repoName: 'demo', sourceDir: path.join(repo, 'wiki'), targetDir: path.join(repo, '.wiki-publish-temp'), push: true, repoUrl: remote });

  synthesizeAllEntities({ repoName: 'demo', repoRoot: repo });
  const first = await publish();
  assert.equal(first.sync_status, 'SYNCHRONIZED');
  const pageA = entityPageRelPath('demo', 'src/a.ts');
  const pageB = entityPageRelPath('demo', 'src/b.ts');
  let inspect = cloneRemote(remote);
  assert.ok(fs.existsSync(path.join(inspect, pageA)) && fs.existsSync(path.join(inspect, pageB)));
  assert.ok(readOwnershipManifest(path.join(inspect, PUBLISH_MANIFEST_NAME)));

  // Somebody adds a page directly on the remote wiki.
  write(inspect, 'Human-Page.md', '# added on the wiki by a person\n');
  git(inspect, 'add', '-A');
  git(inspect, 'commit', '-q', '-m', 'human edit');
  git(inspect, 'push', '-q', 'origin', 'HEAD');

  fs.rmSync(path.join(repo, 'src/a.ts'));
  synthesizeAllEntities({ repoName: 'demo', repoRoot: repo });
  const second = await publish();
  assert.equal(second.sync_status, 'SYNCHRONIZED');
  assert.equal(second.stale_pages_removed >= 1, true);
  inspect = cloneRemote(remote);
  assert.equal(fs.existsSync(path.join(inspect, pageA)), false, 'obsolete generated page removed from the wiki');
  assert.ok(fs.existsSync(path.join(inspect, pageB)));
  assert.equal(read(inspect, 'Human-Page.md'), '# added on the wiki by a person\n');
  assert.ok(fs.existsSync(path.join(inspect, 'Seed.md')), 'pages the publisher does not own stay on the wiki');
});

// ---------------------------------------------------------------------------
// Publisher honesty + dry-run is genuinely non-mutating
// ---------------------------------------------------------------------------
test('7. the publisher never reports SYNCHRONIZED without a verified push and keeps the last real receipt', async () => {
  const repo = mkRepo({ 'src/a.ts': 'export const a = 1;\n', 'wiki/Home.md': '# demo\n' });
  synthesizeAllEntities({ repoName: 'demo', repoRoot: repo });
  const remote = mkBareRemote();
  const seedHead = remoteHead(remote);
  const sentinel = JSON.stringify({ sentinel: 'last-real-publication' });
  write(repo, '.wiki-sync-receipt.json', sentinel);

  // Prepare-only (what the nightly stage and CI step actually did: no --push).
  const prepared = await publishWiki({ repoRoot: repo, repoName: 'demo', sourceDir: path.join(repo, 'wiki'), targetDir: path.join(repo, '.wiki-publish-temp'), repoUrl: remote, push: false });
  assert.equal(prepared.sync_status, 'PREPARED_NOT_PUSHED');
  assert.equal(prepared.published, false);
  assert.equal(prepared.remote_wiki_head, '');
  assert.equal(read(repo, '.wiki-sync-receipt.json'), sentinel, 'a prepare-only run must not overwrite the receipt');
  assert.equal(remoteHead(remote), seedHead, 'nothing reached the remote');

  const pushed = await publishWiki({ repoRoot: repo, repoName: 'demo', sourceDir: path.join(repo, 'wiki'), targetDir: path.join(repo, '.wiki-publish-temp'), repoUrl: remote, push: true });
  assert.equal(pushed.sync_status, 'SYNCHRONIZED');
  assert.equal(pushed.remote_wiki_head, git(remote, 'rev-parse', 'main'));
  const onDisk = JSON.parse(read(repo, '.wiki-sync-receipt.json'));
  assert.equal(onDisk.remote_wiki_head, pushed.remote_wiki_head);

  const again = await publishWiki({ repoRoot: repo, repoName: 'demo', sourceDir: path.join(repo, 'wiki'), targetDir: path.join(repo, '.wiki-publish-temp'), repoUrl: remote, push: true });
  assert.equal(again.sync_status, 'UP_TO_DATE');
});

test('8. fleet dry-run mutates nothing and never claims the wiki is current while changes are pending', () => {
  const repo = mkRepo({
    'src/a.ts': 'export const a = 1;\n',
    'wiki/Home.md': '# demo\n',
    'wiki/research/notes.md': '# research notes\n',
    'wiki/concepts/notes.md': '# concept notes\n',
  });
  const remote = mkBareRemote();
  const seedHead = remoteHead(remote);
  const before = snapshot(repo);

  const dry = syncRepositoryWiki('demo', repo, { dryRun: true, remoteWikiUrl: remote });
  assert.equal(dry.status, 'DRY_RUN_PENDING');
  assert.deepEqual(snapshot(repo), before, 'dry run must not write anything into the repository');
  assert.equal(fs.existsSync(path.join(repo, 'wiki', 'entities')), false);
  assert.equal(fs.existsSync(path.join(repo, '.wiki-sync-receipt.json')), false);
  assert.equal(remoteHead(remote), seedHead, 'remote untouched');

  const real = syncRepositoryWiki('demo', repo, { remoteWikiUrl: remote });
  assert.equal(real.status, 'SYNCHRONIZED');
  assert.equal(real.flatCollisions, 1, 'research/notes.md vs concepts/notes.md must not both claim notes.md');
  const inspect = cloneRemote(remote);
  assert.ok(fs.existsSync(path.join(inspect, 'research/notes.md')) && fs.existsSync(path.join(inspect, 'concepts/notes.md')));
  assert.equal(fs.existsSync(path.join(inspect, 'notes.md')), false);
  const receipt = JSON.parse(read(repo, '.wiki-sync-receipt.json'));
  assert.equal(receipt.remote_wiki_head, git(remote, 'rev-parse', 'main'));
  assert.equal(evaluateReceiptFreshness(receipt, git(repo, 'rev-parse', 'HEAD'), { repository: 'demo' }).fresh, true);

  const after = syncRepositoryWiki('demo', repo, { dryRun: true, remoteWikiUrl: remote });
  assert.equal(after.status, 'UP_TO_DATE');
});

// ---------------------------------------------------------------------------
// 6. A changed source propagates through generation, validation, publication, indexing
// ---------------------------------------------------------------------------
test('6. end to end: a changed source reaches the generated page, the publish tree, the remote wiki and the FTS index', async () => {
  const repo = mkRepo({
    'README.md': '# demo\n',
    'src/auth/index.ts': AUTH,
    'src/billing/index.ts': BILLING,
    'wiki/Home.md': '# demo home\n',
    'wiki/concepts/overview.md': '# Overview\n\nHuman-authored explanation that must survive.\n',
  });
  const remote = mkBareRemote();
  const dbPath = path.join(tmp('db'), 'knowledge.db');
  const opts: PipelineOptions = { repoRoot: repo, repoName: 'demo', dbPath, remoteWikiUrl: remote, publish: true, ...stubs };
  const authId = entityPageId('demo', 'src/auth/index.ts');
  const billingId = entityPageId('demo', 'src/billing/index.ts');
  const indexedRow = (id: string) => {
    const db = getDatabase(dbPath);
    try {
      return db.prepare('SELECT sha256, content FROM kb_documents WHERE id = ?').get(`wiki/entities/${id}.md`) as { sha256: string; content: string } | undefined;
    } finally {
      db.close();
    }
  };
  const ftsHits = (term: string) => {
    const db = getDatabase(dbPath);
    try {
      return (db.prepare('SELECT id FROM kb_fts WHERE kb_fts MATCH ?').all(term) as Array<{ id: string }>).map((r) => r.id);
    } finally {
      db.close();
    }
  };

  // --- first full run ---
  const s1 = await runPipeline(opts);
  for (const s of ['source_checked', 'generation_complete', 'content_validated', 'publication_prepared', 'indexing_complete', 'publication_verified'] as const) {
    assert.equal(s1.stages[s].status, 'ok', `${s}: ${s1.stages[s].error ?? ''}`);
  }
  assert.equal(s1.overall, 'HEALTHY');
  assert.equal(s1.generation_kind, 'metadata-inventory');
  assert.equal(s1.semantic_regeneration, 'not_performed', 'a metadata-only refresh must not be labelled semantic');

  let inspect = cloneRemote(remote);
  assert.match(read(inspect, `entities/${authId}.md`), /login/);
  assert.match(read(inspect, 'concepts/overview.md'), /Human-authored explanation/);
  const receipt = JSON.parse(read(repo, '.wiki-sync-receipt.json'));
  assert.equal(receipt.remote_wiki_head, git(remote, 'rev-parse', 'main'));
  assert.equal(evaluateReceiptFreshness(receipt, git(repo, 'rev-parse', 'HEAD'), { repository: 'demo' }).fresh, true);

  const page = read(path.join(repo, 'wiki'), `entities/${authId}.md`);
  assert.equal(indexedRow(authId)?.sha256, sha256Text(page));
  assert.ok(ftsHits('login').includes(`wiki/entities/${authId}.md`));
  assert.equal(evaluatePipelineStatus(opts).overall, 'HEALTHY');

  // --- unchanged re-run resumes the idempotent stages ---
  const s2 = await runPipeline(opts);
  assert.equal(s2.stages.generation_complete.resumed, true);
  assert.equal(s2.stages.content_validated.resumed, true);
  assert.equal(s2.overall, 'HEALTHY');

  // --- change a source: everything downstream must be reported stale, then converge ---
  const billingBefore = read(path.join(repo, 'wiki'), `entities/${billingId}.md`);
  write(repo, 'src/auth/index.ts', AUTH + 'export function logoutEverywhere() {}\n');
  const stale = evaluatePipelineStatus(opts);
  assert.equal(stale.overall, 'DEGRADED');
  assert.ok(stale.reasons.includes('SOURCES_CHANGED_SINCE_LAST_RUN'));
  assert.ok(stale.reasons.some((r) => r.startsWith('GENERATED_PAGES_NOT_CURRENT')));

  const s3 = await runPipeline(opts);
  assert.equal(s3.overall, 'HEALTHY');
  assert.notEqual(s3.sources_hash, s1.sources_hash);
  assert.notEqual(s3.outputs_hash, s1.outputs_hash);
  assert.equal(s3.stages.generation_complete.resumed, undefined, 'generation must re-run when its inputs changed');
  const newPage = read(path.join(repo, 'wiki'), `entities/${authId}.md`);
  assert.match(newPage, /logoutEverywhere/);
  assert.equal(read(path.join(repo, 'wiki'), `entities/${billingId}.md`), billingBefore, 'unrelated page untouched');
  inspect = cloneRemote(remote);
  assert.match(read(inspect, `entities/${authId}.md`), /logoutEverywhere/);
  assert.equal(indexedRow(authId)?.sha256, sha256Text(newPage));
  assert.match(indexedRow(authId)!.content, /logoutEverywhere/);
  assert.ok(ftsHits('logoutEverywhere').includes(`wiki/entities/${authId}.md`));

  // --- new commit: sources/pages are still current, but the receipt now names an old revision ---
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'commit the change');
  const afterCommit = evaluatePipelineStatus(opts);
  assert.equal(afterCommit.overall, 'DEGRADED');
  assert.ok(afterCommit.reasons.some((r) => r.startsWith('PUBLICATION_NOT_CURRENT') && r.includes('RECEIPT_REVISION_MISMATCH')));
  const s4 = await runPipeline(opts);
  assert.equal(s4.overall, 'HEALTHY');
  assert.equal(evaluatePipelineStatus(opts).overall, 'HEALTHY');

  // --- a failing remote must not yield a healthy result, while local stages still succeed ---
  const broken = await runPipeline({ ...opts, remoteWikiUrl: path.join(os.tmpdir(), 'kbs-does-not-exist.git'), force: true });
  assert.equal(broken.stages.indexing_complete.status, 'ok');
  assert.equal(broken.stages.publication_verified.status, 'failed');
  assert.equal(broken.overall, 'FAILED');
});

test('6b. without --publish the result is LOCAL_ONLY and says publication was not verified', async () => {
  const repo = mkRepo({ 'src/a.ts': 'export const a = 1;\n', 'wiki/Home.md': '# demo\n' });
  const dbPath = path.join(tmp('db'), 'k.db');
  const s = await runPipeline({ repoRoot: repo, repoName: 'demo', dbPath, ...stubs });
  assert.equal(s.overall, 'LOCAL_ONLY');
  assert.equal(s.stages.publication_verified.status, 'skipped');
  assert.match(s.stages.publication_verified.detail ?? '', /publication not requested/);
  assert.equal(fs.existsSync(path.join(repo, '.wiki-sync-receipt.json')), false);
});

test('6c. a second run cannot start while another holds the lock', async () => {
  const repo = mkRepo({ 'src/a.ts': 'export const a = 1;\n' });
  write(repo, '.pipeline.lock', JSON.stringify({ pid: process.pid, at: Date.now() }));
  await assert.rejects(() => runPipeline({ repoRoot: repo, repoName: 'demo', dbPath: path.join(tmp('db'), 'k.db'), ...stubs }), /PIPELINE_LOCKED/);
  // A lock left by a dead process is taken over (restart safety).
  write(repo, '.pipeline.lock', JSON.stringify({ pid: 2147483646, at: Date.now() }));
  const s = await runPipeline({ repoRoot: repo, repoName: 'demo', dbPath: path.join(tmp('db'), 'k.db'), ...stubs });
  assert.equal(s.overall, 'LOCAL_ONLY');
  assert.equal(fs.existsSync(path.join(repo, '.pipeline.lock')), false);
});

test('9. publishWiki derives every default from the supplied repoRoot (never kb-sync\'s own wiki/.wiki-publish-temp)', async () => {
  const repo = mkRepo({ 'wiki/Home.md': '# demo\n', 'wiki/page.md': '# page\n' });
  const remote = mkBareRemote();
  const receipt = await publishWiki({ repoRoot: repo, repoName: 'demo', repoUrl: remote, push: true });
  assert.equal(receipt.sync_status, 'SYNCHRONIZED');
  assert.ok(fs.existsSync(path.join(repo, '.wiki-publish-temp', '.git')), 'scratch clone lives inside the supplied root');
  assert.equal(receipt.repository, 'demo');
  assert.match(read(cloneRemote(remote), 'page.md'), /# page/);
});
