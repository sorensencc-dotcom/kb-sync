import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveBashExecutable } from '../modules/notebooklm/lib/bash-resolver.mjs';
import { hasPackGrounding } from '../modules/notebooklm/lib/grounding-citations.mjs';
import { KB_TESTING_SANDBOX_UUID as notebookId, KB_TESTING_FIXTURE_SOURCE_ID as fixtureId, KB_TESTING_FIXTURE_TITLE, assertLiveSandbox, findActiveUploadedSource } from '../scripts/notebooklm/sandbox-contract.mjs';
import { filterPackFamilySources, deleteNotebookSource, replaceSandboxPack } from '../scripts/nlm-pack-replace-gate.mjs';
import { loadClusterRegistry, selectChatTargets, synthesizeDynamicQuestions, calculateQuestionEntropy, MIN_ENTROPY_THRESHOLD, executeNlmQuery, formatSynthesisLog } from '../scripts/notebooklm/chat-injection-runner.mjs';

test('production synthesis format excludes raw query metadata; sandbox retains evidence', () => {
  const turns = [{ questionId: 'proof', question: 'A question', answer: 'An answer', response: { conversation_id: 'recorded-session' } }];
  const ordinary = formatSynthesisLog({ uuid: 'production', title: 'Production' }, turns, '2026-10-14');
  const sandbox = formatSynthesisLog({ uuid: notebookId, title: 'Sandbox' }, turns, '2026-10-14');
  assert.equal(ordinary.includes('recorded-session'), false);
  assert.ok(sandbox.includes('recorded-session'));
});

test('shared shell deletion wrapper rejects pinned fixture before invoking CLI', () => {
  const lib = fileURLToPath(new URL('../modules/notebooklm/lib/nlm-cli.sh', import.meta.url));
  const result = spawnSync(resolveBashExecutable(), ['-c', 'source "$1"; run_nlm_cli() { echo UNEXPECTED_RPC; }; nlm_source_delete "$2" "$3"', 'fixture-check', lib, notebookId, fixtureId], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /PROTECTED_SANDBOX_FIXTURE/);
  assert.equal(result.stdout.includes('UNEXPECTED_RPC'), false);
});

test('sandbox registry is explicit-only and master-excluded; all three text questions preserve entropy contract', () => {
  const registry = loadClusterRegistry();
  assert.equal(selectChatTargets(registry).some(n => n.uuid === notebookId), false);
  assert.deepEqual(selectChatTargets(registry, 'kb-testing').map(n => n.uuid), [notebookId]);
  const category = JSON.parse(fs.readFileSync(new URL('../core/categories.json', import.meta.url))).categories['kb-testing'];
  assert.equal(category.exclude_from_master_kb, true);
  const questions = synthesizeDynamicQuestions({ uuid: notebookId });
  assert.equal(questions.length, 3);
  for (const [index, entity] of ['ALPHA-101', 'BRAVO-202', 'CHARLIE-303'].entries()) assert.ok(questions[index].text.includes(entity));
  assert.ok(calculateQuestionEntropy(questions) >= MIN_ENTROPY_THRESHOLD);
});

test('sandbox query fails closed before RPC without exact single fixture pin', () => {
  for (const sourceIds of [undefined, [], ['other'], [fixtureId, 'other']]) assert.throws(() => executeNlmQuery(notebookId, 'query', { sourceIds }), /SANDBOX_FIXTURE_REQUIRED/);
});

test('live ingest receipt binds exact returned upload ID and ACTIVE even when old title matches', () => {
  const sources = [{ id: 'old', title: 'same.txt', status: 2 }, { id: 'new', title: 'same.txt', status: 1 }];
  assert.equal(findActiveUploadedSource(sources, 'new'), undefined);
  sources[1].status = 2;
  assert.equal(findActiveUploadedSource(sources, 'new').id, 'new');
  assert.equal(findActiveUploadedSource(sources, 'missing'), undefined);
});

