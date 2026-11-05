import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGroundingPrompt } from '../scripts/notebooklm/verify-grounding-gate.mjs';
import { KB_TESTING_SANDBOX_UUID } from '../scripts/notebooklm/sandbox-contract.mjs';

test('verify-grounding-gate resolves dynamic domain questions for registered cluster notebooks', () => {
  const agentHarnessUuid = '359b346c-6af7-4ba3-baef-b985c9e6e1af';
  const timestamp = '2026-11-04T12:00:00.000Z';
  const prompt = resolveGroundingPrompt(agentHarnessUuid, timestamp);

  assert.ok(prompt.startsWith(`[${timestamp}] [KB-Sync Grounding Verification] `));
  assert.doesNotMatch(
    prompt,
    /What is the repo_root configuration in configs\/notebooklm\.yaml\?/,
    'Registered notebook must not fall back to static repo_root configuration query'
  );
  assert.match(
    prompt,
    /(Graft|SAM|Herdr|harness|subagent|terminal)/i,
    'Agent Harness notebook must receive domain-anchored harness inquiry'
  );
});

test('verify-grounding-gate preserves sandbox contract for KB_TESTING_SANDBOX_UUID', () => {
  const prompt = resolveGroundingPrompt(KB_TESTING_SANDBOX_UUID);
  assert.match(
    prompt,
    /For Entity ALPHA-101/i,
    'Sandbox notebook must preserve pinned fixture inquiry'
  );
});

test('verify-grounding-gate falls back to timestamped grounding prompt for unknown notebooks', () => {
  const unknownUuid = '00000000-0000-0000-0000-000000000000';
  const timestamp = '2026-11-04T12:00:00.000Z';
  const prompt = resolveGroundingPrompt(unknownUuid, timestamp);

  assert.equal(
    prompt,
    `[${timestamp}] [KB-Sync Grounding Verification] What is the repo_root configuration in configs/notebooklm.yaml?`
  );
});
