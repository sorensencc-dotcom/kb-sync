import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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

test('shared shell library exposes no raw deletion primitive', () => {
  const lib = fs.readFileSync(new URL('../modules/notebooklm/lib/nlm-cli.sh', import.meta.url), 'utf8');
  assert.doesNotMatch(lib, /nlm_source_delete|nlm_sources_delete_atomic/);
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
  for (const question of questions) assert.match(question.text, /cite the pinned fixture source for every fact using source references/i);
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

test('fixture filtering covers every ID/title alias even with pack-like title, preserving ordinary aliases', () => {
  for (const alias of ['id', 'sourceId', 'source_id']) assert.deepEqual(filterPackFamilySources([{ [alias]: fixtureId, title: 'pack_agent_harness.txt' }]), []);
  for (const alias of ['title', 'name', 'displayName']) assert.deepEqual(filterPackFamilySources([{ id: 'other', title: 'pack_agent_harness.txt', [alias]: KB_TESTING_FIXTURE_TITLE }]), []);
  for (const alias of ['title', 'name', 'displayName']) assert.equal(filterPackFamilySources([{ id: 'ordinary', [alias]: 'pack_agent_harness.txt' }]).length, 1);
assert.throws(() => deleteNotebookSource('nlm', 'sandbox-notebook', fixtureId, undefined, { protectedSourceIds: [fixtureId] }), /PROTECTED_SOURCE_DELETE/);
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
