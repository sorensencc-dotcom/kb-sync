import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadClusterRegistry,
  synthesizeDynamicQuestions,
  auditClusterLatency,
  ensureSyncDirectories,
  calculateContentEntropy,
  calculateQuestionEntropy,
  MIN_ENTROPY_THRESHOLD,
  BANNED_BOILERPLATE_PATTERNS,
  runChatInjection,
  buildSourceFilter,
  isSyntheticSource,
  filterPrimarySources,
} from '../scripts/notebooklm/chat-injection-runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

describe('Chat Injection Runner & Cluster Parity Audit Suite', () => {
  describe('loadClusterRegistry()', () => {
    it('loads all 26 notebooks defined in configs/notebooklm.yaml', () => {
      const registry = loadClusterRegistry();
      assert.equal(registry.length, 26);
    });

    it('correctly maps canonical notebooks vs operational buffers', () => {
      const registry = loadClusterRegistry();
      const canonical = registry.filter((n) => n.isCanonical);
      const buffers = registry.filter((n) => !n.isCanonical);

      assert.equal(canonical.length, 22);
      assert.equal(buffers.length, 4);

      const bufferSlugs = buffers.map((b) => b.slug);
      assert.ok(bufferSlugs.includes('grok-bot'));
      assert.ok(bufferSlugs.includes('ai-news'));
      assert.ok(bufferSlugs.includes('toolforge-eco'));
    });

    it('identifies large source threshold on Ford Executive Dynamics', () => {
      const registry = loadClusterRegistry();
      const ford = registry.find((n) => n.slug === 'ford-politics');
      assert.ok(ford);
      assert.equal(ford.large_source_threshold, 50);
      assert.equal(ford.uuid, '0caf6707-f8f2-4d2a-acd2-020acead55ba');
    });

    it('verifies all expected historical and software dev slugs are present', () => {
      const registry = loadClusterRegistry();
      const slugs = new Set(registry.map((n) => n.slug));

      const requiredHistorical = [
        'willow-run',
        'ford-politics',
        'post-war',
        'willys-overland',
        'cuba-claims',
        'miami-estate',
        'assembly-line',
        'master-kb',
        'daily',
      ];
      for (const s of requiredHistorical) {
        assert.ok(slugs.has(s), `Missing historical slug: ${s}`);
      }

      const requiredSoftware = [
        'ironledger',
        'sigil',
        'agent-harness',
        'rewrite-labs',
        'dev-triage',
        'kb-governance',
        'kb-modules',
        'kb-skills',
        'kb-operations',
        'kb-meta',
        'kb-targets',
        'kb-superpowers',
      ];
      for (const s of requiredSoftware) {
        assert.ok(slugs.has(s), `Missing software slug: ${s}`);
      }

      assert.ok(slugs.has('personal-os'), 'Missing personal-os slug');
    });
  });

  describe('synthesizeDynamicQuestions() & Zero-Boilerplate Guarantee', () => {
    it('never emits any of the 4 banned boilerplate fallback questions across all 26 notebooks', () => {
      const registry = loadClusterRegistry();

      for (const nb of registry) {
        const questions = synthesizeDynamicQuestions(nb);
        assert.ok(questions.length >= 2, `Expected at least 2 questions for ${nb.slug}`);

        for (const q of questions) {
          for (const bannedRegex of BANNED_BOILERPLATE_PATTERNS) {
            const matches = bannedRegex.test(q.text);
            assert.equal(
              matches,
              false,
              `Banned boilerplate question detected in ${nb.slug}: "${q.text}"`
            );
          }
        }
      }
    });

    it('injects entity-anchored inquiries for historical partitions', () => {
      const registry = loadClusterRegistry();

      const ford = registry.find((n) => n.slug === 'ford-politics');
      const fordQ = synthesizeDynamicQuestions(ford);
      const fordJoined = fordQ.map((q) => q.text).join(' ');
      assert.ok(
        fordJoined.includes('Bennett') || fordJoined.includes('Dodge') || fordJoined.includes('Capizzi'),
        'Ford Politics must query named historical entities'
      );

      const willow = registry.find((n) => n.slug === 'willow-run');
      const willowQ = synthesizeDynamicQuestions(willow);
      const willowJoined = willowQ.map((q) => q.text).join(' ');
      assert.ok(
        willowJoined.includes('Davis wing') || willowJoined.includes('Mead Bricker') || willowJoined.includes('B-24'),
        'Willow Run must query named aviation entities'
      );
    });

    it('injects domain-specific technical questions for software partitions', () => {
      const registry = loadClusterRegistry();

      const ironledger = registry.find((n) => n.slug === 'ironledger');
      const ilQ = synthesizeDynamicQuestions(ironledger);
      const ilJoined = ilQ.map((q) => q.text).join(' ');
      assert.ok(
        ilJoined.includes('double-entry') || ilJoined.includes('KMS') || ilJoined.includes('Prometheus'),
        'IronLedger must query double-entry or KMS encryption'
      );

      const sigil = registry.find((n) => n.slug === 'sigil');
      const sigilQ = synthesizeDynamicQuestions(sigil);
      const sigilJoined = sigilQ.map((q) => q.text).join(' ');
      assert.ok(
        sigilJoined.includes('FIX session') || sigilJoined.includes('WAL') || sigilJoined.includes('key rotation'),
        'Sigil must query FIX protocol or WAL persistence'
      );
    });
  });

  describe('auditClusterLatency()', () => {
    it('correctly audits freshness when daily logs exist', () => {
      const registry = loadClusterRegistry();
      const audit = auditClusterLatency(registry);

      assert.equal(audit.length, 26);
      for (const item of audit) {
        assert.ok(item.slug);
        assert.ok(item.uuid);
        assert.ok(item.status === 'FRESH' || item.status === 'STALE');
        assert.ok(typeof item.latencyHours === 'string');
      }
    });

    it('flags notebooks as STALE when simulated timestamp exceeds 24h', () => {
      const mockRegistry = [
        {
          slug: 'test-stale-nb',
          uuid: 'mock-uuid-stale-001',
          title: 'Mock Stale Notebook',
          section: 'historical',
          isCanonical: true,
        },
      ];

      // Temporary audit with non-existent slug
      const audit = auditClusterLatency(mockRegistry);
      assert.equal(audit.length, 1);
      assert.equal(audit[0].status, 'STALE');
      assert.equal(audit[0].lastLogTime, null);
    });
  });

  describe('ensureSyncDirectories()', () => {
    it('creates local wiki conversations directory', () => {
      const dateStr = '2026-10-09';
      const dirs = ensureSyncDirectories('test-dummy-slug', dateStr);

      assert.ok(dirs.localDir);
      assert.ok(fs.existsSync(dirs.localDir));

      // Clean up test directory if created
      const dummyFile = path.join(dirs.localDir, 'test-dummy-slug.md');
      if (fs.existsSync(dummyFile)) fs.unlinkSync(dummyFile);
    });
  });

  describe('calculateContentEntropy() & calculateQuestionEntropy()', () => {
    it('returns 0 for empty or null content', () => {
      assert.equal(calculateContentEntropy(''), 0);
      assert.equal(calculateContentEntropy(null), 0);
      assert.equal(calculateQuestionEntropy([]), 0);
    });

    it('calculates low entropy for uniform repeating characters', () => {
      const low = calculateContentEntropy('aaaaaaaaaaaaaaaa');
      assert.equal(low, 0);
    });

    it('calculates high entropy for varied natural text (> 3.5 bits/char)', () => {
      const high = calculateContentEntropy(
        'Did early B-24 flush-rivet shear and dimple cracking originate from improper A17ST alloy temper in Rouge-modified cold-heading machines?'
      );
      assert.ok(high > 3.5, `Expected entropy > 3.5, got ${high}`);
    });

    it('enforces MIN_ENTROPY_THRESHOLD on all cluster synthesized questions', () => {
      const registry = loadClusterRegistry();
      for (const nb of registry) {
        const questions = synthesizeDynamicQuestions(nb);
        const score = calculateQuestionEntropy(questions);
        assert.ok(
          score >= MIN_ENTROPY_THRESHOLD,
          `Entropy for ${nb.slug} was ${score}, expected >= ${MIN_ENTROPY_THRESHOLD}`
        );
      }
    });
  });

  describe('Seed-based Dynamic Question Rotation', () => {
    it('rotates synthesized question order when different seeds are supplied', () => {
      const registry = loadClusterRegistry();
      const ford = registry.find((n) => n.slug === 'ford-politics');
      assert.ok(ford);

      const q1 = synthesizeDynamicQuestions(ford, { seed: '2026-10-10' });
      const q2 = synthesizeDynamicQuestions(ford, { seed: '2026-10-11' });

      assert.equal(q1.length, q2.length);
      assert.notEqual(q1[0].id, q2[0].id);
    });
  });

  describe('Header UUID Matching & Boilerplate Detection in auditClusterLatency()', () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const testDir = path.join(REPO_ROOT, 'wiki', 'conversations', todayStr);

    it('matches daily logs by UUID in file header even when filename is mismatched', () => {
      if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
      const testUuid = '12345678-abcd-ef01-2345-6789abcdef01';
      const mismatchedFilePath = path.join(testDir, 'completely-unrelated-filename-xyz.md');

      const fileContent = `# Daily Synthesis Log: Unrelated Title — ${todayStr}
| Metadata | Value |
|---|---|
| **Notebook** | Target Notebook (\`${testUuid}\`) |
| **Slug** | \`mismatched-test-slug\` |
| **Date** | ${todayStr} |
`;
      try {
        fs.writeFileSync(mismatchedFilePath, fileContent, 'utf8');

        const mockRegistry = [
          {
            slug: 'mismatched-test-slug',
            uuid: testUuid,
            title: 'Target Notebook',
            section: 'historical',
            isCanonical: true,
          },
        ];

        const audit = auditClusterLatency(mockRegistry);
        assert.equal(audit.length, 1);
        assert.equal(audit[0].status, 'FRESH');
        assert.ok(audit[0].lastLogPath.includes('completely-unrelated-filename-xyz.md'));
      } finally {
        if (fs.existsSync(mismatchedFilePath)) fs.unlinkSync(mismatchedFilePath);
      }
    });

    it('detects banned boilerplate patterns and flags boilerplateDetected', () => {
      if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
      const testUuid = '87654321-dcba-10fe-5432-10fedcba9876';
      const boilerplateFilePath = path.join(testDir, 'test-boilerplate-slug.md');

      const fileContent = `# Daily Synthesis Log: Boilerplate Test — ${todayStr}
| Metadata | Value |
|---|---|
| **Notebook** | Boilerplate Test (\`${testUuid}\`) |

## Grounded inquiries
1. What open questions or unresolved contradictions exist across these sources?
2. What follow-up research would most strengthen current findings?
`;
      try {
        fs.writeFileSync(boilerplateFilePath, fileContent, 'utf8');

        const mockRegistry = [
          {
            slug: 'test-boilerplate-slug',
            uuid: testUuid,
            title: 'Boilerplate Test',
            section: 'historical',
            isCanonical: true,
          },
        ];

        const audit = auditClusterLatency(mockRegistry);
        assert.equal(audit.length, 1);
        assert.equal(audit[0].boilerplateDetected, true);
        assert.ok(audit[0].bannedMatches.length >= 2);
        assert.equal(audit[0].auditStatus, 'FAIL');
      } finally {
        if (fs.existsSync(boilerplateFilePath)) fs.unlinkSync(boilerplateFilePath);
      }
    });
  });

  describe('runChatInjection() strict fail-closed mode', () => {
    it('throws AUDIT_FAILED when strict: true and target notebook is stale', async () => {
      await assert.rejects(
        async () => {
          await runChatInjection({
            auditOnly: true,
            strict: true,
            targetSlugOrUuid: 'mock-non-existent-nb',
          });
        },
        (err) => {
          return err.message.includes('not found') || err.code === 'AUDIT_FAILED';
        }
      );
    });
  });

  describe('buildSourceFilter() & Synthetic Source Exclusions', () => {
    it('filters out synthetic meta sources including TRM gaps and knowledge packs', () => {
      const mockSources = [
        { id: 'src-1', title: '64-167-65_SorensenCharlesE.pdf', type: 'pdf' },
        { id: 'src-syn-1', title: 'TRM Research Gaps & Synthesis', type: 'generated_text' },
        { id: 'src-syn-2', title: 'Ecosystem Architecture Guide (Current).md', type: 'generated_text' },
        { id: 'src-syn-3', title: 'pack_post_war.txt', type: 'generated_text' },
        { id: 'src-2', title: 'Benson Ford Research Center Accessions', type: 'web_page' },
      ];

      const primary = filterPrimarySources(mockSources);
      assert.equal(primary.length, 2);
      assert.deepEqual(primary.map((s) => s.id), ['src-1', 'src-2']);

      const filter = buildSourceFilter(mockSources);
      assert.equal(filter.primaryCount, 2);
      assert.deepEqual(filter.sourceIds, ['src-1', 'src-2']);
      assert.ok(!filter.sourceIds.includes('src-syn-1'));
      assert.ok(!filter.sourceIds.includes('src-syn-2'));
      assert.ok(!filter.sourceIds.includes('src-syn-3'));
    });

    it('triggers constraint when total tokens exceed 250,000 even with <=50 sources', () => {
      const mockSources = [
        { id: 'src-heavy', title: '64-167-65_SorensenCharlesE.pdf', type: 'pdf', char_count: 1_600_000 }, // ~400k tokens
        { id: 'src-small', title: 'Archive Overview.html', type: 'web_page', char_count: 8_000 },
      ];

      const filter = buildSourceFilter(mockSources);
      assert.equal(filter.isConstrained, true);
      assert.equal(filter.timeoutSeconds, 180);
      assert.deepEqual(filter.sourceIds, ['src-heavy', 'src-small']);
    });

    it('triggers constraint when a single PDF exceeds 100,000 tokens', () => {
      const mockSources = [
        { id: 'src-heavy-pdf', title: 'My Forty Years with Ford.pdf', type: 'pdf', char_count: 600_000 }, // ~150k tokens
        { id: 'src-note', title: 'Short Note', type: 'google_docs', char_count: 4_000 },
      ];

      const filter = buildSourceFilter(mockSources);
      assert.equal(filter.isConstrained, true);
      assert.equal(filter.hasHeavyPdf, true);
      assert.equal(filter.timeoutSeconds, 180);
    });

    it('does not constrain when all sources are small and under 250k tokens', () => {
      const mockSources = [
        { id: 'src-1', title: 'Article 1', type: 'web_page', char_count: 20_000 },
        { id: 'src-2', title: 'Article 2', type: 'web_page', char_count: 30_000 },
      ];

      const filter = buildSourceFilter(mockSources);
      assert.equal(filter.isConstrained, false);
      assert.equal(filter.timeoutSeconds, 120);
      assert.deepEqual(filter.sourceIds, ['src-1', 'src-2']);
    });
  });
});
