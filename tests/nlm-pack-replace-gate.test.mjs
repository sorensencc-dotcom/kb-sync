import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isPackFamilyTitle,
  filterPackFamilySources,
  purgePackFamilyBeforeUpload,
  buildNotebookLmUploadCommand,
  isSoftwarePack,
  assertAllowedPackNotebook,
} from '../scripts/nlm-pack-replace-gate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const mockCli = `node "${path.join(__dirname, 'mock-nlm-cli.mjs')}"`;

test('isPackFamilyTitle matches pack family titles', () => {
  assert.equal(isPackFamilyTitle('pack_willow_run.txt'), true);
  assert.equal(isPackFamilyTitle('repo_knowledge_pack_master'), true);
  assert.equal(isPackFamilyTitle('Seed Engineering Pack'), true);
  assert.equal(isPackFamilyTitle('Willow Run & Aviation Engineering Pack'), true);
  assert.equal(isPackFamilyTitle('CIC - Ford Executive Dynamics & Politics Pack'), true);
  assert.equal(isPackFamilyTitle('CIC - Ford Executive Dynamics & Politics Pack', 'pack_ford_politics.txt'), true);
  assert.equal(isPackFamilyTitle('Master Knowledge Pack'), true);
  assert.equal(isPackFamilyTitle('PACK_MASTER_KB', 'pack_master_kb.txt'), true);
  assert.equal(isPackFamilyTitle('pack_willys_overland.txt'), true);
  assert.equal(isPackFamilyTitle('Thematic Knowledge Pack: Post-War'), true);
  assert.equal(isPackFamilyTitle('CIC Politics Pack'), true);
});

test('isPackFamilyTitle rejects non-pack sources', () => {
  assert.equal(isPackFamilyTitle('random meeting notes'), false);
  assert.equal(isPackFamilyTitle('Daily Digest'), false);
  assert.equal(isPackFamilyTitle('Interview transcript'), false);
  assert.equal(isPackFamilyTitle('Quarterly financial report'), false);
  assert.equal(isPackFamilyTitle(''), false);
  assert.equal(isPackFamilyTitle(null), false);
});

test('filterPackFamilySources keeps only pack family sources', () => {
  const sources = [
    { id: '1', title: 'pack_ford_politics.txt' },
    { id: '2', title: 'Interview transcript' },
    { id: '3', name: 'repo_knowledge_pack_v2' },
    { id: '4', title: 'Daily Digest' },
  ];
  const matched = filterPackFamilySources(sources, 'pack_ford_politics.txt');
  assert.equal(matched.length, 2);
  assert.deepEqual(matched.map((s) => s.id), ['1', '3']);
});

test('buildNotebookLmUploadCommand builds standard upload command', () => {
  const cmd = buildNotebookLmUploadCommand({
    cli: 'notebooklm',
    notebookId: 'nb-12345',
    file: '/tmp/pack_willow_run.txt',
  });
  assert.equal(cmd, 'notebooklm source upload --notebook "nb-12345" --file="/tmp/pack_willow_run.txt"');
});

test('purgePackFamilyBeforeUpload dry-run handles empty sources list', () => {
  let loggedInfo = [];
  let loggedWarn = [];
  process.env.MOCK_NLM_MODE = 'empty';
  const result = purgePackFamilyBeforeUpload({
    cli: mockCli,
    notebookId: 'nb-mock',
    packFile: 'pack_master_kb.txt',
    dryRun: true,
    logInfo: (msg) => loggedInfo.push(msg),
    logWarn: (msg) => loggedWarn.push(msg),
  });

  assert.equal(result.listed, 0);
  assert.equal(result.purged, 0);
  assert.equal(result.matched.length, 0);
  assert.equal(result.safeToUpload, true);
});

test('purgePackFamilyBeforeUpload dry-run identifies matching pack sources without purging', () => {
  let loggedInfo = [];
  let loggedWarn = [];
  const mockSources = [
    { id: 'src-1', title: 'pack_willow_run.txt' },
    { id: 'src-2', title: 'Daily Notes' },
  ];
  process.env.MOCK_NLM_MODE = 'custom';
  process.env.MOCK_NLM_DATA = JSON.stringify(mockSources);
  const result = purgePackFamilyBeforeUpload({
    cli: mockCli,
    notebookId: 'nb-mock',
    packFile: 'pack_willow_run.txt',
    dryRun: true,
    logInfo: (msg) => loggedInfo.push(msg),
    logWarn: (msg) => loggedWarn.push(msg),
  });

  assert.equal(result.listed, 2);
  assert.equal(result.purged, 0);
  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0].id, 'src-1');
  assert.equal(result.safeToUpload, true);
  assert.equal(loggedWarn.some((w) => w.includes('[DRY RUN] Would purge pack-family source src-1')), true);
});

