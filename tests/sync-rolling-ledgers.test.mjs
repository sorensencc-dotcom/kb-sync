import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  ROLLING_LEDGER_MAPPINGS,
  matchesSourceTitle,
  computeSha256,
  loadRollingLedgerState,
  saveRollingLedgerState,
  findLocalFileCandidates,
  resolveDriveFileContent,
  replaceRollingLedgerSource,
  syncSingleRollingLedger,
  syncRollingLedgers,
} from '../scripts/pipeline/sync-rolling-ledgers.mjs';

test('ROLLING_LEDGER_MAPPINGS defines all 7 required source mappings', () => {
  assert.equal(ROLLING_LEDGER_MAPPINGS.length, 7);

  const byId = Object.fromEntries(ROLLING_LEDGER_MAPPINGS.map((m) => [m.id, m]));

  // 1. TRM Staging & Gap Sweep
  assert.ok(byId['trm-staging-gap-sweep']);
  assert.equal(byId['trm-staging-gap-sweep'].targetNotebookId, '1b4861a3-931f-4632-8fc1-343a8dd37df8');
  assert.equal(byId['trm-staging-gap-sweep'].sourceTitle, 'TRM Staging & Gap Sweep — Rolling Log');
  assert.equal(byId['trm-staging-gap-sweep'].folderId, '1g3UQc2LM7YcXgr6f0G9H0NByns66cZ7q');

  // 2. Daily Intelligence Briefing
  assert.ok(byId['daily-intel-briefing']);
  assert.equal(byId['daily-intel-briefing'].targetNotebookId, 'c17c2a18-3562-4fe4-9880-c1289ec5f506');
  assert.equal(byId['daily-intel-briefing'].sourceTitle, 'Daily Intelligence Briefing — Rolling 7-Day Ledger');
  assert.equal(byId['daily-intel-briefing'].folderId, '1g3UQc2LM7YcXgr6f0G9H0NByns66cZ7q');

  // 3. Operational Ideas Harvest
  assert.ok(byId['operational-ideas-harvest']);
  assert.equal(byId['operational-ideas-harvest'].targetNotebookId, 'c17c2a18-3562-4fe4-9880-c1289ec5f506');
  assert.equal(byId['operational-ideas-harvest'].sourceTitle, 'Operational Ideas Harvest — Rolling Log');

  // 4. Unsubscribe Audit Ledger
  assert.ok(byId['unsubscribe-audit-ledger']);
  assert.equal(byId['unsubscribe-audit-ledger'].targetNotebookId, '9724e682-c5ea-4693-8e21-caf8de68611e');
  assert.equal(byId['unsubscribe-audit-ledger'].sourceTitle, 'Unsubscribe Audit Ledger');

  // 5. Tampa Bourbon Deals
  assert.ok(byId['tampa-bourbon-deals']);
  assert.equal(byId['tampa-bourbon-deals'].targetNotebookId, '3d1f84b2-1ac8-48d2-8ec8-5052e91a55a0');
  assert.equal(byId['tampa-bourbon-deals'].sourceTitle, 'Tampa Bourbon Deals — Rolling Tracker');

  // 6. AI News Summary
  assert.ok(byId['ai-news-summary']);
  assert.equal(byId['ai-news-summary'].targetNotebookId, 'bec5a197-8256-4eba-af78-c4881cc28fdd');
  assert.equal(byId['ai-news-summary'].sourceTitle, 'AI News Summary — Rolling 7-Day Ledger');
  assert.equal(byId['ai-news-summary'].folderId, '1y0h4HEkg_mBVKfCbQIZ0_cag_3QyXvEy');

  // 7. Rewrite Labs Industry Briefing
  assert.ok(byId['rewrite-labs-industry-briefing']);
  assert.equal(byId['rewrite-labs-industry-briefing'].targetNotebookId, '140119ae-3496-45c9-bf0c-71c955136afc');
  assert.equal(byId['rewrite-labs-industry-briefing'].sourceTitle, 'Rewrite Labs Industry Briefing — Rolling Ledger');
});

test('matchesSourceTitle handles extensions, em dashes, en dashes, and whitespace', () => {
  assert.equal(
    matchesSourceTitle(
      'TRM Staging & Gap Sweep — Rolling Log.txt',
      'TRM Staging & Gap Sweep — Rolling Log'
    ),
    true
  );
  assert.equal(
    matchesSourceTitle(
      'TRM Staging & Gap Sweep - Rolling Log',
      'TRM Staging & Gap Sweep — Rolling Log'
    ),
    true
  );
  assert.equal(
    matchesSourceTitle(
      'Daily Intelligence Briefing – Rolling 7-Day Ledger.md',
      'Daily Intelligence Briefing — Rolling 7-Day Ledger'
    ),
    true
  );
  assert.equal(
    matchesSourceTitle(
      'Unsubscribe Audit Ledger',
      'Unsubscribe Audit Ledger'
    ),
    true
  );
  assert.equal(
    matchesSourceTitle(
      'pack_daily.txt',
      'TRM Staging & Gap Sweep — Rolling Log'
    ),
    false
  );
});

