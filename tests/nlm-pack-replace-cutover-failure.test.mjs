import test from 'node:test';
import assert from 'node:assert/strict';
import { replacePackFamilyAtomic } from '../scripts/nlm-pack-replace-gate.mjs';

test('partial old-generation deletion is reported as failure and keeps active replacement', async () => {
  const deleted = [];
  const uploaded = [];
  let listCalls = 0;
  const old = [
    { id: 'old-aa', title: 'repo_knowledge_pack_part_aa.txt', status: 2 },
    { id: 'old-ab', title: 'repo_knowledge_pack_part_ab.txt', status: 2 },
  ];
  const runList = async () => {
    listCalls += 1;
    return listCalls === 1
      ? old
      : [
        ...old,
        ...uploaded.map(id => ({ id, title: id.replace('new-', 'repo_knowledge_pack_part_') + '.txt', status: 2 })),
      ];
  };
  const runUpload = async () => {
    const id = `new-${uploaded.length ? 'ab' : 'aa'}`;
    uploaded.push(id);
    return { source_id: id };
  };
  const runDelete = async id => {
    if (id === 'old-ab') throw new Error('provider timeout');
    deleted.push(id);
  };

  await assert.rejects(
    replacePackFamilyAtomic({
      notebookId: '359b346c-6af7-4ba3-baef-b985c9e6e1af',
      packFiles: ['repo_knowledge_pack_part_aa.txt', 'repo_knowledge_pack_part_ab.txt'],
      expectedPartCount: 2,
      runList,
      runUpload,
      runDelete,
      waitMs: 0,
    }),
    error => {
      assert.match(error.message, /PARTIAL_CUTOVER/);
      assert.deepEqual(error.deletedSourceIds, ['old-aa']);
      assert.deepEqual(error.remainingSourceIds, ['old-ab']);
      return true;
    },
  );
  assert.deepEqual(deleted, ['old-aa']);
  assert.deepEqual(uploaded, ['new-aa', 'new-ab']);
});
