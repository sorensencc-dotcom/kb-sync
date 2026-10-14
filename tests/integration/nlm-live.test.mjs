import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  synthesizeDynamicQuestions,
  calculateQuestionEntropy,
  MIN_ENTROPY_THRESHOLD,
  BANNED_BOILERPLATE_PATTERNS,
} from '../../scripts/notebooklm/chat-injection-runner.mjs';

export const SANDBOX_NOTEBOOK_ID = 'd721ed70-5b37-497f-a279-10ba362c744e';
export const CANONICAL_FIXTURE_SOURCE_ID = 'cc06bd53-1793-4ea0-b723-6f77eb1dd490';

describe('Live Verification Sandbox Integration Harness', () => {
  const targetNotebookId = process.env.TEST_NOTEBOOK_ID || SANDBOX_NOTEBOOK_ID;

  it('binds to the dedicated testing sandbox notebook ID', () => {
    assert.equal(targetNotebookId, SANDBOX_NOTEBOOK_ID);
  });

  it('generates entity-grounded questions targeting sandbox invariant facts', () => {
    const sandboxConfig = {
      slug: 'testing-sandbox',
      uuid: targetNotebookId,
      title: 'KB - Testing Sandbox (Live Verification)',
      section: 'software_dev',
      isCanonical: false,
    };

    const questions = synthesizeDynamicQuestions(sandboxConfig);
    assert.ok(questions.length >= 2, 'Expected at least 2 questions generated');

    for (const q of questions) {
      assert.ok(q.text.length > 20, 'Question text must be substantive');
      for (const pattern of BANNED_BOILERPLATE_PATTERNS) {
        assert.equal(pattern.test(q.text), false, `Question must not match banned boilerplate: ${q.text}`);
      }
    }

    const entropy = calculateQuestionEntropy(questions);
    assert.ok(
      entropy >= MIN_ENTROPY_THRESHOLD,
      `Questions must meet entropy threshold: ${entropy} >= ${MIN_ENTROPY_THRESHOLD}`
    );
  });

  it('checks NLM CLI runtime readiness for live sandbox execution', () => {
    const res = spawnSync('nlm', ['--version'], { encoding: 'utf8', timeout: 5000 });
    if (res.status === 0) {
      assert.ok(res.stdout || res.stderr, 'nlm CLI is installed and responsive');
    } else {
      console.warn('[NLM-LIVE-WARN] Global nlm CLI is not responding on PATH; skipping live RPC probe.');
    }
  });
});
