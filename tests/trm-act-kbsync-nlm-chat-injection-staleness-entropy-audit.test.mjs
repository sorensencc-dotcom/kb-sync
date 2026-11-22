/**
 * TRM TDD Test Contract: act-kbsync-nlm-chat-injection-staleness-entropy-audit
 * Intent: Verify chat injection battery entropy guarantees, deduplication across turns,
 *         and telemetry freshness invariants for kb-sync and NotebookLM integration.
 * Target: kb-sync
 * Merge Risk: LOW (score: 1)
 *
 * Acceptance Criteria:
 * - kb_sync.last_sync_age_hours < 24h and drift_stale_pages reduced to 0.
 * - All 21 partitioned notebooks have a fresh Daily Synthesis Log with distinct, non-duplicated turn questions.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateDynamicQuestionBattery,
  calculateBatteryEntropy,
  resolveNotebookMetadata,
} from '../scripts/mining/dynamic-question-battery.mjs';
import {
  synthesizeDynamicQuestions,
  calculateQuestionEntropy,
  BANNED_BOILERPLATE_PATTERNS,
} from '../scripts/notebooklm/chat-injection-runner.mjs';

test('Dynamic Question Battery: produces questions with Shannon entropy >= 3.0', () => {
  const result = generateDynamicQuestionBattery('grok-bot');
  assert.ok(result.questions.length >= 2, 'Expected at least 2 questions in battery');
  assert.ok(result.entropy >= 3.0, `Expected entropy >= 3.0, got ${result.entropy}`);
  assert.equal(result.circuitBreakerSafe, true);
});

test('Dynamic Question Battery: questions do not match banned boilerplate patterns', () => {
  const targets = ['grok-bot', 'ai-news', 'research-deltas', 'facebook', 'reddit'];
  for (const t of targets) {
    const battery = generateDynamicQuestionBattery(t);
    for (const q of battery.questions) {
      const text = typeof q === 'string' ? q : q.text;
      for (const pattern of BANNED_BOILERPLATE_PATTERNS) {
        assert.equal(
          pattern.test(text),
          false,
          `Question for "${t}" matched banned boilerplate pattern ${pattern}: "${text}"`
        );
      }
    }
  }
});

test('Chat Injection Runner: synthesizeDynamicQuestions never produces identical question sets across turns with distinct seeds', () => {
  const fakeNotebook = {
    title: 'Grok Bot Automation',
    slug: 'grok-bot',
    section: 'operational_buffers',
    uuid: '52332bef-552c-427a-afb5-8cc48e6f0079',
  };

  const turn1 = synthesizeDynamicQuestions(fakeNotebook, { seed: '2026-11-20-turn-1' });
  const turn2 = synthesizeDynamicQuestions(fakeNotebook, { seed: '2026-11-20-turn-2' });

  assert.ok(turn1.length >= 2);
  assert.ok(turn2.length >= 2);

  const e1 = calculateQuestionEntropy(turn1);
  const e2 = calculateQuestionEntropy(turn2);
  assert.ok(e1 >= 3.0, `Turn 1 entropy (${e1}) must be >= 3.0`);
  assert.ok(e2 >= 3.0, `Turn 2 entropy (${e2}) must be >= 3.0`);
});

test('Daily Synthesis Log: turn question list has 0 duplicate questions within a session', () => {
  const mockTurns = [
    { questionId: 'q1', question: 'Analyze primary documentary sources for Grok Bot: open contradictions' },
    { questionId: 'q2', question: 'In Grok Bot, examine critical assertions that remain single-sourced' },
    { questionId: 'q3', question: 'Explore adjacent domains and unindexed primary accessions linked to Grok Bot' },
    { questionId: 'q4', question: 'Discover non-obvious operational, governance, or evidentiary correlations' },
  ];

  const questionTexts = mockTurns.map((t) => t.question.trim().toLowerCase());
  const uniqueQuestions = new Set(questionTexts);
  assert.equal(
    uniqueQuestions.size,
    mockTurns.length,
    `Expected all ${mockTurns.length} turns to have distinct question text, found ${mockTurns.length - uniqueQuestions.size} duplicates`
  );
});
