import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {
  validateWatchlist,
  validateTargetUrl,
  resolveSafeWikiPath,
  canonicalizeJson,
  generateSigilKeyPair,
  signSigilEnvelope,
  verifySigilEnvelope,
  performStructuredDiff,
  fetchTargetContent,
  STATIC_MOCK_TARGETS,
  dispatchSigilEnvelope,
  dispatchSigilTask,
  monitorCompetitorWatchlist
} from '../watch-competitors-v2.mjs';

describe('Production Hardened TRM Watchlist & Sigil Protocol Suite', () => {
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

    it('rejects loopback, private, and IPv4-mapped IPv6 ranges', () => {
      expect(() => validateTargetUrl('https://[::1]/status')).toThrow(/SSRF_REJECTED/);
      expect(() => validateTargetUrl('https://[::ffff:127.0.0.1]/status')).toThrow(/SSRF_REJECTED/);
      expect(() => validateTargetUrl('https://[::ffff:10.0.0.1]/status')).toThrow(/SSRF_REJECTED/);
      expect(() => validateTargetUrl('https://[::ffff:169.254.169.254]/latest/meta-data')).toThrow(/SSRF_REJECTED/);
      expect(() => validateTargetUrl('https://[fc00::1]/private')).toThrow(/SSRF_REJECTED/);
      expect(() => validateTargetUrl('https://[fe80::1]/link-local')).toThrow(/SSRF_REJECTED/);
    });

    it('rejects .test domains unless explicitly allowed via options', () => {
      expect(() => validateTargetUrl('https://example.test/source')).toThrow(/SSRF_REJECTED/);
      expect(validateTargetUrl('https://example.test/source', { allowTestTld: true })).toBe(true);
    });

    it('rejects userinfo credentials in URLs', () => {
      expect(() => validateTargetUrl('https://user:pass@github.com/google/sam')).toThrow(/SSRF_REJECTED/);
    });
  });

  describe('2. Path Traversal & Security Boundary Validation', () => {
    it('allows valid relative paths within wiki root', () => {
      const safe = resolveSafeWikiPath(testTmpDir, 'research/target.md');
      expect(safe).toBe(path.resolve(testTmpDir, 'research/target.md'));
    });

    it('rejects absolute paths and directory traversal attempts', () => {
      expect(() => resolveSafeWikiPath(testTmpDir, '/etc/shadow')).toThrow(/PATH_TRAVERSAL_DETECTED/);
      expect(() => resolveSafeWikiPath(testTmpDir, '../../secret.key')).toThrow(/PATH_TRAVERSAL_DETECTED/);
      expect(() => resolveSafeWikiPath(testTmpDir, 'research/../../outside.txt')).toThrow(/PATH_TRAVERSAL_DETECTED/);
    });
  });

  describe('3. RFC 8785 JSON Canonicalization Scheme (JCS) Conformance', () => {
    it('sorts keys lexicographically by UTF-16 code units', () => {
      const objA = { z: 1, a: 2, m: { b: 3, a: 4 } };
      const objB = { a: 2, m: { a: 4, b: 3 }, z: 1 };
      expect(canonicalizeJson(objA)).toBe('{"a":2,"m":{"a":4,"b":3},"z":1}');
      expect(canonicalizeJson(objA)).toBe(canonicalizeJson(objB));
    });

    it('omits undefined properties in objects and serializes nulls in arrays', () => {
      const input = { a: undefined, b: 1, c: [undefined, 2, null] };
      expect(canonicalizeJson(input)).toBe('{"b":1,"c":[null,2,null]}');
    });

    it('normalizes negative zero to 0 and rejects non-finite numbers', () => {
      expect(canonicalizeJson({ zero: -0 })).toBe('{"zero":0}');
      expect(() => canonicalizeJson({ invalid: NaN })).toThrow(/JCS_ERROR/);
      expect(() => canonicalizeJson({ invalid: Infinity })).toThrow(/JCS_ERROR/);
    });
  });

  describe('4. Ed25519 Sigil Envelope Verification & Governance Invariants', () => {
    it('signs and verifies valid envelope with Ed25519', () => {
      const keyPair = generateSigilKeyPair();
      const unsigned = {
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

      const signed = signSigilEnvelope(unsigned, keyPair.privateKeyPem, keyPair.keyId);
      expect(signed.signature.algorithm).toBe("Ed25519");
      expect(signed.signature.value.startsWith("base64url:")).toBe(true);

      expect(verifySigilEnvelope(signed, keyPair.publicKeyPem)).toBe(true);

      // Tampered payload fails verification
      const tampered = JSON.parse(JSON.stringify(signed));
      tampered.body.instruction = "Malicious mutation";
      expect(verifySigilEnvelope(tampered, keyPair.publicKeyPem)).toBe(false);
    });

    it('enforces that automated watcher envelopes strictly require pending human step-up', async () => {
      const mockWatchlist = {
        watchlist_id: "trm:watchlist:google-sam",
        competitor_name: "Google Sovereign Agent Mesh",
        last_monitored_at: "2026-08-01T00:00:00Z",
        targets: [
          {
            target_id: "sam-repo-p2p",
            url: "https://github.com/google/sam",
            type: "git_repo",
            hash_baseline: "0".repeat(64)
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
        forceMock: true,
        wikiRoot: testTmpDir,
        queuePath: testQueuePath
      });

      expect(result.queuedEnvelopes.length).toBe(1);
      const envelope = result.queuedEnvelopes[0];
      // Governance invariant: must be pending, never self-approved
      expect(envelope.approval.status).toBe("pending");
      expect(envelope.approval.required).toBe(true);
    });
  });

  describe('5. Queue Idempotency & Concurrency Safety', () => {
    it('deduplicates identical envelopes in the JSONL queue', () => {
      const keyPair = generateSigilKeyPair();
      const env = signSigilEnvelope({
        protocol: "sigil/1",
        message_id: "msg_idempotency_test",
        conversation_id: "conv_1",
        message_type: "task.request",
        sender: { owner_id: "usr_1", endpoint_id: "ep_1", kind: "agent" },
        recipient: { owner_id: "usr_2", endpoint_id: "ep_2" },
        body: { task_id: "1" },
        context_refs: [],
        capabilities: [],
        approval: { required: false, status: "none" },
        idempotency_key: "idem_unique_123",
        created_at: "2026-08-23T12:00:00Z",
        expires_at: "2026-08-24T12:00:00Z"
      }, keyPair.privateKeyPem, keyPair.keyId);

      const firstAdd = dispatchSigilEnvelope(null, env, testQueuePath);
      const secondAdd = dispatchSigilEnvelope(null, env, testQueuePath);

      expect(firstAdd).toBe(true);
      expect(secondAdd).toBe(false); // Deduplicated

      const lines = fs.readFileSync(testQueuePath, 'utf8').trim().split('\n');
      expect(lines.length).toBe(1);
    });
  });

  describe('6. Zero-Drift & State Preservation', () => {
    it('creates no SQLite file during dry-run when dbPath is provided', async () => {
      const mockWatchlist = {
        watchlist_id: "trm:watchlist:test",
        competitor_name: "Test",
        last_monitored_at: "2026-08-01T00:00:00Z",
        targets: [
          {
            target_id: "test-target",
            url: "https://example.com/api",
            type: "rest_api",
            hash_baseline: "0".repeat(64)
          }
        ],
        memory_alignment: {
          layer2_wiki_path: "wiki-baseline.md",
          status: "stable",
          delta_rules: { trigger_comparison: true, diff_sensitivity: "high" }
        }
      };
      fs.writeFileSync(testWatchlistPath, JSON.stringify(mockWatchlist, null, 2), 'utf8');
      const testDbPath = path.join(testTmpDir, 'dryrun-test.db');
      await monitorCompetitorWatchlist(testWatchlistPath, {
        dryRun: true,
        dbPath: testDbPath,
        forceMock: true,
        wikiRoot: testTmpDir
      });

      expect(fs.existsSync(testDbPath)).toBe(false);
    });
  });
});
