import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { consolidatePacks, MAX_PACK_BYTES } from '../scripts/consolidate-pack.mjs';

function makeRoot({ docCount, docBytes }) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-consolidate-'));
  const wikiDir = path.join(rootDir, 'wiki', 'research');
  fs.mkdirSync(wikiDir, { recursive: true });
  for (let i = 0; i < docCount; i++) {
    const body = `Willow Run volume ${i}. `.repeat(Math.ceil(docBytes / 22));
    fs.writeFileSync(
      path.join(wikiDir, `volume-${String(i).padStart(2, '0')}.md`),
      `---\ncategory: willow-run\n---\n${body}\n`,
      'utf8'
    );
  }
  const outDir = path.join(rootDir, '.nlm_pack');
  fs.mkdirSync(outDir, { recursive: true });
  return { rootDir, outDir };
}

function familyFiles(outDir, base) {
  return fs.readdirSync(outDir).filter((f) => f === `${base}.txt` || f.startsWith(`${base}_part`)).sort();
}

test('consolidatePacks shards oversized packs into _partN files under the ceiling', () => {
  const { rootDir, outDir } = makeRoot({ docCount: 12, docBytes: 60 * 1024 });
  consolidatePacks({ rootDir, outDir });

  const files = familyFiles(outDir, 'pack_willow_run');
  assert.ok(files.length > 1, `expected multiple parts, got ${files.join(', ')}`);
  assert.ok(!files.includes('pack_willow_run.txt'), 'unsharded file must not sit beside parts');
  for (const f of files) {
    assert.match(f, /^pack_willow_run_part\d+\.txt$/);
    const bytes = fs.statSync(path.join(outDir, f)).size;
    assert.ok(bytes <= MAX_PACK_BYTES, `${f} is ${bytes} B, over ${MAX_PACK_BYTES}`);
  }
});

test('consolidatePacks removes stale parts left by an earlier, larger build', () => {
  const { rootDir, outDir } = makeRoot({ docCount: 12, docBytes: 60 * 1024 });
  fs.writeFileSync(path.join(outDir, 'pack_willow_run_part99.txt'), 'STALE', 'utf8');
  fs.writeFileSync(path.join(outDir, 'pack_willow_run.txt'), 'STALE', 'utf8');
  fs.writeFileSync(path.join(outDir, 'pack_willow_run_part1.bak.txt'), 'KEEP', 'utf8');

  consolidatePacks({ rootDir, outDir });

  const files = fs.readdirSync(outDir);
  assert.ok(!files.includes('pack_willow_run_part99.txt'), 'stale part99 survived');
  assert.ok(!files.includes('pack_willow_run.txt'), 'stale unsharded file survived');
  assert.ok(files.includes('pack_willow_run_part1.bak.txt'), 'backup files must be left alone');
});

test('consolidatePacks removes old parts when a pack shrinks to one file', () => {
  const { rootDir, outDir } = makeRoot({ docCount: 1, docBytes: 2 * 1024 });
  fs.writeFileSync(path.join(outDir, 'pack_willow_run_part1.txt'), 'STALE', 'utf8');
  fs.writeFileSync(path.join(outDir, 'pack_willow_run_part2.txt'), 'STALE', 'utf8');

  consolidatePacks({ rootDir, outDir });

  assert.deepEqual(familyFiles(outDir, 'pack_willow_run'), ['pack_willow_run.txt']);
});
