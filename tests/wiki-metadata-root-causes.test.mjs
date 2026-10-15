import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const parse = content => yaml.load(content.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1]);
const note = extra => `---\ntitle: "Topic: detail"\ncategory: wiki\nstatus: active\nsourceRepository: kb-sync\n${extra}\n---\nBody.   \n`;
for (const version of ['autoheal-sweeper.mjs', 'autoheal-sweeper-v2.mjs']) {
  const { autohealMetadata, sweepStagingVault } = await import(`../modules/wiki/${version}`);
  test(`${version}: real YAML roundtrip preserves colon title, arrays, version string, dates, and unknown fields`, async () => {
    for (const tags of ['tags:\n  - failure-pattern\n  - remediation', 'tags: [failure-pattern, remediation]']) {
      const source = note(`${tags}\nversion: "1.0"\ncreated: 2026-10-14\ncustom:\n  enabled: true\n  items: [one, two]\nsummary: |+\n  Text: detail\n\n`);
      const healed = await autohealMetadata('wiki/note.md', source, { index: new Map() });
      assert.deepEqual(parse(healed.content), parse(source));
      assert.ok(healed.repairs.includes('cleaned_hygiene'));
    }
  });
  test(`${version}: rejects malformed or unsupported metadata before rewrite`, async () => {
    for (const source of [note('tags: [unterminated'), note('').replace('category: wiki', 'category: concepts'), note('').replace('status: active', 'status: completed'), note('').replace('title: "Topic: detail"', 'title: [not, a, title]'), note('unknown: !!unsupported value'), '---\ncategory: wiki\nBody without closing delimiter', '---\n- an\n- array\n---\nBody', '---\nnull\n---\nBody']) {
      await assert.rejects(autohealMetadata('wiki/note.md', source, { index: new Map() }), /frontmatter|metadata|category|status|YAML/i);
    }
  });
  test(`${version}: CRLF content and known repairs survive`, async () => {
    const source = note('version: "1.0"').replace('category: wiki', 'category: Wiki').replace('status: active', 'status: wip').replace(/\n/g, '\r\n');
    const healed = await autohealMetadata('wiki/note.md', source, { index: new Map() });
    const fm = parse(healed.content);
    assert.equal(fm.category, 'wiki');
    assert.equal(fm.status, 'draft');
    assert.equal(fm.version, '1.0');
    assert.ok(!/(?<!\r)\n/.test(healed.content));
  });
  test(`${version}: missing header, empty header, and missing fields retain supported inference`, async () => {
    for (const source of ['# New note\nBody\n', '---\n\n---\n# New note\nBody\n', '---\ntitle: Known\n---\nBody\n']) {
      const healed = await autohealMetadata('wiki/note.md', source, { index: new Map() });
      const fm = parse(healed.content);
      assert.ok(fm.title);
      assert.equal(fm.category, 'wiki');
      assert.equal(fm.status, 'draft');
      assert.ok(healed.repairs.some(r => r === 'injected_frontmatter' || r === 'added_missing_fields'));
    }
  });
  test(`${version}: actual sweep fails visibly without overwriting invalid note`, async () => {
    const fixtures = path.join(root, '.tmp_test_staging');
    fs.mkdirSync(fixtures, { recursive: true });
    const scratch = fs.mkdtempSync(path.join(fixtures, 'wiki-metadata-'));
    const wiki = path.join(scratch, 'wiki');
    fs.mkdirSync(wiki);
    const file = path.join(wiki, 'note.md');
    const content = note('').replace('status: active', 'status: completed');
    fs.writeFileSync(file, content);
    try {
      await assert.rejects(sweepStagingVault({ vaultRoot: scratch, targetDir: wiki, fix: true, dryRun: false, allowDirty: true, compileVFS: false, index: new Map([['note', ['note.md']]]) }), { code: 'WIKI_METADATA_INVALID' });
      assert.equal(fs.readFileSync(file, 'utf8'), content);
      assert.equal(fs.existsSync(path.join(scratch, '.autoheal-receipt.json')), false);
    } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  });
}

test('actual synthesis proposal function consumes validator enums, retaining unsupported rejection', () => {
  const script = `import assert from 'node:assert/strict';
    import {validateProposalSchema} from './modules/obsidian/synthesize-wiki.ts';
    import {ALLOWED_CATEGORIES,ALLOWED_STATUSES} from './modules/wiki/validate-contract.mjs';
    for(const category of ALLOWED_CATEGORIES)for(const status of ALLOWED_STATUSES){
      const p={title:'Research',category,status,vaultPath:'research/note.md',citations:[]};
      assert.deepEqual(validateProposalSchema(p,new Set()),[],category+'/'+status);
    }
    for(const [category,status] of [['concepts','active'],['wiki','completed']])assert.ok(validateProposalSchema({title:'X',category,status,vaultPath:'concepts/note.md',citations:[]},new Set()).length);
  `;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { cwd: root, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
