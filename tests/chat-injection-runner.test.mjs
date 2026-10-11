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
} from '../scripts/notebooklm/chat-injection-runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const BANNED_BOILERPLATE_PATTERNS = [
  /what open questions or unresolved contradictions exist across these sources/i,
  /what claims are asserted but single-sourced or under-corroborated/i,
  /what adjacent topics do these sources point to that aren't covered yet/i,
  /what follow-up research would most strengthen current findings/i,
];

describe('Chat Injection Runner & Cluster Parity Audit Suite', () => {
  describe('loadClusterRegistry()', () => {
    it('loads all 25 notebooks defined in configs/notebooklm.yaml', () => {
      const registry = loadClusterRegistry();
      assert.equal(registry.length, 25);
    });

    it('correctly maps canonical notebooks vs operational buffers', () => {
      const registry = loadClusterRegistry();
      const canonical = registry.filter((n) => n.isCanonical);
      const buffers = registry.filter((n) => !n.isCanonical);

      assert.equal(canonical.length, 22);
      assert.equal(buffers.length, 3);

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
    it('never emits any of the 4 banned boilerplate fallback questions across all 25 notebooks', () => {
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

      assert.equal(audit.length, 25);
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
});