test('purgePackFamilyBeforeUpload live mode purges matching sources', () => {
  let loggedInfo = [];
  let loggedWarn = [];
  const mockSources = [
    { id: 'src-del-1', title: 'pack_ford_politics.txt' },
    { id: 'src-keep-1', title: 'Interview transcript' },
  ];
  process.env.MOCK_NLM_MODE = 'custom';
  process.env.MOCK_NLM_DATA = JSON.stringify(mockSources);
  const result = purgePackFamilyBeforeUpload({
    cli: mockCli,
    notebookId: 'nb-live-test',
    packFile: 'pack_ford_politics.txt',
    dryRun: false,
    logInfo: (msg) => loggedInfo.push(msg),
    logWarn: (msg) => loggedWarn.push(msg),
  });

  assert.equal(result.listed, 2);
  assert.equal(result.purged, 1);
  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0].id, 'src-del-1');
  assert.equal(result.safeToUpload, true);
  assert.equal(loggedInfo.some((i) => i.includes('purged src-del-1')), true);
});

test('purgePackFamilyBeforeUpload fails closed when source list fails', () => {
  let loggedInfo = [];
  let loggedWarn = [];
  process.env.MOCK_NLM_MODE = 'fail';
  assert.throws(
    () => {
      purgePackFamilyBeforeUpload({
        cli: mockCli,
        notebookId: 'nb-fail-test',
        packFile: 'pack_master_kb.txt',
        dryRun: false,
        logInfo: (msg) => loggedInfo.push(msg),
        logWarn: (msg) => loggedWarn.push(msg),
      });
    },
    /Failed to list NotebookLM sources/,
  );
});

test('buildNotebookLmUploadCommand and helpers reject shell metacharacters', () => {
  assert.throws(() => buildNotebookLmUploadCommand({ cli: 'nlm; rm -rf /', notebookId: 'nb-1', file: 'pack.txt' }), /Unsafe NotebookLM CLI/);
  assert.throws(() => buildNotebookLmUploadCommand({ cli: 'nlm', notebookId: 'nb-1 & dir', file: 'pack.txt' }), /Unsafe NotebookLM notebook id/);
  assert.throws(() => buildNotebookLmUploadCommand({ cli: 'nlm', notebookId: 'nb-1', file: 'pack.txt | calc' }), /Unsafe NotebookLM file path/);
});

test('isSoftwarePack identifies repo packs and software categories', () => {
  assert.equal(isSoftwarePack('repo_knowledge_pack.txt'), true);
  assert.equal(isSoftwarePack('repo_knowledge_pack_part_aa.txt'), true);
  assert.equal(isSoftwarePack('repo_knowledge_pack_part_as.txt'), true);
  assert.equal(isSoftwarePack('pack_agent_harness.txt'), true);
  assert.equal(isSoftwarePack('pack_ironledger.txt'), true);
  assert.equal(isSoftwarePack('pack_sigil.txt'), true);
  assert.equal(isSoftwarePack('agent_harness'), true);

  assert.equal(isSoftwarePack('pack_master_kb.txt'), false);
  assert.equal(isSoftwarePack('pack_master_kb_part1.txt'), false);
  assert.equal(isSoftwarePack('pack_willow_run.txt'), false);
  assert.equal(isSoftwarePack('pack_ford_politics.txt'), false);
  assert.equal(isSoftwarePack('pack_cuba_claims.txt'), false);
});

test('assertAllowedPackNotebook blocks software pack uploads to historical notebooks', () => {
  const cicKbId = '679b8bab-2d87-42cb-a726-6dc54c83acc2';
  const willowRunId = '6fd7c40b-df90-444b-9c7a-a64682925856';

  assert.throws(
    () => assertAllowedPackNotebook(cicKbId, 'repo_knowledge_pack.txt'),
    /ROUTING_GUARD_VIOLATION.*Refusing to upload software pack/
  );
  assert.throws(
    () => assertAllowedPackNotebook(cicKbId, 'repo_knowledge_pack_part_aa.txt'),
    /ROUTING_GUARD_VIOLATION.*Refusing to upload software pack/
  );
  assert.throws(
    () => assertAllowedPackNotebook(willowRunId, 'repo_knowledge_pack.txt'),
    /ROUTING_GUARD_VIOLATION.*Refusing to upload software pack/
  );
});

