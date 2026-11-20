import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { consolidatePacks, isSoftwareEntityLeak, resolveFilenameBuckets } from '../scripts/consolidate-pack.mjs';
import { buildPacks } from '../scripts/build-packs.mjs';

test('resolveFilenameBuckets matches topic packs by basename', () => {
  assert.deepEqual(resolveFilenameBuckets('research', 'wiki/research/rfc-gap-02-cic-post-war--x.md'), ['post-war']);
  assert.deepEqual(resolveFilenameBuckets('research', 'wiki/research/willow-run.md'), ['willow-run']);
  assert.deepEqual(resolveFilenameBuckets('research', 'wiki/research/cic-ford-executive-dynamics.md'), ['ford-politics']);
  assert.deepEqual(resolveFilenameBuckets('research', 'wiki/research/willys-jeep.md'), ['willys-overland']);
  assert.deepEqual(
    resolveFilenameBuckets('research', 'wiki/research/rfc-gap-84-cic-post-war-willys-overland.md'),
    ['post-war', 'willys-overland']
  );
  assert.deepEqual(
    resolveFilenameBuckets('research', 'wiki/research/rfc-gap-01-cic-cuban-seizures-retired-assets.md'),
    ['cuba-claims']
  );
  assert.deepEqual(
    resolveFilenameBuckets('research', 'wiki/research/rfc-gap-01-cic-miami-estate-florida-retirement.md'),
    ['miami-estate']
  );
  assert.deepEqual(
    resolveFilenameBuckets('research', 'wiki/research/rfc-gap-01-cic-rouge-model-t-moving-assembly-line.md'),
    ['assembly-line']
  );
});

test('resolveFilenameBuckets ignores directory names and unrelated files', () => {
  assert.deepEqual(resolveFilenameBuckets('research', 'wiki/post-war/other.md'), []);
  assert.deepEqual(resolveFilenameBuckets('research', 'wiki/willow-run/other.md'), []);
  assert.deepEqual(resolveFilenameBuckets('research', 'wiki/research/other.md'), []);
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
  fs.writeFileSync(path.join(wikiDir, 'cic-willow-run-gap.md'), '---\ncategory: research\n---\nWillow body.\n', 'utf8');
  fs.writeFileSync(path.join(wikiDir, 'cic-ford-executive-gap.md'), '---\ncategory: research\n---\nFord body.\n', 'utf8');
  const outDir = path.join(rootDir, '.nlm_pack');
  fs.mkdirSync(outDir, { recursive: true });

  consolidatePacks({ rootDir, outDir });

  const postWar = fs.readFileSync(path.join(outDir, 'pack_post_war.txt'), 'utf8');
  const willys = fs.readFileSync(path.join(outDir, 'pack_willys_overland.txt'), 'utf8');
  assert.match(postWar, /FILE COUNT: 1/);
  assert.match(postWar, /Post-war body/);
  assert.match(willys, /FILE COUNT: 1/);
  assert.match(willys, /Willys body/);
  const willow = fs.readFileSync(path.join(outDir, 'pack_willow_run.txt'), 'utf8');
  const ford = fs.readFileSync(path.join(outDir, 'pack_ford_politics.txt'), 'utf8');
  assert.match(willow, /FILE COUNT: 1/);
  assert.match(willow, /Willow body/);
  assert.match(ford, /FILE COUNT: 1/);
  assert.match(ford, /Ford body/);
});

test('buildPacks fills cuba-claims, miami-estate, and assembly-line packs into outDir', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-build-packs-'));
  const wikiDir = path.join(rootDir, 'wiki', 'research');
  fs.mkdirSync(wikiDir, { recursive: true });
  fs.writeFileSync(path.join(wikiDir, 'cic-cuban-seizures-gap.md'), '---\ncategory: research\n---\nCuba body.\n', 'utf8');
  fs.writeFileSync(path.join(wikiDir, 'cic-miami-estate-gap.md'), '---\ncategory: research\n---\nMiami body.\n', 'utf8');
  fs.writeFileSync(path.join(wikiDir, 'cic-moving-assembly-line-gap.md'), '---\ncategory: research\n---\nAssembly body.\n', 'utf8');
  const outDir = path.join(rootDir, '.nlm_pack');

  buildPacks({ rootDir, outDir });

  assert.match(fs.readFileSync(path.join(outDir, 'pack_cuba_claims.txt'), 'utf8'), /Cuba body/);
  assert.match(fs.readFileSync(path.join(outDir, 'pack_miami_estate.txt'), 'utf8'), /Miami body/);
  assert.match(fs.readFileSync(path.join(outDir, 'pack_assembly_line.txt'), 'utf8'), /Assembly body/);
});

