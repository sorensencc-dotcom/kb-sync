import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { replacePackFamilyAtomic } from '../scripts/nlm-pack-replace-gate.mjs';
import {
  PACK_FAMILY_ALIASES,
  findStagedPackFiles,
  runNotebookSweep,
} from '../scripts/pipeline/cluster-sync-runner.mjs';

test('replacePackFamilyAtomic default upload uses source add not source upload via spawn spy', async () => {
  const spawnCalls = [];
  const spawnSpy = (cli, args, opts) => {
    spawnCalls.push({ cli, args, opts });
    return {
      status: 0,
      stdout: JSON.stringify({ source_id: 'src-added-123' }),
      stderr: '',
    };
  };

  let listCall = 0;
  const mockList = async () => {
    listCall++;
    if (listCall === 1) {
      return [];
    }
    return [{ id: 'src-added-123', title: 'pack_willow_run.txt', status: 2 }];
  };

  const result = await replacePackFamilyAtomic({
    cli: 'nlm',
    notebookId: '6fd7c40b-df90-444b-9c7a-a64682925856',
    packFiles: ['/tmp/pack_willow_run.txt'],
    expectedPartCount: 1,
    spawnFn: spawnSpy,
    runList: mockList,
    runDelete: async () => true,
    waitMs: 1,
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.newSourceIds, ['src-added-123']);
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].cli, 'nlm');
  assert.deepEqual(spawnCalls[0].args, [
    'source',
    'add',
    '6fd7c40b-df90-444b-9c7a-a64682925856',
    '--file',
    '/tmp/pack_willow_run.txt',
    '--json',
  ]);
  assert.equal(spawnCalls[0].args.includes('upload'), false);
});

test('replacePackFamilyAtomic default upload parses id and source.id and tolerates non-JSON prefix/output', async () => {
  const outputs = [
    JSON.stringify({ id: 'src-id-1' }),
    JSON.stringify({ source: { id: 'src-id-2' } }),
    'Uploading file...\n{"source_id": "src-id-3"}\nDone.',
  ];
  let idx = 0;
  const spawnSpy = () => ({
    status: 0,
    stdout: outputs[idx++],
    stderr: '',
  });

  let listCall = 0;
  const mockList = async () => {
    listCall++;
    if (listCall === 1) return [];
    return [
      { id: 'src-id-1', status: 2 },
      { id: 'src-id-2', status: 2 },
      { id: 'src-id-3', status: 2 },
    ];
  };

  const result = await replacePackFamilyAtomic({
    cli: 'nlm',
    notebookId: '359b346c-6af7-4ba3-baef-b985c9e6e1af',
    packFiles: [
      'repo_knowledge_pack_part_aa.txt',
      'repo_knowledge_pack_part_ab.txt',
      'repo_knowledge_pack_part_ac.txt',
    ],
    expectedPartCount: 3,
    spawnFn: spawnSpy,
    runList: mockList,
    runDelete: async () => true,
    waitMs: 1,
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.newSourceIds, ['src-id-1', 'src-id-2', 'src-id-3']);
});

test('findStagedPackFiles alias finds repo_knowledge_pack_part_aa..ar for pack_agent_harness in a temp dir and excludes .bak.txt', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-sync-staging-'));
  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  assert.deepEqual(PACK_FAMILY_ALIASES.pack_agent_harness, ['repo_knowledge_pack']);

  const parts = [
    'aa', 'ab', 'ac', 'ad', 'ae', 'af', 'ag', 'ah', 'ai',
    'aj', 'ak', 'al', 'am', 'an', 'ao', 'ap', 'aq', 'ar',
  ];
  for (const p of parts) {
    fs.writeFileSync(path.join(tmpDir, `repo_knowledge_pack_part_${p}.txt`), `part ${p}`);
  }
  // Backup files and unrelated files that must be excluded
  fs.writeFileSync(path.join(tmpDir, 'repo_knowledge_pack.bak.txt'), 'backup');
  fs.writeFileSync(path.join(tmpDir, 'repo_knowledge_pack_part_aa.bak.txt'), 'backup part');
  fs.writeFileSync(path.join(tmpDir, 'pack_agent_harness.bak.txt'), 'backup harness');
  fs.writeFileSync(path.join(tmpDir, 'unrelated_notes.txt'), 'unrelated');

  const matched = findStagedPackFiles(
    { key: 'agent_harness', pack_family: 'pack_agent_harness' },
    [tmpDir]
  );

  assert.equal(matched.length, 18);
  assert.deepEqual(
    matched.map((f) => path.basename(f)),
    parts.map((p) => `repo_knowledge_pack_part_${p}.txt`)
  );
  assert.equal(matched.some((f) => f.endsWith('.bak.txt')), false);
});