test('assertAllowedPackNotebook allows software packs to Core Software notebooks and historical packs to historical notebooks', () => {
  const agentHarnessId = '359b346c-6af7-4ba3-baef-b985c9e6e1af';
  const ironLedgerId = '76e1932c-054a-4520-9e83-5e882dffc938';
  const cicKbId = '679b8bab-2d87-42cb-a726-6dc54c83acc2';
  const willowRunId = '6fd7c40b-df90-444b-9c7a-a64682925856';

  // Allowed: Software packs into Core Software notebooks
  assert.doesNotThrow(() => assertAllowedPackNotebook(agentHarnessId, 'repo_knowledge_pack.txt'));
  assert.doesNotThrow(() => assertAllowedPackNotebook(agentHarnessId, 'repo_knowledge_pack_part_aa.txt'));
  assert.doesNotThrow(() => assertAllowedPackNotebook(ironLedgerId, 'pack_ironledger.txt'));

  // Allowed: Historical packs into historical notebooks
  assert.doesNotThrow(() => assertAllowedPackNotebook(cicKbId, 'pack_master_kb.txt'));
  assert.doesNotThrow(() => assertAllowedPackNotebook(cicKbId, 'pack_master_kb_part1.txt'));
  assert.doesNotThrow(() => assertAllowedPackNotebook(willowRunId, 'pack_willow_run.txt'));
});

test('categories.json routes software pack aliases to agent-harness', () => {
  const categoriesPath = path.join(REPO_ROOT, 'core', 'categories.json');
  const categoriesData = JSON.parse(fs.readFileSync(categoriesPath, 'utf8'));
  const agentHarness = categoriesData.categories['agent-harness'];

  assert.ok(agentHarness, 'agent-harness must exist in categories.json');
  assert.equal(agentHarness.target, '359b346c-6af7-4ba3-baef-b985c9e6e1af');
  assert.ok(agentHarness.aliases.includes('repo_knowledge_pack'), 'must include repo_knowledge_pack alias');
  assert.ok(agentHarness.aliases.includes('repo-knowledge-pack'), 'must include repo-knowledge-pack alias');
  assert.ok(agentHarness.aliases.includes('software'), 'must include software alias');
});

test('configs/notebooklm.yaml specifies default_notebook as Core Software (agent-harness)', () => {
  const yamlPath = path.join(REPO_ROOT, 'configs', 'notebooklm.yaml');
  const yamlContent = fs.readFileSync(yamlPath, 'utf8');
  const match = yamlContent.match(/^\s*default_notebook\s*:\s*["']?(.*?)["']?\s*$/m);

  assert.ok(match, 'default_notebook must be specified in configs/notebooklm.yaml');
  assert.equal(match[1], '359b346c-6af7-4ba3-baef-b985c9e6e1af', 'default_notebook must be agent-harness UUID');
});

test('Agent Harness: pack_agent_harness and repo_knowledge_pack are recognized as the same pack family', () => {
  // When uploading pack_agent_harness.txt, repo_knowledge_pack parts are recognized as same family
  assert.equal(isPackFamilyTitle('repo_knowledge_pack.txt', 'pack_agent_harness.txt'), true);
  assert.equal(isPackFamilyTitle('repo_knowledge_pack_part_aa.txt', 'pack_agent_harness.txt'), true);
  assert.equal(isPackFamilyTitle('repo_knowledge_pack_part_as.txt', 'pack_agent_harness.txt'), true);

  // When uploading repo_knowledge_pack.txt, pack_agent_harness.txt is recognized as same family
  assert.equal(isPackFamilyTitle('pack_agent_harness.txt', 'repo_knowledge_pack.txt'), true);
  assert.equal(isPackFamilyTitle('pack_agent_harness.txt', 'repo_knowledge_pack_part_aa.txt'), true);

  // Non-pack sources are still rejected
  assert.equal(isPackFamilyTitle('Ecosystem Architecture Guide (Current).md', 'pack_agent_harness.txt'), false);
  assert.equal(isPackFamilyTitle('Evaluating OpenResearch for Autoresearchers', 'repo_knowledge_pack.txt'), false);
});

test('Agent Harness: filterPackFamilySources matches both pack_agent_harness and repo_knowledge_pack parts', () => {
  const sources = [
    { id: 'src-harness', title: 'pack_agent_harness.txt' },
    { id: 'src-part-aa', title: 'repo_knowledge_pack_part_aa.txt' },
    { id: 'src-part-ab', title: 'repo_knowledge_pack_part_ab.txt' },
    { id: 'src-doc', title: 'Ecosystem Architecture Guide (Current).md' },
  ];

  // Uploading pack_agent_harness matches existing repo_knowledge_pack parts
  const matchedHarness = filterPackFamilySources(sources, 'pack_agent_harness.txt');
  assert.equal(matchedHarness.length, 3);
  assert.deepEqual(matchedHarness.map(s => s.id), ['src-harness', 'src-part-aa', 'src-part-ab']);

  // Uploading repo_knowledge_pack matches existing pack_agent_harness
  const matchedRepo = filterPackFamilySources(sources, 'repo_knowledge_pack.txt');
  assert.equal(matchedRepo.length, 3);
  assert.deepEqual(matchedRepo.map(s => s.id), ['src-harness', 'src-part-aa', 'src-part-ab']);
});

test('Agent Harness: purgePackFamilyBeforeUpload purges both pack_agent_harness and repo_knowledge_pack', () => {
  let loggedInfo = [];
  let loggedWarn = [];
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
    logInfo: (msg) => loggedInfo.push(msg),
    logWarn: (msg) => loggedWarn.push(msg),
  });

  assert.equal(result.listed, 3);
  assert.equal(result.matched.length, 2);
  assert.deepEqual(result.matched.map(s => s.id), ['src-harness', 'src-part-aa']);
});

