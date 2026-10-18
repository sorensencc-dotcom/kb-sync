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
  uploadAndReplacePack,
  matchesPackFamily,
  pollFamilyUntilActive,
  probeExistingPackSource,
  replacePackFamilyAtomic,
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
  assert.equal(isPackFamilyTitle('Daily standup notes', 'daily.txt'), false);
  assert.equal(isPackFamilyTitle('Daily standup notes', 'daily'), false);
  assert.equal(isPackFamilyTitle('Ford Foundation Grant.pdf', 'ford-politics'), false);
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

test('buildNotebookLmUploadCommand aligns to nlm source add dialect when cli is nlm', () => {
  const cmd = buildNotebookLmUploadCommand({
    cli: 'nlm',
    notebookId: 'nb-12345',
    file: '/tmp/pack_willow_run.txt',
  });
  assert.equal(cmd, 'nlm source add "nb-12345" --file "/tmp/pack_willow_run.txt"');
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

test('uploadAndReplacePack verifies returned ACTIVE ID before deleting old sources', async () => {
  process.env.MOCK_NLM_MODE = 'custom';
  process.env.MOCK_NLM_DATA = JSON.stringify([
    { id: 'old-1', title: 'pack_old.txt', status: 'ACTIVE' },
    { id: 'new-1', title: 'pack_new.txt', status: 'ACTIVE' },
  ]);
  const deleted = [];
  const result = await uploadAndReplacePack({
    cli: mockCli,
    notebookId: 'nb-live-test',
    packFile: 'pack_new.txt',
    oldSources: [{ id: 'old-1' }],
    waitMs: 1,
    runUpload: () => JSON.stringify({ source_id: 'new-1' }),
  });
  assert.equal(result.uploadedId, 'new-1');
  assert.deepEqual(result.oldSourceIds, ['old-1']);
  assert.equal(deleted.length, 0);
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

test('ingest-notebooklm.sh purge pattern matches multipart parts (part_aa..as), pack_agent_harness, and thematic packs', () => {
  const ingestScript = fs.readFileSync(path.join(REPO_ROOT, 'modules', 'notebooklm', 'ingest-notebooklm.sh'), 'utf8');
  const match = ingestScript.match(/const\s+pattern\s*=\s*(\/[^/]+\/[a-z]*);/);
  assert.ok(match, 'must find const pattern = /.../ in ingest-notebooklm.sh');
  const pattern = eval(match[1]);

  // Single repo pack
  assert.equal(pattern.test('repo_knowledge_pack.txt'), true);
  assert.equal(pattern.test('repo-knowledge-pack.txt'), true);

  // All 19 multipart chunks
  const parts = ['aa', 'ab', 'ac', 'ad', 'ae', 'af', 'ag', 'ah', 'ai', 'aj', 'ak', 'al', 'am', 'an', 'ao', 'ap', 'aq', 'ar', 'as'];
  for (const p of parts) {
    const filename = `repo_knowledge_pack_part_${p}.txt`;
    assert.equal(pattern.test(filename), true, `${filename} must match ingest pattern`);
  }

  // Core Software and thematic packs
  assert.equal(pattern.test('pack_agent_harness.txt'), true);
  assert.equal(pattern.test('pack_ironledger.txt'), true);
  assert.equal(pattern.test('pack_sigil.txt'), true);
  assert.equal(pattern.test('pack_daily.txt'), true);
  assert.equal(pattern.test('pack_ford_politics.txt'), true);

  // Must reject non-pack documents
  assert.equal(pattern.test('Interview transcript - User research.docx'), false);
  assert.equal(pattern.test('Architecture RFC 2026.md'), false);
  assert.equal(pattern.test('Evaluating OpenResearch for Autoresearchers.txt'), false);
});

test('Multi-generation deduplication invariance: second nightly run purges all 19 prior parts preventing 38-part stack', () => {
  const parts = ['aa', 'ab', 'ac', 'ad', 'ae', 'af', 'ag', 'ah', 'ai', 'aj', 'ak', 'al', 'am', 'an', 'ao', 'ap', 'aq', 'ar', 'as'];
  const preexistingSources = parts.map((p, idx) => ({
    id: `src-gen1-${p}`,
    title: `repo_knowledge_pack_part_${p}.txt`,
  }));

  // Non-pack docs that must be preserved
  preexistingSources.push({ id: 'doc-user-guide', title: 'User Guide.md' });
  preexistingSources.push({ id: 'doc-roadmap', title: 'Roadmap.pdf' });

  // Simulate query_preexisting_pack_sources using the ingest regex
  const ingestScript = fs.readFileSync(path.join(REPO_ROOT, 'modules', 'notebooklm', 'ingest-notebooklm.sh'), 'utf8');
  const match = ingestScript.match(/const\s+pattern\s*=\s*(\/[^/]+\/[a-z]*);/);
  const pattern = eval(match[1]);

  const matchedForPurge = preexistingSources.filter(s => pattern.test(s.title));
  assert.equal(matchedForPurge.length, 19, 'Must match exactly the 19 old parts for purge');
  assert.equal(matchedForPurge.some(s => s.id === 'doc-user-guide'), false, 'Must not touch User Guide');
  assert.equal(matchedForPurge.some(s => s.id === 'doc-roadmap'), false, 'Must not touch Roadmap');

  // Verify filterPackFamilySources from nlm-pack-replace-gate also matches all 19 parts
  const gateMatched = filterPackFamilySources(preexistingSources, 'repo_knowledge_pack_part_aa.txt');
  assert.equal(gateMatched.length, 19, 'replace-gate must match exactly the 19 old parts for purge');
});

test('assertAllowedPackNotebook blocks all 19 multipart parts from historical notebooks', () => {
  const historicalIds = [
    '6fd7c40b-df90-444b-9c7a-a64682925856', // willow-run
    '0caf6707-f8f2-4d2a-acd2-020acead55ba', // ford-politics
    '9c469910-a900-43a4-877c-a43c9f545b5f', // post-war
    '679b8bab-2d87-42cb-a726-6dc54c83acc2', // master-kb
  ];
  const parts = ['aa', 'ag', 'as'];
  for (const nbId of historicalIds) {
    for (const p of parts) {
      const filename = `repo_knowledge_pack_part_${p}.txt`;
      assert.throws(
        () => assertAllowedPackNotebook(nbId, filename),
        /ROUTING_GUARD_VIOLATION/,
        `Historical notebook ${nbId} must reject software part ${filename}`
      );
    }
  }
});

test('matchesPackFamily recognizes legacy aliases and standardized filenames', () => {
  assert.equal(matchesPackFamily('CIC - Ford Executive Dynamics & Politics Pack', 'pack_ford_politics'), true);
  assert.equal(matchesPackFamily('CIC - Ford Executive Dynamics & Politics Pack', 'pack_ford_politics.txt'), true);
  assert.equal(matchesPackFamily('pack_ford_politics.txt', 'pack_ford_politics'), true);
  assert.equal(matchesPackFamily('CIC - Daily Research (Buffer/Intake) Pack', 'pack_daily'), true);
  assert.equal(matchesPackFamily('CIC - Daily Research (Buffer/Intake) Pack', 'pack_daily.txt'), true);
  assert.equal(matchesPackFamily('pack_daily.txt', 'pack_daily'), true);
  assert.equal(matchesPackFamily('pack_willow_run.txt', 'pack_willow_run'), true);
  assert.equal(matchesPackFamily('Unrelated Document', 'pack_daily'), false);
});

test('probeExistingPackSource detects active and in-flight sources, skips missing', () => {
  const sources = [
    { id: 'src-1', title: 'pack_daily.txt', status: 2 },
    { id: 'src-2', title: 'pack_master_kb_part_aa.txt', status: 3 }, // error status 3
    { id: 'src-3', title: 'pack_failed.txt', status: 'FAILED' },
    { id: 'src-4', title: 'pack_willow_run.txt', status: 1 }, // in-flight
  ];

  const probeActive = probeExistingPackSource(sources, 'pack_daily.txt');
  assert.equal(probeActive.exists, true);
  assert.equal(probeActive.status, 'EXISTS_ACTIVE');
  assert.equal(probeActive.reusable, true);
  assert.equal(probeActive.stale, false);
  assert.equal(probeActive.sourceId, 'src-1');

  const probeStatus3 = probeExistingPackSource(sources, 'pack_master_kb_part_aa.txt');
  assert.equal(probeStatus3.exists, true);
  assert.equal(probeStatus3.status, 'EXISTS_ERROR');
  assert.equal(probeStatus3.reusable, false);
  assert.equal(probeStatus3.stale, true);
  assert.equal(probeStatus3.sourceId, 'src-2');

  const probeInFlight = probeExistingPackSource(sources, 'pack_willow_run.txt');
  assert.equal(probeInFlight.exists, true);
  assert.equal(probeInFlight.status, 'EXISTS_IN_FLIGHT');
  assert.equal(probeInFlight.reusable, false);
  assert.equal(probeInFlight.stale, true);
  assert.equal(probeInFlight.sourceId, 'src-4');

  const probeFailed = probeExistingPackSource(sources, 'pack_failed.txt');
  assert.equal(probeFailed.exists, true);
  assert.equal(probeFailed.status, 'EXISTS_ERROR');
  assert.equal(probeFailed.reusable, false);
  assert.equal(probeFailed.stale, true);
  assert.equal(probeFailed.sourceId, 'src-3');

  const probeMissing = probeExistingPackSource(sources, 'pack_nonexistent.txt');
  assert.equal(probeMissing.exists, false);
});

test('pollFamilyUntilActive waits on status 1 and 5, promotes on status 2, probes missing status, and throws on status 3', async () => {
  let calls = 0;
  const mockList = async () => {
    calls++;
    if (calls === 1) {
      // In-flight state: id-1 in status 1, id-2 in status 5
      return [
        { id: 'id-1', status: 1 },
        { id: 'id-2', status: 5 },
      ];
    }
    // Terminal state: both active (one with status 2, one with missing status field but valid size)
    return [
      { id: 'id-1', status: 2 },
      { id: 'id-2', status: null, characterCount: 5000 },
    ];
  };

  const res = await pollFamilyUntilActive('nb-test', ['id-1', 'id-2'], 50000, mockList);
  assert.equal(res, true);
  assert.equal(calls, 2);

  await assert.rejects(
    async () => pollFamilyUntilActive('nb-test', ['id-status3'], 5000, async () => [{ id: 'id-status3', status: 3 }]),
    /invalid\/error status: 3/
  );
});

test('pollFamilyUntilActive throws on explicit invalid/error status', async () => {
  const mockList = async () => [
    { id: 'id-err', status: 'FAILED' }
  ];

  await assert.rejects(
    async () => pollFamilyUntilActive('nb-test', ['id-err'], 5000, mockList),
    /invalid\/error status: FAILED/
  );
});

test('replacePackFamilyAtomic handles hasPack false bypass immediately', async () => {
  const res = await replacePackFamilyAtomic({
    notebookId: '140119ae-3496-45c9-bf0c-71c955136afc', // rewrite-labs
    hasPack: false,
  });
  assert.equal(res.bypassed, true);
  assert.equal(res.reason, 'HAS_PACK_FALSE');
});

test('replacePackFamilyAtomic enforces multipart count and stages all before dropping any', async () => {
  const deleted = [];
  const uploaded = [];
  let quarantinedMsg = null;

  const mockList = async () => [
    { id: 'old-1', title: 'pack_master_kb.txt', status: 2 }
  ];
  const mockUpload = async (nbId, file) => {
    const id = `new-${uploaded.length + 1}`;
    uploaded.push({ id, file });
    return JSON.stringify({ source_id: id });
  };
  const mockDelete = async (id) => {
    deleted.push(id);
    return true;
  };

  // 1. Mismatch triggers quarantine without deletion
  await assert.rejects(
    async () => replacePackFamilyAtomic({
      notebookId: '679b8bab-2d87-42cb-a726-6dc54c83acc2', // master-kb
      packFiles: ['pack_master_kb.txt'],
      expectedPartCount: 2, // expected 2, given 1
      quarantineHandler: (nbId, err) => { quarantinedMsg = err; },
      runList: mockList,
      runUpload: mockUpload,
      runDelete: mockDelete,
    }),
    /MULTIPART_COUNT_MISMATCH/
  );
  assert.equal(quarantinedMsg.includes('MULTIPART_COUNT_MISMATCH'), true);
  assert.equal(deleted.length, 0); // old pack not touched

  // 2. Successful atomic replacement with stage-all-before-drop-any
  let pollCycle = 0;
  const mockListWithNew = async () => {
    pollCycle++;
    if (pollCycle === 1) {
      // Before upload: only old pack exists
      return [
        { id: 'old-1', title: 'pack_master_kb_old.txt', status: 2 },
      ];
    }
    // After upload: both old and new exist
    return [
      { id: 'old-1', title: 'pack_master_kb_old.txt', status: 2 },
      { id: 'new-1', title: 'pack_master_kb.txt', status: 2 },
    ];
  };

  const successRes = await replacePackFamilyAtomic({
    notebookId: '679b8bab-2d87-42cb-a726-6dc54c83acc2',
    packFiles: ['pack_master_kb.txt'],
    expectedPartCount: 1,
    runList: mockListWithNew,
    runUpload: mockUpload,
    runDelete: mockDelete,
    waitMs: 10,
  });

  assert.equal(successRes.success, true);
  assert.deepEqual(successRes.newSourceIds, ['new-1']);
  assert.deepEqual(successRes.purgedOldSourceIds, ['old-1']);
  assert.equal(deleted.includes('old-1'), true);
});

test('replacePackFamilyAtomic preserves old generation on upload error and purges only orphaned partials', async () => {
  const deleted = [];
  const uploaded = [];
  let quarantinedMsg = null;

  const mockList = async () => [
    { id: 'old-1', title: 'pack_master_kb.txt', status: 2 }
  ];
  const mockUpload = async (nbId, file) => {
    if (file.includes('part_2')) {
      throw new Error('TRANSPORT_DROP');
    }
    const id = 'orphan-part-1';
    uploaded.push(id);
    return JSON.stringify({ source_id: id });
  };
  const mockDelete = async (id) => {
    deleted.push(id);
    return true;
  };

  await assert.rejects(
    async () => replacePackFamilyAtomic({
      notebookId: '679b8bab-2d87-42cb-a726-6dc54c83acc2',
      packFiles: ['pack_master_kb_part_1.txt', 'pack_master_kb_part_2.txt'],
      expectedPartCount: 2,
      quarantineHandler: (nbId, err) => { quarantinedMsg = err; },
      runList: mockList,
      runUpload: mockUpload,
      runDelete: mockDelete,
    }),
    /TRANSPORT_DROP/
  );

  assert.equal(quarantinedMsg.includes('TRANSPORT_DROP'), true);
  // Old generation 'old-1' is NOT deleted!
  assert.equal(deleted.includes('old-1'), false);
  // Orphaned upload 'orphan-part-1' is purged!
  assert.equal(deleted.includes('orphan-part-1'), true);
});

test('replacePackFamilyAtomic rejects and preserves sources when multipart parts are missing', async () => {
  const deleted = [];
  let quarantinedMsg = null;

  const mockList = async () => [
    { id: 'old-1', title: 'pack_master_kb.txt', status: 2 }
  ];

  await assert.rejects(
    async () => replacePackFamilyAtomic({
      notebookId: '679b8bab-2d87-42cb-a726-6dc54c83acc2',
      packFiles: ['pack_master_kb_part_1.txt'], // only 1 part provided
      expectedPartCount: 2, // but 2 expected
      quarantineHandler: (nbId, err) => { quarantinedMsg = err; },
      runList: mockList,
      runDelete: async (id) => { deleted.push(id); },
    }),
    /MULTIPART_COUNT_MISMATCH/
  );

  assert.equal(quarantinedMsg.includes('MULTIPART_COUNT_MISMATCH'), true);
  assert.equal(deleted.length, 0); // zero deletions
});

test('pollFamilyUntilActive throws on status 3, "3", ERROR, FAILED but waits on 1, 5, PROCESSING', async () => {
  for (const errStatus of [3, '3', 'ERROR', 'FAILED']) {
    await assert.rejects(
      async () => pollFamilyUntilActive('nb-test', ['src-err'], 5000, async () => [
        { id: 'src-err', status: errStatus },
      ]),
      new RegExp(`invalid/error status: ${errStatus}`)
    );
  }

  let calls = 0;
  const mockWaitList = async () => {
    calls++;
    if (calls === 1) {
      return [
        { id: 'src-1', status: 1 },
        { id: 'src-5', status: 5 },
        { id: 'src-proc', status: 'PROCESSING' },
      ];
    }
    return [
      { id: 'src-1', status: 2 },
      { id: 'src-5', status: '2' },
      { id: 'src-proc', status: 'ACTIVE' },
    ];
  };

  const ok = await pollFamilyUntilActive('nb-test', ['src-1', 'src-5', 'src-proc'], 50000, mockWaitList);
  assert.equal(ok, true);
  assert.equal(calls, 2);
});

test('probeExistingPackSource classifies same-title status-3 as EXISTS_ERROR, in-flight as EXISTS_IN_FLIGHT, and ACTIVE as EXISTS_ACTIVE', () => {
  const liveSources = [
    { id: 'err-3', title: 'pack_daily.txt', status: 3 },
    { id: 'inflight-1', title: 'pack_ford_politics.txt', status: 1 },
    { id: 'inflight-5', title: 'pack_willow_run.txt', status: 5 },
    { id: 'inflight-proc', title: 'pack_post_war.txt', status: 'PROCESSING' },
    { id: 'active-src', title: 'pack_master_kb.txt', status: 'ACTIVE' },
  ];

  const pErr = probeExistingPackSource(liveSources, 'pack_daily.txt');
  assert.equal(pErr.exists, true);
  assert.equal(pErr.status, 'EXISTS_ERROR');
  assert.equal(pErr.stale, true);
  assert.equal(pErr.reusable, false);
  assert.equal(pErr.sourceId, 'err-3');

  for (const [file, id] of [
    ['pack_ford_politics.txt', 'inflight-1'],
    ['pack_willow_run.txt', 'inflight-5'],
    ['pack_post_war.txt', 'inflight-proc'],
  ]) {
    const pInFlight = probeExistingPackSource(liveSources, file);
    assert.equal(pInFlight.exists, true);
    assert.equal(pInFlight.status, 'EXISTS_IN_FLIGHT');
    assert.equal(pInFlight.stale, true);
    assert.equal(pInFlight.reusable, false);
    assert.equal(pInFlight.sourceId, id);
  }

  const pActive = probeExistingPackSource(liveSources, 'pack_master_kb.txt');
  assert.equal(pActive.exists, true);
  assert.equal(pActive.status, 'EXISTS_ACTIVE');
  assert.equal(pActive.stale, false);
  assert.equal(pActive.reusable, true);
  assert.equal(pActive.sourceId, 'active-src');
});

test('replacePackFamilyAtomic does not reuse same-title status-3 or in-flight sources, purges stale id only after new reaches ACTIVE, and preserves old if new ends in status 3', async () => {
  // 1. Same-title status-3 source: not reused, uploaded fresh, purged only after new reaches ACTIVE
  {
    const events = [];
    const deleted = [];
    const uploaded = [];
    const warnings = [];
    let listCall = 0;

    const runList = async () => {
      listCall++;
      if (listCall === 1) {
        return [{ id: 'stale-status3', title: 'pack_master_kb.txt', status: 3 }];
      }
      events.push('polled-active');
      return [
        { id: 'stale-status3', title: 'pack_master_kb.txt', status: 3 },
        { id: 'fresh-active-1', title: 'pack_master_kb.txt', status: 2 },
      ];
    };
    const runUpload = async (nbId, file) => {
      assert.equal(deleted.length, 0, 'must not delete stale status-3 source before upload completes');
      events.push('uploaded');
      uploaded.push(file);
      return { source_id: 'fresh-active-1' };
    };
    const runDelete = async (id) => {
      events.push(`deleted:${id}`);
      deleted.push(id);
      return true;
    };

    const res = await replacePackFamilyAtomic({
      notebookId: '679b8bab-2d87-42cb-a726-6dc54c83acc2',
      packFiles: ['pack_master_kb.txt'],
      expectedPartCount: 1,
      runList,
      runUpload,
      runDelete,
      logInfo: () => {},
      logWarn: (msg) => warnings.push(msg),
      waitMs: 1,
    });

    assert.equal(res.success, true);
    assert.equal(uploaded.length, 1);
    assert.deepEqual(res.newSourceIds, ['fresh-active-1']);
    assert.deepEqual(res.staleSourceIds, ['stale-status3']);
    assert.deepEqual(res.purgedOldSourceIds, ['stale-status3']);
    assert.deepEqual(events, ['uploaded', 'polled-active', 'deleted:stale-status3']);
    assert.equal(warnings.some((w) => w.includes('EXISTS_ERROR')), true);
  }

  // 2. Same-title status-3 source when new upload also ends in status 3: nothing old is deleted
  {
    const deleted = [];
    let listCall = 0;

    const runList = async () => {
      listCall++;
      if (listCall === 1) {
        return [{ id: 'stale-status3', title: 'pack_master_kb.txt', status: 3 }];
      }
      return [
        { id: 'stale-status3', title: 'pack_master_kb.txt', status: 3 },
        { id: 'new-failed-3', title: 'pack_master_kb.txt', status: 3 },
      ];
    };

    await assert.rejects(
      async () => replacePackFamilyAtomic({
        notebookId: '679b8bab-2d87-42cb-a726-6dc54c83acc2',
        packFiles: ['pack_master_kb.txt'],
        expectedPartCount: 1,
        runList,
        runUpload: async () => ({ source_id: 'new-failed-3' }),
        runDelete: async (id) => { deleted.push(id); return true; },
        logInfo: () => {},
        logWarn: () => {},
        waitMs: 1,
      }),
      /invalid\/error status: 3/
    );

    assert.equal(deleted.includes('stale-status3'), false, 'pre-existing source must not be deleted when new source ends in status 3');
    assert.deepEqual(deleted, ['new-failed-3']);
  }

  // 3. Same-title in-flight source: not reused, uploaded fresh, purged only after new reaches ACTIVE
  {
    const events = [];
    const deleted = [];
    const uploaded = [];
    const warnings = [];
    let listCall = 0;

    const runList = async () => {
      listCall++;
      if (listCall === 1) {
        return [{ id: 'stale-inflight', title: 'pack_master_kb.txt', status: 1 }];
      }
      events.push('polled-active');
      return [
        { id: 'stale-inflight', title: 'pack_master_kb.txt', status: 1 },
        { id: 'fresh-active-2', title: 'pack_master_kb.txt', status: 2 },
      ];
    };
    const runUpload = async (nbId, file) => {
      assert.equal(deleted.length, 0, 'must not delete stale in-flight source before upload completes');
      events.push('uploaded');
      uploaded.push(file);
      return { source_id: 'fresh-active-2' };
    };
    const runDelete = async (id) => {
      events.push(`deleted:${id}`);
      deleted.push(id);
      return true;
    };

    const res = await replacePackFamilyAtomic({
      notebookId: '679b8bab-2d87-42cb-a726-6dc54c83acc2',
      packFiles: ['pack_master_kb.txt'],
      expectedPartCount: 1,
      runList,
      runUpload,
      runDelete,
      logInfo: () => {},
      logWarn: (msg) => warnings.push(msg),
      waitMs: 1,
    });

    assert.equal(res.success, true);
    assert.equal(uploaded.length, 1);
    assert.deepEqual(res.newSourceIds, ['fresh-active-2']);
    assert.deepEqual(res.staleSourceIds, ['stale-inflight']);
    assert.deepEqual(res.purgedOldSourceIds, ['stale-inflight']);
    assert.deepEqual(events, ['uploaded', 'polled-active', 'deleted:stale-inflight']);
    assert.equal(warnings.some((w) => w.includes('EXISTS_IN_FLIGHT')), true);
  }

  // 4. Same-title in-flight source when new upload ends in status 3: nothing old is deleted
  {
    const deleted = [];
    let listCall = 0;

    const runList = async () => {
      listCall++;
      if (listCall === 1) {
        return [{ id: 'stale-inflight', title: 'pack_master_kb.txt', status: 5 }];
      }
      return [
        { id: 'stale-inflight', title: 'pack_master_kb.txt', status: 5 },
        { id: 'new-failed-3b', title: 'pack_master_kb.txt', status: 3 },
      ];
    };

    await assert.rejects(
      async () => replacePackFamilyAtomic({
        notebookId: '679b8bab-2d87-42cb-a726-6dc54c83acc2',
        packFiles: ['pack_master_kb.txt'],
        expectedPartCount: 1,
        runList,
        runUpload: async () => ({ source_id: 'new-failed-3b' }),
        runDelete: async (id) => { deleted.push(id); return true; },
        logInfo: () => {},
        logWarn: () => {},
        waitMs: 1,
      }),
      /invalid\/error status: 3/
    );

    assert.equal(deleted.includes('stale-inflight'), false, 'pre-existing in-flight source must not be deleted when new source ends in status 3');
    assert.deepEqual(deleted, ['new-failed-3b']);
  }
});

test('matchesPackFamily requires exact full-title match for Daily and Ford aliases while rejecting lookalike notes', () => {
  assert.equal(matchesPackFamily('CIC - Daily Research (Buffer/Intake) Pack', 'pack_daily'), true);
  assert.equal(matchesPackFamily('pack_daily', 'pack_daily'), true);
  assert.equal(matchesPackFamily('pack_daily.txt', 'pack_daily'), true);
  assert.equal(matchesPackFamily('Daily Research Notes', 'pack_daily'), false);
  assert.equal(matchesPackFamily('Daily Research Intake Log', 'pack_daily'), false);

  assert.equal(matchesPackFamily('CIC - Ford Executive Dynamics & Politics Pack', 'pack_ford_politics'), true);
  assert.equal(matchesPackFamily('pack_ford_politics.txt', 'pack_ford_politics'), true);
  assert.equal(matchesPackFamily('Ford Executive Dynamics Notes', 'pack_ford_politics'), false);
});

test('Agent Harness family: repo_knowledge_pack_part_aa.txt, .bak.txt, and pack_agent_harness_part_ab.txt match as one family', () => {
  const familyVariants = [
    'repo_knowledge_pack_part_aa.txt',
    'repo_knowledge_pack_part_aa.txt.bak.txt',
    'pack_agent_harness_part_ab.txt',
  ];

  for (const sourceTitle of familyVariants) {
    for (const familyKey of familyVariants) {
      assert.equal(
        matchesPackFamily(sourceTitle, familyKey),
        true,
        `matchesPackFamily("${sourceTitle}", "${familyKey}") must be true`
      );
      assert.equal(
        isPackFamilyTitle(sourceTitle, familyKey),
        true,
        `isPackFamilyTitle("${sourceTitle}", "${familyKey}") must be true`
      );
    }
  }

  const sources = familyVariants.map((title, idx) => ({ id: `ah-${idx}`, title }));
  const matched = filterPackFamilySources(sources, 'repo_knowledge_pack_part_aa.txt.bak.txt');
  assert.equal(matched.length, 3);
});

test('ingest-notebooklm.sh poll_new_sources_active treats status 3 as ERROR and preserves purge pattern', () => {
  const ingestScript = fs.readFileSync(path.join(REPO_ROOT, 'modules', 'notebooklm', 'ingest-notebooklm.sh'), 'utf8');

  const pollFnMatch = ingestScript.match(/poll_new_sources_active\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(pollFnMatch, 'poll_new_sources_active function must exist in ingest-notebooklm.sh');
  const pollBlock = pollFnMatch[0];

  const errRegexMatch = pollBlock.match(/\/\^\(([^)]*)\)\$\/i\.test\(String\(s\?\.status\)\)\)+/);
  assert.ok(errRegexMatch, 'must find explicit ERROR status regex in poll_new_sources_active');
  const errRegex = new RegExp(`^(${errRegexMatch[1]})$`, 'i');
  assert.equal(errRegex.test('3'), true, 'explicit error regex must match status 3');
  assert.equal(errRegex.test('ERROR'), true);
  assert.equal(errRegex.test('FAILED'), true);

  const allowedRegexMatch = pollBlock.match(/!\/\^\(([^)]*)\)\$\/i\.test\(String\(s\.status\)\)\)+/);
  assert.ok(allowedRegexMatch, 'must find allowed/in-flight status regex in poll_new_sources_active');
  const allowedRegex = new RegExp(`^(${allowedRegexMatch[1]})$`, 'i');
  assert.equal(allowedRegex.test('3'), false, 'in-flight/allowed status regex must not list 3');
  assert.equal(allowedRegex.test('1'), true);
  assert.equal(allowedRegex.test('2'), true);
  assert.equal(allowedRegex.test('5'), true);

  const purgePatternMatch = ingestScript.match(/const\s+pattern\s*=\s*(\/[^/]+\/[a-z]*);/);
  assert.ok(purgePatternMatch, 'must find purge pattern in ingest-notebooklm.sh');
  assert.equal(purgePatternMatch[1].includes('repo[_-]?knowledge[_-]?pack'), true);
  assert.equal(purgePatternMatch[1].includes('pack_'), true);
  assert.equal(purgePatternMatch[1].includes('\\.txt'), true);
});

test('matchesPackFamily and isPackFamilyTitle recognize live H1 titles for modules and personal-os', () => {
  assert.equal(matchesPackFamily('KB - Modules Pack', 'pack_modules'), true);
  assert.equal(matchesPackFamily('KB - Modules Pack', 'modules'), true);
  assert.equal(matchesPackFamily('pack_modules.txt', 'pack_modules'), true);

  assert.equal(matchesPackFamily('Personal OS (Household, Utilities, Florida Logistics) Pack', 'pack_personal_os'), true);
  assert.equal(matchesPackFamily('Personal OS (Household, Utilities, Florida Logistics) Pack', 'personal-os'), true);
  assert.equal(matchesPackFamily('pack_personal_os.txt', 'pack_personal_os'), true);

  assert.equal(isPackFamilyTitle('KB - Modules Pack'), true);
  assert.equal(isPackFamilyTitle('Personal OS (Household, Utilities, Florida Logistics) Pack'), true);
});

