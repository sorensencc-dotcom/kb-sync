import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isPackFamilyTitle,
  filterPackFamilySources,
  purgePackFamilyBeforeUpload,
  createSourceDeletionLease,
  deleteNotebookSource,
} from '../scripts/nlm-pack-replace-gate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import os from 'node:os';
import fs from 'node:fs';

const mockCli = path.join(os.tmpdir(), `kb-sync-mock-nlm-cli-${process.pid}`);
fs.writeFileSync(
  mockCli,
  `#!/usr/bin/env node\n${fs.readFileSync(path.join(__dirname, 'mock-nlm-cli.mjs'), 'utf8')}`,
  'utf8',
);
fs.chmodSync(mockCli, 0o755);

test('Agent Harness: purgePackFamilyBeforeUpload purges both pack_agent_harness and repo_knowledge_pack', () => {
  const mockSources = [
    { id: 'src-harness', title: 'pack_agent_harness.txt' },
    { id: 'src-part-aa', title: 'repo_knowledge_pack_part_aa.txt' },
    { id: 'src-other-doc', title: 'Ecosystem Architecture Guide (Current).md' },
  ];
  process.env.MOCK_NLM_MODE = 'custom';
  process.env.MOCK_NLM_DATA = JSON.stringify(mockSources);
  const result = purgePackFamilyBeforeUpload({
    cli: mockCli,
    notebookId: '359b346c-6af7-4ba3-baef-b985c9e6e1af',
    packFile: 'pack_agent_harness.txt',
    dryRun: true,
  });
  assert.equal(result.listed, 3);
  assert.deepEqual(result.matched.map(s => s.id), ['src-harness', 'src-part-aa']);
});

test('non-pack documents are preserved and never identified as pack families', () => {
  assert.equal(isPackFamilyTitle('Interview transcript - User research.docx', 'pack_agent_harness.txt'), false);
  assert.equal(isPackFamilyTitle('Architecture RFC 2026.md', 'pack_agent_harness.txt'), false);
  assert.equal(isPackFamilyTitle('API Reference - v2.pdf', 'repo_knowledge_pack.txt'), false);
  assert.equal(isPackFamilyTitle('Sprint Review Meeting Notes', 'pack_agent_harness.txt'), false);
});

test('all 19 parts match the unified agent harness pack family', () => {
  for (const suffix of ['aa', 'ab', 'ac', 'ad', 'ae', 'af', 'ag', 'ah', 'ai', 'aj', 'ak', 'al', 'am', 'an', 'ao', 'ap', 'aq', 'ar', 'as']) {
    const filename = `repo_knowledge_pack_part_${suffix}.txt`;
    assert.equal(isPackFamilyTitle(filename, 'pack_agent_harness.txt'), true);
    assert.equal(isPackFamilyTitle('pack_agent_harness.txt', filename), true);
  }
});

test('reverse purge recognizes repo_knowledge_pack against an old agent harness pack', () => {
  process.env.MOCK_NLM_MODE = 'custom';
  process.env.MOCK_NLM_DATA = JSON.stringify([
    { id: 'src-harness', title: 'pack_agent_harness.txt' },
    { id: 'src-doc', title: 'Interview transcript.md' },
  ]);
  const result = purgePackFamilyBeforeUpload({
    cli: mockCli,
    notebookId: '359b346c-6af7-4ba3-baef-b985c9e6e1af',
    packFile: 'repo_knowledge_pack_part_aa.txt',
    dryRun: true,
  });
  assert.deepEqual(result.matched.map(s => s.id), ['src-harness']);
});

test('standalone agent harness purge refuses live deletion', () => {
  process.env.MOCK_NLM_MODE = 'custom';
  process.env.MOCK_NLM_DATA = JSON.stringify([{ id: 'src-harness', title: 'pack_agent_harness.txt' }]);
  assert.throws(() => purgePackFamilyBeforeUpload({
    cli: mockCli,
    notebookId: '359b346c-6af7-4ba3-baef-b985c9e6e1af',
    packFile: 'pack_agent_harness.txt',
    dryRun: false,
  }), /ATOMIC_REPLACEMENT_REQUIRED/);
});

test('source deletion requires a matching replacement lease', () => {
  process.env.MOCK_NLM_MODE = 'empty';
  assert.throws(() => deleteNotebookSource(mockCli, 'nb-mock', 'src-1'), /UNLEASED_SOURCE_DELETE/);
  const lease = createSourceDeletionLease({ notebookId: 'nb-mock', sourceIds: ['src-1'], reason: 'replacement' });
  assert.equal(deleteNotebookSource(mockCli, 'nb-mock', 'src-1', lease), true);
});