test('consolidatePacks blocks kb-sync script and entity leaks from pack_daily and pack_master_kb', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-leak-guard-'));
  const researchDir = path.join(rootDir, 'wiki', 'research');
  const entitiesDir = path.join(rootDir, 'wiki', 'entities');
  fs.mkdirSync(researchDir, { recursive: true });
  fs.mkdirSync(entitiesDir, { recursive: true });

  fs.writeFileSync(
    path.join(researchDir, 'clean-cic-research.md'),
    '---\ncategory: research\n---\n1908 Piquette Moving Line Trials archival note.\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(researchDir, 'stamped-archive.md'),
    '---\ncategory: research\nsourceRepository: kb-sync\n---\nFord executive archival note with only a repository stamp.\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(researchDir, 'stamped-willow.md'),
    '---\ncategory: willow-run\nsourceRepository: kb-sync\n---\nWillow Run bomber plant stamp only.\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(researchDir, 'leaked-kbsync-rfc.md'),
    '---\ncategory: research\nsourceRepository: kb-sync\n---\nast_grounded_symbols: ["scripts/notebooklm/ingest-notebooklm.sh"]\nscripts/run-closed-loop-research-v2.mjs\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(entitiesDir, 'targets.mjs.md'),
    '---\ncategory: research\n---\nEntity doc for targets.mjs\n',
    'utf8'
  );

  const outDir = path.join(rootDir, '.nlm_pack');
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => {
    lines.push(args.join(' '));
  };
  try {
    consolidatePacks({ rootDir, outDir });
  } finally {
    console.log = originalLog;
  }

  const dailyPack = fs.readFileSync(path.join(outDir, 'pack_daily.txt'), 'utf8');
  const masterPack = fs.readFileSync(path.join(outDir, 'pack_master_kb.txt'), 'utf8');
  const willowPack = fs.readFileSync(path.join(outDir, 'pack_willow_run.txt'), 'utf8');

  assert.match(dailyPack, /1908 Piquette Moving Line Trials/);
  assert.match(dailyPack, /Ford executive archival note/);
  assert.doesNotMatch(dailyPack, /run-closed-loop-research-v2\.mjs/);
  assert.doesNotMatch(dailyPack, /ingest-notebooklm\.sh/);
  assert.doesNotMatch(dailyPack, /targets\.mjs\.md/);

  assert.match(masterPack, /1908 Piquette Moving Line Trials/);
  assert.match(masterPack, /Ford executive archival note/);
  assert.match(masterPack, /Willow Run bomber plant stamp only/);
  assert.doesNotMatch(masterPack, /run-closed-loop-research-v2\.mjs/);
  assert.doesNotMatch(masterPack, /targets\.mjs\.md/);

  assert.match(willowPack, /Willow Run bomber plant stamp only/);

  const guardLines = lines.filter((line) => line.includes('[PARTITION-GUARD]'));
  assert.equal(guardLines.length, 1);
  assert.match(guardLines[0], /Blocked 2 software script or entity note/);

  assert.equal(isSoftwareEntityLeak('wiki/entities/targets.mjs.md', 'body', {}), true);
  assert.equal(isSoftwareEntityLeak('wiki/research/ok.md', '1908 Piquette', { sourceRepository: 'kb-sync' }), false);
  assert.equal(isSoftwareEntityLeak('wiki/research/ok.md', 'scripts/notebooklm/ingest-notebooklm.sh', { sourceRepository: 'kb-sync' }), true);
  assert.equal(isSoftwareEntityLeak('wiki/research/ok.md', '1908 Piquette', {}), false);
});