test('findStagedPackFiles still matches pack_willow_run and excludes .bak.txt', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-sync-willow-'));
  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  fs.writeFileSync(path.join(tmpDir, 'pack_willow_run.txt'), 'willow run content');
  fs.writeFileSync(path.join(tmpDir, 'pack_willow_run.bak.txt'), 'willow run backup');
  fs.writeFileSync(path.join(tmpDir, 'repo_knowledge_pack_part_aa.txt'), 'software part');

  const matched = findStagedPackFiles(
    { key: 'willow_run', pack_family: 'pack_willow_run' },
    [tmpDir]
  );

  assert.deepEqual(matched, [path.join(tmpDir, 'pack_willow_run.txt')]);
});

test('findStagedPackFiles matches numeric multipart parts and prefers parts over monolithic pack file', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-sync-master-kb-'));
  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  fs.writeFileSync(path.join(tmpDir, 'pack_master_kb_part1.txt'), 'part 1');
  fs.writeFileSync(path.join(tmpDir, 'pack_master_kb_part2.txt'), 'part 2');
  fs.writeFileSync(path.join(tmpDir, 'pack_master_kb_part3.txt'), 'part 3');
  fs.writeFileSync(path.join(tmpDir, 'pack_master_kb.txt'), 'monolithic file');
  fs.writeFileSync(path.join(tmpDir, 'pack_master_kb_part1.bak.txt'), 'backup part');

  const matched = findStagedPackFiles(
    { key: 'master-kb', pack_family: 'pack_master_kb', multipart: true },
    [tmpDir]
  );

  assert.equal(matched.length, 3);
  assert.deepEqual(
    matched.map((f) => path.basename(f)),
    ['pack_master_kb_part1.txt', 'pack_master_kb_part2.txt', 'pack_master_kb_part3.txt']
  );
  assert.equal(matched.some((f) => f.endsWith('.bak.txt')), false);
  assert.equal(matched.some((f) => path.basename(f) === 'pack_master_kb.txt'), false);
});

test('runNotebookSweep logs a clear WARN naming pack family and directories searched when nothing is staged (does not throw)', async (t) => {
  const emptyDir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-sync-empty1-'));
  const emptyDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-sync-empty2-'));
  t.after(() => {
    fs.rmSync(emptyDir1, { recursive: true, force: true });
    fs.rmSync(emptyDir2, { recursive: true, force: true });
  });

  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  t.after(() => {
    console.log = origLog;
  });

  const summary = await runNotebookSweep(
    {
      key: 'agent_harness',
      uuid: '359b346c-6af7-4ba3-baef-b985c9e6e1af',
      pack_family: 'pack_agent_harness',
      has_pack: true,
    },
    {
      isDryRun: true,
      candidateDirs: [emptyDir1, emptyDir2],
    }
  );

  assert.equal(summary.status, 'SUCCESS');
  const warnLines = logs.filter((l) => l.includes('[WARN]'));
  assert.equal(warnLines.length > 0, true, 'Expected at least one WARN log line');
  assert.equal(
    warnLines.some(
      (l) =>
        l.includes('pack_agent_harness') &&
        l.includes(emptyDir1) &&
        l.includes(emptyDir2)
    ),
    true,
    `Expected WARN log to include pack_agent_harness and candidateDirs, got: ${warnLines.join('\n')}`
  );
});
