import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runChatInjection, getNotebookSources, synthesizeDynamicQuestions } from '../../scripts/notebooklm/chat-injection-runner.mjs';
import { KB_TESTING_SANDBOX_UUID as notebookId, KB_TESTING_FIXTURE_SOURCE_ID as fixtureId, assertLiveSandbox } from '../../scripts/notebooklm/sandbox-contract.mjs';
import { resolveCitations, hasPackGrounding } from '../../modules/notebooklm/lib/grounding-citations.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const enabled = process.env.NLM_LIVE_SANDBOX === '1';
const replacementEnabled = process.env.NLM_REPLACE_GATE_LIVE === '1';
const evidenceDir = path.resolve(process.env.NLM_LIVE_EVIDENCE_DIR || path.join(root, '.tmp_test_staging', `live-${randomUUID()}`));
function cli(args, json = true) {
  assertLiveSandbox(process.env.TEST_NOTEBOOK_ID || notebookId);
  console.log(`[LIVE] ${args.slice(0, 3).join(' ')}`);
  const result = spawnSync('nlm', args, { encoding: 'utf8', timeout: 180000 });
  assert.equal(result.status, 0, `${args.slice(0, 2).join(' ')}: ${result.error?.message || result.stderr}`);
  return json ? JSON.parse(result.stdout) : result.stdout;
}
function save(name, data) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, name), JSON.stringify(data, null, 2));
}
const listed = raw => Array.isArray(raw) ? raw : raw.sources;
function cleanupOwned(ownedIds, before) {
  const current = listed(cli(['source', 'list', notebookId, '--json']));
  for (const id of new Set(ownedIds)) {
    assert.ok(id !== fixtureId && !before.some(s => s.id === id), 'Cleanup requires newly registered run ID');
    if (current.some(s => s.id === id)) cli(['source', 'delete', id, '-y'], false);
  }
  const after = listed(cli(['source', 'list', notebookId, '--json']));
  save('cleanup-source-list.json', after);
  assert.deepEqual(after.map(s => s.id).sort(), before.map(s => s.id).sort(), 'Cleanup must preserve every preexisting source and remove every run-created source');
}

test('LIVE sandbox: three pinned answers, structured citations, and remote transcript readback', { skip: !enabled, timeout: 600000 }, async () => {
  assertLiveSandbox(process.env.TEST_NOTEBOOK_ID || notebookId);
  const sources = getNotebookSources(notebookId);
  assert.ok(sources.some(s => s.id === fixtureId), 'Pinned fixture must exist before queries');
  const injection = await runChatInjection({ targetSlugOrUuid: notebookId, evidenceDir });
  save('chat-injection.json', injection);
  assert.equal(injection.runResults.length, 1);
  assert.equal(injection.runResults[0].turns, 3);
  assert.ok(fs.readFileSync(injection.runResults[0].logPath, 'utf8').includes('conversation_id'));
  const assertions = [
    [/8765/, /WAL/i],
    [/Ordenskapitlet/i, /(?:May\s+24,?\s+1930|24\s+May\s+1930|1930-05-24)/i, /(?:July\s+27,?\s+1937|27\s+July\s+1937|1937-07-27)/i, /Knight/i, /Commander/i, /GAP[- ]?0?1\b/i, /GAP[- ]?27\b/i, /GAP[- ]?45\b/i],
    [/380\s*KiB/i, /389[ ,]?120/, /3\.5[\s-]*(?:s\b|seconds?)/i],
  ];
  for (const [index, question] of synthesizeDynamicQuestions({ uuid: notebookId }).entries()) {
    const turn = injection.runResults[0].turnRecords[index];
    const result = { ok: true, data: turn.answer, response: turn.response };
    save(`${question.id}-query.json`, result);
    assert.equal(result.ok, true, result.error);
    assert.equal(typeof result.data, 'string');
    assert.ok(result.data.length > 80 && !result.data.includes(question.text), 'Substantive answer required; question echo rejected');
    for (const pattern of assertions[index]) assert.match(result.data, pattern);
    const citations = resolveCitations(result.response, sources);
    assert.ok(citations.length > 0 && citations.every(c => c.source_id === fixtureId), 'Every structured citation must identify pinned fixture');
    assert.ok(result.response.references?.length > 0 && result.response.references.every(ref => ref.source_id === fixtureId), 'Every structured reference must identify pinned fixture');
    assert.ok(result.response.conversation_id, 'Real conversation ID required');
    const transcript = cli(['chats', 'get', notebookId, result.response.conversation_id, '--json']);
    save(`${question.id}-transcript.json`, transcript);
    assert.ok(transcript.turn_count > 0 && transcript.transcript?.some(turn => turn.query === question.text && turn.answer === result.data), 'Remote transcript must contain exact recorded question and answer');
    await new Promise(resolve => setTimeout(resolve, 3500));
  }
});

