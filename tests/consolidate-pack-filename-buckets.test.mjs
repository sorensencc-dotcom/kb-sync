import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { consolidatePacks, resolveFilenameBuckets } from '../scripts/consolidate-pack.mjs';

test('resolveFilenameBuckets matches post-war and willys by basename', () => {
  assert.deepEqual(resolveFilenameBuckets('research', 'wiki/research/rfc-gap-02-cic-post-war--x.md'), ['post-war']);
  assert.deepEqual(resolveFilenameBuckets('research', 'wiki/research/willys-jeep.md'), ['willys-overland']);
  assert.deepEqual(
    resolveFilenameBuckets('research', 'wiki/research/rfc-gap-84-cic-post-war-willys-overland.md'),
    ['post-war', 'willys-overland']
  );
});

test('resolveFilenameBuckets ignores directory names and unrelated files', () => {
  assert.deepEqual(resolveFilenameBuckets('research', 'wiki/post-war/other.md'), []);
  assert.deepEqual(resolveFilenameBuckets('research', 'wiki/research/willow-run.md'), []);
});

test('resolveFilenameBuckets still matches catch-all daily notes', () => {
  assert.deepEqual(resolveFilenameBuckets('daily', 'wiki/willys-note.md'), ['willys-overland']);
});

test('resolveFilenameBuckets never overrides an explicit category or excluded domain', () => {
  assert.deepEqual(resolveFilenameBuckets('willow-run', 'wiki/post-war-note.md'), []);
  assert.deepEqual(resolveFilenameBuckets('post-war', 'wiki/willys-note.md'), []);
  assert.deepEqual(resolveFilenameBuckets('software', 'wiki/willys-note.md', new Set(['software'])), []);
});

test('consolidatePacks fills post-war and willys-overland packs from research-tagged notes', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-bucket-'));
  const wikiDir = path.join(rootDir, 'wiki', 'research');
  fs.mkdirSync(wikiDir, { recursive: true });
  fs.writeFileSync(path.join(wikiDir, 'cic-post-war-gap.md'), '---\ncategory: research\n---\nPost-war body.\n', 'utf8');
  fs.writeFileSync(path.join(wikiDir, 'willys-jeep-gap.md'), '---\ncategory: research\n---\nWillys body.\n', 'utf8');
  const outDir = path.join(rootDir, '.nlm_pack');
  fs.mkdirSync(outDir, { recursive: true });

  consolidatePacks({ rootDir, outDir });

  const postWar = fs.readFileSync(path.join(outDir, 'pack_post_war.txt'), 'utf8');
  const willys = fs.readFileSync(path.join(outDir, 'pack_willys_overland.txt'), 'utf8');
  assert.match(postWar, /FILE COUNT: 1/);
  assert.match(postWar, /Post-war body/);
  assert.match(willys, /FILE COUNT: 1/);
  assert.match(willys, /Willys body/);
});