test('Non-pack documents are preserved and never identified as pack families', () => {
  assert.equal(isPackFamilyTitle('Interview transcript - User research.docx', 'pack_agent_harness.txt'), false);
  assert.equal(isPackFamilyTitle('Architecture RFC 2026.md', 'pack_agent_harness.txt'), false);
  assert.equal(isPackFamilyTitle('API Reference - v2.pdf', 'repo_knowledge_pack.txt'), false);
  assert.equal(isPackFamilyTitle('Sprint Review Meeting Notes', 'pack_agent_harness.txt'), false);
});

test('All 19 parts (part_aa..as) match the unified agent harness pack family', () => {
  const parts = ['aa', 'ab', 'ac', 'ad', 'ae', 'af', 'ag', 'ah', 'ai', 'aj', 'ak', 'al', 'am', 'an', 'ao', 'ap', 'aq', 'ar', 'as'];
  for (const p of parts) {
    const filename = `repo_knowledge_pack_part_${p}.txt`;
    assert.equal(isPackFamilyTitle(filename, 'pack_agent_harness.txt'), true, `${filename} should match pack_agent_harness.txt`);
    assert.equal(isPackFamilyTitle('pack_agent_harness.txt', filename), true, `pack_agent_harness.txt should match ${filename}`);
  }
});

test('Agent Harness: reverse purge - uploading repo_knowledge_pack purges pre-existing pack_agent_harness', () => {
  let loggedInfo = [];
  let loggedWarn = [];
  const mockSources = [
    { id: 'src-harness', title: 'pack_agent_harness.txt' },
    { id: 'src-doc', title: 'Interview transcript.md' },
  ];
  process.env.MOCK_NLM_MODE = 'custom';
  process.env.MOCK_NLM_DATA = JSON.stringify(mockSources);

  const result = purgePackFamilyBeforeUpload({
    cli: mockCli,
    notebookId: '359b346c-6af7-4ba3-baef-b985c9e6e1af',
    packFile: 'repo_knowledge_pack_part_aa.txt',
    dryRun: true,
    logInfo: (msg) => loggedInfo.push(msg),
    logWarn: (msg) => loggedWarn.push(msg),
  });

  assert.equal(result.listed, 2);
  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0].id, 'src-harness');
});

test('Agent Harness: live purge executes notebooklm source delete for each matched family member', () => {
  let loggedInfo = [];
  let loggedWarn = [];
  const mockSources = [
    { id: 'src-harness-1', title: 'pack_agent_harness.txt' },
    { id: 'src-part-aa', title: 'repo_knowledge_pack_part_aa.txt' },
    { id: 'src-part-ab', title: 'repo_knowledge_pack_part_ab.txt' },
  ];
  process.env.MOCK_NLM_MODE = 'custom';
  process.env.MOCK_NLM_DATA = JSON.stringify(mockSources);

  const result = purgePackFamilyBeforeUpload({
    cli: mockCli,
    notebookId: '359b346c-6af7-4ba3-baef-b985c9e6e1af',
    packFile: 'pack_agent_harness.txt',
    dryRun: false,
    logInfo: (msg) => loggedInfo.push(msg),
    logWarn: (msg) => loggedWarn.push(msg),
  });

  assert.equal(result.listed, 3);
  assert.equal(result.matched.length, 3);
  assert.equal(result.purged, 3);
  assert.equal(result.safeToUpload, true);
});




