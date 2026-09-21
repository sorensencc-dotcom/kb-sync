import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPackFamilyTitle,
  filterPackFamilySources,
  purgePackFamilyBeforeUpload,
  buildNotebookLmUploadCommand,
} from '../scripts/nlm-pack-replace-gate.mjs';

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
  const mockCli = 'node tests/mock-nlm-cli.mjs';
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
  const mockCli = 'node tests/mock-nlm-cli.mjs';
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
  const mockCli = 'node tests/mock-nlm-cli.mjs';
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
  const mockCli = 'node tests/mock-nlm-cli.mjs';
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