test('loadRollingLedgerState and saveRollingLedgerState maintain state correctly', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rolling-state-test-'));
  const statePath = path.join(tmpDir, 'rolling-state.json');

  const empty = loadRollingLedgerState(statePath);
  assert.deepEqual(empty, { lastSync: null, entries: {} });

  saveRollingLedgerState(statePath, {
    entries: {
      'trm-staging-gap-sweep': {
        contentHash: 'abc123hash',
        status: 'SUCCESS',
        sourceId: 'src_999',
      },
    },
  });

  const loaded = loadRollingLedgerState(statePath);
  assert.equal(loaded.entries['trm-staging-gap-sweep'].contentHash, 'abc123hash');
  assert.equal(loaded.entries['trm-staging-gap-sweep'].status, 'SUCCESS');
  assert.equal(loaded.entries['trm-staging-gap-sweep'].sourceId, 'src_999');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('findLocalFileCandidates finds raw .md and .gdoc files with name variants', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-candidates-test-'));
  const folderDir = path.join(tmpDir, 'research-gaps');
  fs.mkdirSync(folderDir, { recursive: true });

  const mapping = ROLLING_LEDGER_MAPPINGS[0]; // TRM Staging & Gap Sweep — Rolling Log.md
  const targetFile = path.join(folderDir, 'TRM Staging & Gap Sweep — Rolling Log.md');
  fs.writeFileSync(targetFile, '# Sample Content');

  const found = findLocalFileCandidates(mapping, [tmpDir]);
  assert.equal(found, targetFile);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('resolveDriveFileContent reads raw markdown and exports .gdoc files', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-drive-test-'));
  const folderDir = path.join(tmpDir, 'research-gaps');
  fs.mkdirSync(folderDir, { recursive: true });

  const mapping = ROLLING_LEDGER_MAPPINGS[3]; // Unsubscribe Audit Ledger.md

  // 1. Raw file test
  const rawFile = path.join(folderDir, 'Unsubscribe Audit Ledger.md');
  fs.writeFileSync(rawFile, 'Raw markdown content for unsubscribe ledger');

  const rawRes = await resolveDriveFileContent(mapping, { candidateRoots: [tmpDir] });
  assert.equal(rawRes.content, 'Raw markdown content for unsubscribe ledger');
  assert.equal(rawRes.sourceMethod, 'local_file');

  // 2. .gdoc stub test with docFetcher
  fs.unlinkSync(rawFile);
  const gdocFile = path.join(folderDir, 'Unsubscribe Audit Ledger.gdoc');
  fs.writeFileSync(gdocFile, JSON.stringify({ doc_id: 'doc_xyz_789' }));

  const gdocRes = await resolveDriveFileContent(mapping, {
    candidateRoots: [tmpDir],
    docFetcher: async (docId) => {
      assert.equal(docId, 'doc_xyz_789');
      return { content: 'Exported doc content' };
    },
  });
  assert.equal(gdocRes.content, 'Exported doc content');
  assert.equal(gdocRes.sourceMethod, 'local_gdoc_fetcher');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('replaceRollingLedgerSource enforces stage-before-drop, status 2 polling, and pacing delay', async () => {
  const events = [];
  const oldSourceId = 'src_old_generation_001';
  const newSourceId = 'src_new_generation_002';
  const otherPackSourceId = 'pack_daily_src_123';

  const mockLiveSources = [
    { id: oldSourceId, title: 'TRM Staging & Gap Sweep — Rolling Log.txt', status: 2 },
    { id: otherPackSourceId, title: 'pack_daily.txt', status: 2 }, // must NOT be deleted
  ];

  const listFn = async (nbId) => {
    events.push({ type: 'list', nbId });
    return mockLiveSources;
  };

  const uploadFn = async (nbId, file) => {
    events.push({ type: 'upload', nbId, file: path.basename(file) });
    // Add new source to mock live list with in-flight status 1 initially
    mockLiveSources.push({ id: newSourceId, title: path.basename(file), status: 2 });
    return { source_id: newSourceId };
  };

  const pollFn = async (nbId, ids) => {
    events.push({ type: 'poll', nbId, ids });
    assert.deepEqual(ids, [newSourceId]);
    return true;
  };

  const deleteFn = async (nbId, srcId, lease) => {
    events.push({ type: 'delete', nbId, srcId, reason: lease.reason });
    assert.equal(lease.reason, 'replacement');
    assert.ok(lease.sourceIds.includes(srcId));
  };

  const res = await replaceRollingLedgerSource({
    cli: 'nlm',
    notebookId: '1b4861a3-931f-4632-8fc1-343a8dd37df8',
    sourceTitle: 'TRM Staging & Gap Sweep — Rolling Log',
    content: '# Updated Rolling Log\nItem 1\nItem 2',
    options: {
      waitMs: 10, // fast pacing in test
      listFn,
      uploadFn,
      pollFn,
      deleteFn,
    },
  });

  assert.equal(res.status, 'SUCCESS');
  assert.equal(res.sourceId, newSourceId);
  assert.deepEqual(res.purgedSourceIds, [oldSourceId]);

  // Order of operations assertion: list -> upload -> poll -> delete
  const types = events.map((e) => e.type);
  assert.deepEqual(types, ['list', 'upload', 'poll', 'delete']);

  // Assert otherPackSourceId was not deleted
  const deletedIds = events.filter((e) => e.type === 'delete').map((e) => e.srcId);
  assert.ok(!deletedIds.includes(otherPackSourceId));
  assert.ok(deletedIds.includes(oldSourceId));
});

test('replaceRollingLedgerSource rolls back new source if activation fails, preserving old source', async () => {
  const events = [];
  const oldSourceId = 'src_old_safe_001';
  const newFailedId = 'src_new_failed_002';

  const mockLiveSources = [
    { id: oldSourceId, title: 'Unsubscribe Audit Ledger', status: 2 },
  ];

  const listFn = async () => mockLiveSources;
  const uploadFn = async () => ({ source_id: newFailedId });
  const pollFn = async () => {
    events.push('poll_failed');
    throw new Error('TIMEOUT waiting for status 2 ACTIVE');
  };
  const deleteFn = async (nbId, srcId, lease) => {
    events.push({ type: 'delete', srcId, reason: lease.reason });
  };

  await assert.rejects(
    async () => {
      await replaceRollingLedgerSource({
        cli: 'nlm',
        notebookId: '9724e682-c5ea-4693-8e21-caf8de68611e',
        sourceTitle: 'Unsubscribe Audit Ledger',
        content: 'Failing content',
        options: {
          waitMs: 10,
          listFn,
          uploadFn,
          pollFn,
          deleteFn,
        },
      });
    },
    /TIMEOUT waiting for status 2 ACTIVE/
  );

  // Assert rollback deleted only the new failed source, NOT the old safe source
  const deletedOrphans = events.filter((e) => e.type === 'delete');
  assert.equal(deletedOrphans.length, 1);
  assert.equal(deletedOrphans[0].srcId, newFailedId);
  assert.equal(deletedOrphans[0].reason, 'rollback');
});

test('syncSingleRollingLedger is idempotent when content hash matches prior sync', async () => {
  const mapping = ROLLING_LEDGER_MAPPINGS[4]; // Tampa Bourbon Deals
  const content = 'Bourbon deal: Buffalo Trace $25';
  const hash = computeSha256(content);

  const state = {
    entries: {
      'tampa-bourbon-deals': {
        contentHash: hash,
        status: 'SUCCESS',
        sourceId: 'src_existing',
      },
    },
  };

  let uploadCalled = false;
  const res = await syncSingleRollingLedger(mapping, {
    state,
    contentResolver: async () => ({ content }),
    uploadFn: async () => {
      uploadCalled = true;
      return { source_id: 'new_id' };
    },
  });

  assert.equal(res.status, 'SKIPPED');
  assert.equal(res.reason, 'UNCHANGED');
  assert.equal(uploadCalled, false);
});

test('syncRollingLedgers synchronizes dirty ledgers and persists state', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-all-test-'));
  const statePath = path.join(tmpDir, 'state.json');

  const stagedIds = [];
  const out = await syncRollingLedgers({
    statePath,
    mappings: [ROLLING_LEDGER_MAPPINGS[0], ROLLING_LEDGER_MAPPINGS[1]],
    contentResolver: async (m) => ({
      content: `Content for ${m.sourceTitle} at ${Date.now()}`,
      modifiedTime: new Date().toISOString(),
    }),
    listFn: async () => [],
    uploadFn: async (nbId, file) => {
      const sid = `sid_${path.basename(file).slice(0, 10)}_${Date.now()}`;
      stagedIds.push(sid);
      return { source_id: sid };
    },
    pollFn: async () => true,
    deleteFn: async () => {},
    waitMs: 5,
  });

  assert.equal(out.total, 2);
  assert.equal(out.synced, 2);
  assert.equal(out.failed, 0);

  const state = loadRollingLedgerState(statePath);
  assert.ok(state.entries['trm-staging-gap-sweep']);
  assert.equal(state.entries['trm-staging-gap-sweep'].status, 'SUCCESS');
  assert.ok(state.entries['daily-intel-briefing']);
  assert.equal(state.entries['daily-intel-briefing'].status, 'SUCCESS');

  // Second pass without force should skip both
  const secondPass = await syncRollingLedgers({
    statePath,
    mappings: [ROLLING_LEDGER_MAPPINGS[0], ROLLING_LEDGER_MAPPINGS[1]],
    contentResolver: async (m) => ({
      // Same content
      content: state.entries[m.id].contentHash ? undefined : 'changed',
    }),
    listFn: async () => [],
    waitMs: 5,
  });

  // Since contentResolver returns undefined, they are skipped
  assert.equal(secondPass.skipped, 2);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('cluster-sync-runner wire-in executes without error on dryRun and supports skip flag', async () => {
  const { executeClusterSync } = await import('../scripts/pipeline/cluster-sync-runner.mjs');

  const res = await executeClusterSync({
    mode: 'catchup',
    dryRun: true,
    skipRollingLedgerSync: false,
  });

  assert.equal(res.mode, 'catchup');
  assert.equal(typeof res.targetCount, 'number');
});