test('LIVE sandbox: real ingestion, source content readback, receipt, and repeat-run idempotency', { skip: !enabled, timeout: 360000 }, () => {
  assertLiveSandbox(process.env.TEST_NOTEBOOK_ID || notebookId);
  const runId = randomUUID();
  const staging = path.join(evidenceDir, `ingest-${runId}`);
  fs.mkdirSync(staging, { recursive: true });
  const fileName = `sandbox-ingest-${runId}.txt`;
  const content = `Unique sandbox ingestion proof ${runId}. No production facts.\n`;
  fs.writeFileSync(path.join(staging, fileName), content);
  const ownedIds = [];
  const run = () => {
    console.log('[LIVE] Executing ingestion runner');
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/notebooklm/ingest-nlm-runner.mjs'), notebookId, '--staging-dir', staging], { encoding: 'utf8', timeout: 150000 });
    const report = JSON.parse(result.stdout);
    ownedIds.push(...(report.uploadedSourceIds || []));
    save('ingestion-last-report.json', report);
    assert.equal(result.status, 0, result.stderr);
    return report;
  };
  const before = listed(cli(['source', 'list', notebookId, '--json']));
  try {
  const first = run();
  save('ingestion-first.json', first);
  assert.equal(first.ingested, 1);
  const receipts = JSON.parse(fs.readFileSync(path.join(staging, '.nlm-sync-receipt.json'), 'utf8'));
  const receipt = Object.values(receipts.receipts)[0];
  assert.ok(receipt.sourceId && receipt.hash && receipt.sizeBytes === Buffer.byteLength(content));
  assert.ok(!before.some(s => s.id === receipt.sourceId), 'Source must belong to current run');
  const readback = cli(['source', 'content', receipt.sourceId, '--json']);
  save('ingestion-readback.json', readback);
  assert.ok(JSON.stringify(readback).includes(runId), 'Server content must contain unique run marker');
  const second = run();
  save('ingestion-second.json', second);
  assert.equal(second.ingested, 0);
  assert.equal(second.skippedAlreadySynced, 1);
  assert.equal(listed(cli(['source', 'list', notebookId, '--json'])).filter(s => s.id === receipt.sourceId).length, 1);
  } finally { cleanupOwned(ownedIds, before); }
});

test('LIVE sandbox: replacement retains old through upload failure and ACTIVE plus pacing before delete', { skip: !replacementEnabled, timeout: 600000 }, async () => {
  assertLiveSandbox(process.env.TEST_NOTEBOOK_ID || notebookId);
  const runId = randomUUID();
  const file = path.join(evidenceDir, `pack_sandbox_${runId}.txt`);
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(file, `Owned replacement proof ${runId}\n`);
  const replace = (pack, oldSourceIds = []) => {
    console.log(`[LIVE] Executing replacement; old owned sources: ${oldSourceIds.length}`);
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/run-closed-loop-research.mjs'), '--notebook', notebookId, '--sandbox-pack', pack, '--sandbox-run-id', runId, ...oldSourceIds.flatMap(id => ['--owned-source-id', id])], { encoding: 'utf8', timeout: 180000 });
    if (result.status !== 0) {
      save('replacement-command-failure.json', { status: result.status, stdout: result.stdout, stderr: result.stderr });
      const error = new Error(`Replacement exited ${result.status}: ${result.stderr || result.stdout || result.error?.message}`);
      error.exitCode = result.status;
      throw error;
    }
    return JSON.parse(result.stdout);
  };
  const before = listed(cli(['source', 'list', notebookId, '--json']));
  const beforeIds = new Set(before.map(s => s.id));
  try {
  const first = replace(file);
  assert.ok(!beforeIds.has(first.newSourceId));
  save('replacement-first.json', first);
  const packQuery = cli(['query', 'notebook', notebookId, 'What is the unique owned replacement proof marker in this uploaded source?', '--source-ids', first.newSourceId, '--json', '--timeout', '120']);
  save('uploaded-pack-grounding.json', packQuery);
  const packSources = listed(cli(['source', 'list', notebookId, '--json']));
  assert.ok(hasPackGrounding(packQuery, packSources, [path.basename(file)]), 'Stage 1.5 pack attribution must cite uploaded owned pack');
  assert.ok(resolveCitations(packQuery, packSources).every(c => c.source_id === first.newSourceId));
  assert.ok(packQuery.answer?.includes(runId), 'Uploaded pack answer must contain unique source marker');
  assert.throws(() => replace(`${file}.missing`, [first.newSourceId]), error => error.exitCode === 1);
  const old = cli(['source', 'get', first.newSourceId, '--json']);
  save('replacement-failed-upload-old-retained.json', old);
  fs.writeFileSync(file, `Updated owned replacement proof ${runId}\n`);
  const second = replace(file, [first.newSourceId]);
  save('replacement.json', { first, second, runId });
  assert.ok(second.deletedAt - second.activeVerifiedAt >= 3500);
  const ids = listed(cli(['source', 'list', notebookId, '--json'])).map(s => s.id);
  assert.ok(ids.includes(fixtureId) && ids.includes(second.newSourceId) && !ids.includes(first.newSourceId));
  } finally {
    const receiptPath = `${file}.sources.json`;
    const ownedIds = fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath, 'utf8')) : [];
    cleanupOwned(ownedIds, before);
  }
});

test('LIVE sandbox: actual Stage 1.5 verifies pinned fixture without changing production pack attribution', { skip: !enabled, timeout: 240000 }, () => {
  assertLiveSandbox(process.env.TEST_NOTEBOOK_ID || notebookId);
  console.log('[LIVE] Executing Stage 1.5 grounding gate');
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/notebooklm/verify-grounding-gate.mjs'), notebookId], { encoding: 'utf8', timeout: 210000 });
  save('stage1.5.json', result);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASSED.*pinned sandbox fixture/);
});