test('Stage 1.5 pack attribution requires structured citations to uploaded pack, not fixture or question text', () => {
  const sources = [{ id: fixtureId, title: KB_TESTING_FIXTURE_TITLE }, { id: 'pack-id', title: 'repo_knowledge_pack_part_aa.txt' }];
  assert.equal(hasPackGrounding({ citations: { 1: 'pack-id' } }, sources, ['repo_knowledge_pack']), true);
  assert.equal(hasPackGrounding({ citations: { 1: fixtureId } }, sources, ['repo_knowledge_pack']), false);
  assert.equal(hasPackGrounding({ answer: 'repo_knowledge_pack', citations: {} }, sources, ['repo_knowledge_pack']), false);
});

test('live guard rejects non-sandbox IDs and inherited mock CLI environments', () => {
  assert.throws(() => assertLiveSandbox('production', {}), /LIVE_SANDBOX_ONLY/);
  for (const key of ['NLM_CLI', 'NOTEBOOKLM_CLI', 'TEST_MOCK_MODE', 'MOCK_NLM_MODE']) assert.throws(() => assertLiveSandbox(notebookId, { [key]: 'stub' }), /LIVE_MOCK_OVERRIDE_FORBIDDEN/);
  assert.doesNotThrow(() => assertLiveSandbox(notebookId, {}));
});

test('fixture protection covers every ID/title alias even with pack-like title, preserving ordinary aliases', () => {
  for (const alias of ['id', 'sourceId', 'source_id']) assert.deepEqual(filterPackFamilySources([{ [alias]: fixtureId, title: 'pack_agent_harness.txt' }]), []);
  for (const alias of ['title', 'name', 'displayName']) assert.deepEqual(filterPackFamilySources([{ id: 'other', title: 'pack_agent_harness.txt', [alias]: KB_TESTING_FIXTURE_TITLE }]), []);
  for (const alias of ['title', 'name', 'displayName']) assert.equal(filterPackFamilySources([{ id: 'ordinary', [alias]: 'pack_agent_harness.txt' }]).length, 1);
  assert.throws(() => deleteNotebookSource('nlm', fixtureId), /PROTECTED_SANDBOX_FIXTURE/);
});

const runId = '11111111-1111-1111-1111-111111111111';
const file = `C:/sandbox/pack_sandbox_${runId}.txt`;
const old = { id: 'owned-old', title: `pack_sandbox_${runId}.txt`, status: 2 };
const fixture = { id: fixtureId, title: KB_TESTING_FIXTURE_TITLE, status: 2 };
test('replacement retains old on failed upload, missing ACTIVE, invalid envelopes, and forged fixture title', async () => {
  for (const mode of ['upload-failure', 'inactive', 'bad-list', 'forged-fixture', 'foreign-old']) {
    let deleted = false;
    let listed = 0;
    const runNlm = args => {
      if (args[1] === 'delete') { deleted = true; return ''; }
      if (args[1] === 'list') {
        listed++;
        if (mode === 'bad-list') return {};
        if (mode === 'forged-fixture') return [{ ...fixture, id: 'forged' }, old];
        if (mode === 'foreign-old') return [fixture, { ...old, title: 'pack_someone_else.txt' }];
        return listed === 1 ? [fixture, old] : [fixture, old, { ...old, id: 'new', status: 1 }];
      }
      if (mode === 'upload-failure') throw new Error('upload rejected');
      return {};
    };
    await assert.rejects(replaceSandboxPack({ notebookId, file, runId, oldSourceIds: [old.id], runNlm }));
    assert.equal(deleted, false, mode);
  }
});

test('replacement deletes only run-owned old IDs after verified ACTIVE and at least 3.5 seconds', { timeout: 10000 }, async () => {
  let listed = 0;
  const deleted = [];
  const registered = [];
  const result = await replaceSandboxPack({ notebookId, file, runId, oldSourceIds: [old.id], onUploaded: id => registered.push(id), runNlm: args => {
    if (args[1] === 'list') return ++listed === 1 ? [fixture, old] : [fixture, old, { ...old, id: 'owned-new' }];
    if (args[1] === 'delete') deleted.push(args[2]);
    return {};
  } });
  assert.equal(result.newSourceId, 'owned-new');
  assert.ok(result.deletedAt - result.activeVerifiedAt >= 3500);
  assert.deepEqual(deleted, [old.id]);
  assert.deepEqual(registered, ['owned-new'], 'Missing add JSON ID must still journal uniquely discovered server ID');
});
