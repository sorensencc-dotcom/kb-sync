import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { consolidatePacks, THEMATIC_PACK_MAP } from '../scripts/consolidate-pack.mjs';

test('THEMATIC_PACK_MAP includes personal-os targeting 9724e682-c5ea-4693-8e21-caf8de68611e', () => {
  const entry = THEMATIC_PACK_MAP.find((p) => p.category === 'personal-os');
  assert.ok(entry, 'personal-os entry must exist in THEMATIC_PACK_MAP');
  assert.equal(entry.filename, 'pack_personal_os.txt');
  assert.equal(entry.notebookId, '9724e682-c5ea-4693-8e21-caf8de68611e');
});

test('consolidatePacks builds pack_personal_os.txt with utilities entity docs while isolating master-kb and daily', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-personal-os-'));
  try {
    const entitiesDir = path.join(tmpRoot, 'wiki', 'entities');
    fs.mkdirSync(entitiesDir, { recursive: true });
    fs.writeFileSync(
      path.join(entitiesDir, 'kb-sync--modules-compactor-index.mjs--b84db04f.md'),
      [
        '---',
        'title: index.mjs',
        'category: utilities',
        'status: active',
        'sourceRepository: kb-sync',
        'sourceFile: modules/compactor/index.mjs',
        'sha256: f5532b84e40dcee977c95b7a4beffa3424401785bef0b23374cbb21306a7d5c3',
        '---',
        '',
        '# index.mjs',
        'Metadata inventory for `modules/compactor/index.mjs` in **kb-sync** (224 lines).'
      ].join('\n'),
      'utf8'
    );

    const outDir = path.join(tmpRoot, '.nlm_pack');
    const results = consolidatePacks({ rootDir: tmpRoot, outDir });
    const personalOsPacks = results.filter((r) => r.packDef.category === 'personal-os');
    assert.ok(personalOsPacks.length >= 1, 'Expected at least 1 personal-os pack file');

    const personalOsContent = fs.readFileSync(personalOsPacks[0].packFile, 'utf8');
    assert.match(personalOsContent, /modules\/compactor\/index\.mjs/);
    assert.match(personalOsContent, /224 lines/);

    const masterKbContent = fs.readFileSync(path.join(outDir, 'pack_master_kb.txt'), 'utf8');
    const dailyContent = fs.readFileSync(path.join(outDir, 'pack_daily.txt'), 'utf8');
    assert.doesNotMatch(masterKbContent, /modules\/compactor\/index\.mjs/);
    assert.doesNotMatch(dailyContent, /modules\/compactor\/index\.mjs/);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
