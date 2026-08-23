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

    it('fails closed when lock cannot be acquired (simulated stale lock)', () => {
      const staleLockPath = `${testQueuePath}.lock`;
      fs.writeFileSync(staleLockPath, 'locked', 'utf8');
      const keyPair = generateSigilKeyPair();
      const env = signSigilEnvelope({
        protocol: "sigil/1", message_id: "msg_lockfail_test", conversation_id: "conv_lock",
        message_type: "task.request",
        sender: { owner_id: "usr_1", endpoint_id: "ep_lock", kind: "agent" },
        recipient: { owner_id: "usr_2", endpoint_id: "ep_2" },
        body: { task_id: "lock_fail" }, context_refs: [], capabilities: [],
        approval: { required: false, status: "none" },
        created_at: "2026-08-23T12:00:00Z", expires_at: "2026-08-24T12:00:00Z"
      }, keyPair.privateKeyPem, keyPair.keyId);

      expect(() => dispatchSigilEnvelope(null, env, testQueuePath)).toThrow(/QUEUE_LOCK_TIMEOUT/);
      if (fs.existsSync(staleLockPath)) fs.unlinkSync(staleLockPath);
    });
  });

  describe('6a. SQLite Schema Provisioning & Migrations', () => {
    it('bootstraps fresh database with all required tables and auto-provisions system profile', async () => {
      const dbPath = path.join(testTmpDir, 'fresh.db');
      const mockWatchlist = {
        watchlist_id: "trm:watchlist:google-sam", competitor_name: "Google SAM",
        last_monitored_at: "2026-08-01T00:00:00Z",
        targets: [{ target_id: "sam-repo", url: "https://github.com/google/sam", type: "git_repo", hash_baseline: "0".repeat(64) }],
        memory_alignment: { layer2_wiki_path: "wiki-baseline.md", status: "stable", delta_rules: { trigger_comparison: true } },
        human_in_the_loop: { step_up_required: false }
      };
      fs.writeFileSync(testWatchlistPath, JSON.stringify(mockWatchlist, null, 2), 'utf8');

      await monitorCompetitorWatchlist(testWatchlistPath, {
        dbPath, forceMock: true, wikiRoot: testTmpDir, queuePath: testQueuePath
      });

      const { default: BetterSQLite } = await import('better-sqlite3');
      const db = new BetterSQLite(dbPath);
      const version = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as any;
      expect(version.v).toBeGreaterThanOrEqual(3);

      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map(r => r.name);
      expect(tables).toContain('connector_profiles');
      expect(tables).toContain('local_approvals');
      expect(tables).toContain('endpoint_keys');

      const profile = db.prepare("SELECT profile_id FROM connector_profiles WHERE profile_id='prof_trm_system'").get();
      expect(profile).not.toBeNull();

      const key = db.prepare("SELECT key_id, public_key_pem FROM endpoint_keys LIMIT 1").get() as any;
      expect(key).not.toBeNull();
      expect(key.public_key_pem).toMatch(/BEGIN PUBLIC KEY/);
      db.close();
    });

    it('migrates a v0 legacy database (missing envelope_json and endpoint_keys) to current schema', async () => {
      const dbPath = path.join(testTmpDir, 'v0-legacy.db');
      const { default: BetterSQLite } = await import('better-sqlite3');
      const legacyDb = new BetterSQLite(dbPath);
      legacyDb.exec(`CREATE TABLE local_approvals (
        approval_id TEXT PRIMARY KEY, profile_id TEXT NOT NULL,
        action_hash TEXT NOT NULL, capability TEXT NOT NULL,
        scope TEXT NOT NULL, requested_by TEXT NOT NULL, status TEXT
      )`);
      legacyDb.close();

      const mockWatchlist = {
        watchlist_id: "trm:watchlist:google-sam", competitor_name: "Google SAM",
        last_monitored_at: "2026-08-01T00:00:00Z",
        targets: [{ target_id: "sam-repo", url: "https://github.com/google/sam", type: "git_repo", hash_baseline: "0".repeat(64) }],
        memory_alignment: { layer2_wiki_path: "wiki-baseline.md", status: "stable", delta_rules: { trigger_comparison: true } }
      };
      fs.writeFileSync(testWatchlistPath, JSON.stringify(mockWatchlist, null, 2), 'utf8');

      await monitorCompetitorWatchlist(testWatchlistPath, {
        dbPath, forceMock: true, wikiRoot: testTmpDir, queuePath: testQueuePath
      });

      const migratedDb = new BetterSQLite(dbPath);
      const cols = (migratedDb.prepare('PRAGMA table_info(local_approvals)').all() as any[]).map(c => c.name);
      expect(cols).toContain('envelope_json');
      const keyTable = migratedDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='endpoint_keys'").get();
      expect(keyTable).not.toBeNull();
      migratedDb.close();
    });

    it('throws clear prerequisite error on fresh DB when requireExistingProfile is set', async () => {
      const dbPath = path.join(testTmpDir, 'strict-profile.db');
      const mockWatchlist = {
        watchlist_id: "trm:watchlist:google-sam", competitor_name: "Google SAM",
        last_monitored_at: "2026-08-01T00:00:00Z",
        targets: [{ target_id: "sam-repo", url: "https://github.com/google/sam", type: "git_repo", hash_baseline: "0".repeat(64) }],
        memory_alignment: { layer2_wiki_path: "wiki-baseline.md", status: "stable", delta_rules: { trigger_comparison: true } }
      };
      fs.writeFileSync(testWatchlistPath, JSON.stringify(mockWatchlist, null, 2), 'utf8');

      await expect(monitorCompetitorWatchlist(testWatchlistPath, {
        dbPath, forceMock: true, wikiRoot: testTmpDir, requireExistingProfile: true
      })).rejects.toThrow(/DB_PREREQUISITE/);
    });

    it('approval row uses the explicit system profile, not an arbitrary profile from LIMIT 1', async () => {
      const dbPath = path.join(testTmpDir, 'multi-profile.db');
      const { default: BetterSQLite } = await import('better-sqlite3');
      const db = new BetterSQLite(dbPath);
      // Seed schema and two profiles: a decoy first, the real system profile second
      db.exec(`
        CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
        CREATE TABLE connector_profiles (
          profile_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, endpoint_id TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL, relay_url TEXT NOT NULL, status TEXT DEFAULT 'active',
          secure_key_reference TEXT NOT NULL, secure_token_reference TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );
        CREATE TABLE local_approvals (
          approval_id TEXT PRIMARY KEY, profile_id TEXT NOT NULL,
          action_hash TEXT NOT NULL, capability TEXT NOT NULL, scope TEXT NOT NULL,
          requested_by TEXT NOT NULL, status TEXT DEFAULT 'pending',
          decision_signature TEXT, envelope_json TEXT,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), decided_at TEXT
        );
        CREATE TABLE endpoint_keys (
          key_id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, algorithm TEXT NOT NULL DEFAULT 'Ed25519',
          public_key_pem TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), expires_at TEXT
        );
        INSERT INTO schema_version VALUES (3, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
        INSERT INTO connector_profiles VALUES ('prof_decoy_first','usr_other','ep_decoy','Decoy','sigil://relay/decoy','active','key_ref:none','token_ref:none',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
        INSERT INTO connector_profiles VALUES ('prof_trm_system','usr_system','ep_trm_watcher','TRM Watcher','sigil://relay/trm','active','key_ref:none','token_ref:none',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      `);
      db.close();

      const mockWatchlist = {
        watchlist_id: "trm:watchlist:google-sam", competitor_name: "Google SAM",
        last_monitored_at: "2026-08-01T00:00:00Z",
        targets: [{ target_id: "sam-repo", url: "https://github.com/google/sam", type: "git_repo", hash_baseline: "0".repeat(64) }],
        memory_alignment: { layer2_wiki_path: "wiki-baseline.md", status: "stable", delta_rules: { trigger_comparison: true } },
        human_in_the_loop: { step_up_required: true }
      };
      fs.writeFileSync(testWatchlistPath, JSON.stringify(mockWatchlist, null, 2), 'utf8');

      await monitorCompetitorWatchlist(testWatchlistPath, {
        dbPath, forceMock: true, wikiRoot: testTmpDir, queuePath: testQueuePath
      });

      const verifyDb = new BetterSQLite(dbPath);
      const rows = verifyDb.prepare('SELECT profile_id FROM local_approvals').all() as any[];
      verifyDb.close();

      // Every approval row must use the system profile, never the decoy
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.profile_id).toBe('prof_trm_system');
        expect(row.profile_id).not.toBe('prof_decoy_first');
      }
    });

    it('relay key-distribution contract: endpoint_keys holds verifiable public key for every signed envelope', async () => {
      // This test establishes the key-distribution contract: a relay process sharing or reading
      // the same SQLite database can look up the public key by key_id and independently verify
      // any signed envelope. This is the trust anchor — relay and watcher share this DB
      // (or a replica) as the key store. No external key registry is required for the local relay model.
      const dbPath = path.join(testTmpDir, 'relay-keycheck.db');
      const mockWatchlist = {
        watchlist_id: "trm:watchlist:google-sam", competitor_name: "Google SAM",
        last_monitored_at: "2026-08-01T00:00:00Z",
        targets: [{ target_id: "sam-repo", url: "https://github.com/google/sam", type: "git_repo", hash_baseline: "0".repeat(64) }],
        memory_alignment: { layer2_wiki_path: "wiki-baseline.md", status: "stable", delta_rules: { trigger_comparison: true } },
        human_in_the_loop: { step_up_required: true }
      };
      fs.writeFileSync(testWatchlistPath, JSON.stringify(mockWatchlist, null, 2), 'utf8');

      const result = await monitorCompetitorWatchlist(testWatchlistPath, {
        dbPath, forceMock: true, wikiRoot: testTmpDir, queuePath: testQueuePath
      });

      expect(result.queuedEnvelopes.length).toBeGreaterThan(0);

      // Simulate relay: open the same DB, look up the key_id from the queued envelope, verify signature
      const { default: BetterSQLite } = await import('better-sqlite3');
      const relayDb = new BetterSQLite(dbPath, { readonly: true });
      for (const envelope of result.queuedEnvelopes) {
        const keyId = envelope.signature?.key_id;
        expect(keyId).toBeTruthy();

        const keyRow = relayDb.prepare('SELECT public_key_pem FROM endpoint_keys WHERE key_id = ?').get(keyId) as any;
        expect(keyRow).not.toBeNull(); // key must be registered
        expect(keyRow.public_key_pem).toMatch(/BEGIN PUBLIC KEY/);

        // Relay verifies the envelope using the retrieved public key
        const verified = verifySigilEnvelope(envelope, keyRow.public_key_pem);
        expect(verified).toBe(true);
      }
      relayDb.close();
    });
  });

  describe('6. Live Transport & Fail-Closed Guardrails', () => {
    it('successfully completes live HTTPS fetch with pinned DNS to public API', async () => {
      // Integration test against live HTTPS endpoint with pinned DNS
      const zen = await fetchTargetContent({
        target_id: 'github-zen',
        url: 'https://api.github.com/zen',
        type: 'rest_api'
      }, { forceMock: false });

      expect(typeof zen).toBe('string');
      expect(zen.length).toBeGreaterThan(0);
    });

    it('fails closed and throws error on unreachable live target when forceMock is false', async () => {
      await expect(fetchTargetContent({
        target_id: 'unreachable',
        url: 'https://198.51.100.1/nonexistent-endpoint', // TEST-NET-2 unassigned public IP that times out/fails
        type: 'rest_api'
      }, { forceMock: false, timeoutMs: 500 })).rejects.toThrow(/LIVE_FETCH_FAILED/);
    });

    it('creates no SQLite file during dry-run when dbPath is provided', async () => {
      const mockWatchlist = {
        watchlist_id: "trm:watchlist:test",
        competitor_name: "Test",
        last_monitored_at: "2026-08-01T00:00:00Z",
        targets: [
          {
            target_id: "test-target",
            url: "https://github.com/google/sam",
            type: "git_repo",
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
