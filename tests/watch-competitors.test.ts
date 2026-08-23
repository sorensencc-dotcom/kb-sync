import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {
  validateWatchlist,
  validateTargetUrl,
  canonicalizeJson,
  generateSigilKeyPair,
  signSigilEnvelope,
  verifySigilEnvelope,
  performStructuredDiff,
  fetchTargetContent,
  STATIC_MOCK_TARGETS,
  dispatchSigilEnvelope,
  monitorCompetitorWatchlist
} from '../watch-competitors-v2.mjs';

describe('Kimi K3 Competitor Watchlist & Sigil Envelope Suite', () => {
  const testTmpDir = path.resolve('./.test_competitor_watch');
  const testQueuePath = path.join(testTmpDir, 'test-queue.jsonl');
  const testWatchlistPath = path.join(testTmpDir, 'test-watchlist.json');
  const testWikiFile = path.join(testTmpDir, 'wiki-baseline.md');

  beforeEach(() => {
    fs.mkdirSync(testTmpDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testTmpDir)) {
      fs.rmSync(testTmpDir, { recursive: true, force: true });
    }
  });

  describe('1. SSRF & Network Security Policy', () => {
    it('allows valid external HTTPS URLs', () => {
      expect(validateTargetUrl('https://github.com/google/sam')).toBe(true);
      expect(validateTargetUrl('https://api.github.com/repos/volcengine/OpenViking')).toBe(true);
    });

    it('rejects forbidden schemes (file, ftp, javascript, http by default)', () => {
      expect(() => validateTargetUrl('file:///etc/passwd')).toThrow(/SSRF_REJECTED/);
      expect(() => validateTargetUrl('http://insecure.example.com')).toThrow(/SSRF_REJECTED/);
      expect(() => validateTargetUrl('ftp://ftp.example.com')).toThrow(/SSRF_REJECTED/);
    });

    it('rejects loopback and private IPv4 ranges', () => {
      expect(() => validateTargetUrl('https://127.0.0.1/admin')).toThrow(/SSRF_REJECTED/);
      expect(() => validateTargetUrl('https://10.0.0.5/api')).toThrow(/SSRF_REJECTED/);
      expect(() => validateTargetUrl('https://192.168.1.1/router')).toThrow(/SSRF_REJECTED/);
      expect(() => validateTargetUrl('https://172.16.0.1/private')).toThrow(/SSRF_REJECTED/);
      expect(() => validateTargetUrl('https://169.254.169.254/latest/meta-data')).toThrow(/SSRF_REJECTED/);
    });

    it('rejects loopback and private IPv6 ranges', () => {
      expect(() => validateTargetUrl('https://[::1]/status')).toThrow(/SSRF_REJECTED/);
    });

    it('rejects forbidden local / internal hostnames', () => {
      expect(() => validateTargetUrl('https://localhost:8080')).toThrow(/SSRF_REJECTED/);
      expect(() => validateTargetUrl('https://server.internal/metrics')).toThrow(/SSRF_REJECTED/);
      expect(() => validateTargetUrl('https://device.local/status')).toThrow(/SSRF_REJECTED/);
    });
  });

  describe('2. Schema Boundary & Constraint Validation', () => {
    it('validates a compliant watchlist structure', () => {
      const valid = {
        watchlist_id: "trm:watchlist:google-sam",
        competitor_name: "Google Sovereign Agent Mesh",
        last_monitored_at: "2026-08-23T12:00:00Z",
        targets: [
          {
            target_id: "sam-repo-p2p",
            url: "https://github.com/google/sam",
            type: "git_repo",
            hash_baseline: "a".repeat(64)
          }
        ],
        memory_alignment: {
          layer2_wiki_path: "research/google-sam-mesh.md",
          status: "stable",
          delta_rules: {
            trigger_comparison: true,
            diff_sensitivity: "high"
          }
        },
        human_in_the_loop: {
          step_up_required: true,
          assurance_level_gate: "high"
        }
      };
      expect(validateWatchlist(valid)).toBe(true);
    });

    it('enforces the 30-target boundary cap', () => {
      const targets = Array.from({ length: 31 }, (_, i) => ({
        target_id: `target-${i}`,
        url: `https://example.com/target-${i}`,
        type: "rest_api",
        hash_baseline: "b".repeat(64)
      }));

      const oversized = {
        watchlist_id: "trm:watchlist:oversized",
        competitor_name: "Oversized Entity",
        last_monitored_at: "2026-08-23T12:00:00Z",
        targets,
        memory_alignment: {
          layer2_wiki_path: "research/oversized.md",
          status: "stable",
          delta_rules: { trigger_comparison: true, diff_sensitivity: "medium" }
        }
      };

      expect(() => validateWatchlist(oversized)).toThrow(/WATCHLIST_LIMIT_EXCEEDED/);
    });

    it('rejects invalid hash_baseline format or missing fields', () => {
      const invalidHash = {
        watchlist_id: "trm:watchlist:test",
        competitor_name: "Test",
        targets: [
          {
            target_id: "test-target",
            url: "https://example.com/api",
            type: "rest_api",
            hash_baseline: "invalid_hash_123"
          }
        ],
        memory_alignment: {
          layer2_wiki_path: "research/test.md",
          status: "stable",
          delta_rules: { trigger_comparison: true }
        }
      };
      expect(() => validateWatchlist(invalidHash)).toThrow(/invalid SHA-256 hash_baseline/);
    });
  });

  describe('3. Deterministic Hashing & Zero-Drift Guarantee', () => {
    it('guarantees identical SHA-256 hash across repeated mock calls', async () => {
      const target = {
        target_id: "sam-repo-p2p",
        url: "https://github.com/google/sam",
        type: "git_repo"
      };

      const payload1 = await fetchTargetContent(target, { forceMock: true });
      const payload2 = await fetchTargetContent(target, { forceMock: true });

      expect(payload1).toBe(payload2);
      const hash1 = crypto.createHash('sha256').update(payload1).digest('hex');
      const hash2 = crypto.createHash('sha256').update(payload2).digest('hex');
      expect(hash1).toBe(hash2);
    });
  });

  describe('4. RFC 8785 JCS & Ed25519 Sigil Envelope Verification', () => {
    it('canonicalizes JSON deterministically with sorted keys', () => {
      const objA = { z: 1, a: 2, m: { b: 3, a: 4 } };
      const objB = { a: 2, m: { a: 4, b: 3 }, z: 1 };
      expect(canonicalizeJson(objA)).toBe(canonicalizeJson(objB));
      expect(canonicalizeJson(objA)).toBe('{"a":2,"m":{"a":4,"b":3},"z":1}');
    });

    it('generates, signs, and cryptographically verifies a Sigil v1 envelope', () => {
      const keyPair = generateSigilKeyPair();
      const unsignedEnvelope = {
        protocol: "sigil/1",
        message_id: "msg_01TEST",
        conversation_id: "conv_trm_test",
        message_type: "task.request",
        sender: { owner_id: "usr_system", endpoint_id: "ep_watcher", kind: "agent" },
        recipient: { owner_id: "usr_operator", endpoint_id: "ep_relay" },
        body: { instruction: "Test instruction", task_id: "task_01" },
        context_refs: [],
        capabilities: ["sigil.core/read_shared_context"],
        approval: { required: true, status: "pending" },
        correlation_id: "corr_01",
        idempotency_key: "idem_01",
        created_at: "2026-08-23T12:00:00Z",
        expires_at: "2026-08-24T12:00:00Z"
      };

      const signed = signSigilEnvelope(unsignedEnvelope, keyPair.privateKeyPem, keyPair.keyId);
      expect(signed.signature.algorithm).toBe("Ed25519");
      expect(signed.signature.key_id).toBe(keyPair.keyId);
      expect(signed.signature.value.startsWith("base64url:")).toBe(true);

      const isValid = verifySigilEnvelope(signed, keyPair.publicKeyPem);
      expect(isValid).toBe(true);

      // Tamper detection
      const tampered = JSON.parse(JSON.stringify(signed));
      tampered.body.instruction = "Tampered instruction";
      expect(verifySigilEnvelope(tampered, keyPair.publicKeyPem)).toBe(false);
    });
  });

  describe('5. Structured Semantic Diffing', () => {
    it('reports new file creation with correct line counts', () => {
      const result = performStructuredDiff(path.join(testTmpDir, 'non-existent.md'), "Line 1\nLine 2\nLine 3");
      expect(result.change_type).toBe("new");
      expect(result.added_lines).toBe(3);
      expect(result.deleted_lines).toBe(0);
      expect(result.similarity_ratio).toBe(0.0);
    });

    it('reports modified diff with hunk preview and similarity ratio', () => {
      fs.writeFileSync(testWikiFile, "Line 1\nLine 2\nLine 3\nLine 4", 'utf8');
      const result = performStructuredDiff(testWikiFile, "Line 1\nLine 2 Changed\nLine 3\nLine 5 Added");

      expect(result.change_type).toBe("modified");
      expect(result.added_lines).toBe(2);
      expect(result.deleted_lines).toBe(2);
      expect(result.similarity_ratio).toBe(0.5);
      expect(result.patch_preview).toContain("BASELINE:");
    });

    it('reports unchanged content with 1.0 similarity', () => {
      fs.writeFileSync(testWikiFile, "Line A\nLine B", 'utf8');
      const result = performStructuredDiff(testWikiFile, "Line A\nLine B");
      expect(result.change_type).toBe("unchanged");
      expect(result.similarity_ratio).toBe(1.0);
    });
  });

  describe('6. Concurrency-Safe Queue Dispatching & Dry Run', () => {
    it('appends signed envelopes atomically to JSONL queue', () => {
      const keyPair = generateSigilKeyPair();
      const env1 = signSigilEnvelope({
        protocol: "sigil/1",
        message_id: "msg_1",
        conversation_id: "conv_1",
        message_type: "task.request",
        sender: { owner_id: "usr_1", endpoint_id: "ep_1", kind: "agent" },
        recipient: { owner_id: "usr_2", endpoint_id: "ep_2" },
        body: { task_id: "1" },
        context_refs: [],
        capabilities: [],
        approval: { required: false, status: "none" },
        correlation_id: "c1",
        idempotency_key: "i1",
        created_at: "2026-08-23T12:00:00Z",
        expires_at: "2026-08-24T12:00:00Z"
      }, keyPair.privateKeyPem, keyPair.keyId);

      dispatchSigilEnvelope(null, env1, testQueuePath);
      dispatchSigilEnvelope(null, env1, testQueuePath);

      const lines = fs.readFileSync(testQueuePath, 'utf8').trim().split('\n');
      expect(lines.length).toBe(2);
      const parsed = JSON.parse(lines[0]);
      expect(parsed.message_id).toBe("msg_1");
    });

    it('runs end-to-end drift monitor and produces zero mutations in dry-run mode', async () => {
      const staticSamContent = STATIC_MOCK_TARGETS['google/sam'];
      const realHash = crypto.createHash('sha256').update(staticSamContent).digest('hex');

      // Set baseline to mismatch to trigger drift
      const mockWatchlist = {
        watchlist_id: "trm:watchlist:google-sam",
        competitor_name: "Google Sovereign Agent Mesh",
        last_monitored_at: "2026-08-01T00:00:00Z",
        targets: [
          {
            target_id: "sam-repo-p2p",
            url: "https://github.com/google/sam",
            type: "git_repo",
            hash_baseline: "0".repeat(64) // Drift intended
          }
        ],
        memory_alignment: {
          layer2_wiki_path: "wiki-baseline.md",
          status: "stable",
          delta_rules: { trigger_comparison: true, diff_sensitivity: "high" }
        },
        human_in_the_loop: {
          step_up_required: true,
          assurance_level_gate: "high"
        }
      };

      fs.writeFileSync(testWatchlistPath, JSON.stringify(mockWatchlist, null, 2), 'utf8');

      const result = await monitorCompetitorWatchlist(testWatchlistPath, {
        dryRun: true,
        forceMock: true,
        wikiRoot: testTmpDir,
        queuePath: testQueuePath
      });

      expect(result.driftsDetected).toBe(1);
      expect(result.queuedEnvelopes.length).toBe(1);

      // Verify envelope integrity
      const envelope = result.queuedEnvelopes[0];
      expect(verifySigilEnvelope(envelope, result.keyPair.publicKeyPem)).toBe(true);

      // Verify dry-run did not write queue file
      expect(fs.existsSync(testQueuePath)).toBe(false);

      // Verify dry-run did not mutate the watchlist on disk
      const diskContent = JSON.parse(fs.readFileSync(testWatchlistPath, 'utf8'));
      expect(diskContent.targets[0].hash_baseline).toBe("0".repeat(64));
    });

    it('verifies 0 LLM token spend cache hit path when hashes match', async () => {
      const staticSamContent = STATIC_MOCK_TARGETS['google/sam'];
      const matchingHash = crypto.createHash('sha256').update(staticSamContent).digest('hex');

      const stableWatchlist = {
        watchlist_id: "trm:watchlist:google-sam",
        competitor_name: "Google Sovereign Agent Mesh",
        last_monitored_at: "2026-08-01T00:00:00Z",
        targets: [
          {
            target_id: "sam-repo-p2p",
            url: "https://github.com/google/sam",
            type: "git_repo",
            hash_baseline: matchingHash // Perfect match
          }
        ],
        memory_alignment: {
          layer2_wiki_path: "wiki-baseline.md",
          status: "stable",
          delta_rules: { trigger_comparison: true, diff_sensitivity: "high" }
        }
      };

      fs.writeFileSync(testWatchlistPath, JSON.stringify(stableWatchlist, null, 2), 'utf8');

      const result = await monitorCompetitorWatchlist(testWatchlistPath, {
        dryRun: false,
        forceMock: true,
        wikiRoot: testTmpDir,
        queuePath: testQueuePath
      });

      expect(result.cacheHits).toBe(1);
      expect(result.driftsDetected).toBe(0);
      expect(result.queuedEnvelopes.length).toBe(0);
    });
  });
});
