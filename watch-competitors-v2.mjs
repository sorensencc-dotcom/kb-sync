import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { isIP } from 'node:net';

// Optional SQLite driver loading
let Database = null;
try {
  const sqliteModule = await import('better-sqlite3');
  Database = sqliteModule.default || sqliteModule;
} catch {
  // SQLite driver absent; will use durable JSONL queue
}

const COLOR_GREEN = '\x1b[32m';
const COLOR_YELLOW = '\x1b[33m';
const COLOR_RED = '\x1b[31m';
const COLOR_RESET = '\x1b[0m';
const TAG = '[K3-COMPETITOR-WATCH]';

function logInfo(msg) {
  console.log(`${COLOR_GREEN}${TAG} [INFO]${COLOR_RESET} ${msg}`);
}

function logWarn(msg) {
  console.log(`${COLOR_YELLOW}${TAG} [WARN]${COLOR_RESET} ${msg}`);
}

function logError(msg) {
  console.error(`${COLOR_RED}${TAG} [ERROR]${COLOR_RESET} ${msg}`);
}

/**
 * Validates a URL against strict SSRF and network security rules.
 * @param {string} urlString 
 * @param {object} [options]
 */
export function validateTargetUrl(urlString, options = {}) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error(`INVALID_URL: Malformed URL "${urlString}".`);
  }

  const allowInsecure = options.allowInsecureHttp ?? false;
  if (parsed.protocol !== 'https:' && (!allowInsecure || parsed.protocol !== 'http:')) {
    throw new Error(`SSRF_REJECTED: Protocol "${parsed.protocol}" is forbidden. Strict https required.`);
  }

  if (parsed.username || parsed.password) {
    throw new Error(`SSRF_REJECTED: Userinfo credentials are forbidden in target URL.`);
  }

  const rawHost = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();

  // Forbidden local / internal hostnames
  const forbiddenHosts = ['localhost', 'loopback', 'metadata.google.internal', 'instance-data'];
  if (forbiddenHosts.includes(rawHost) || rawHost.endsWith('.local') || rawHost.endsWith('.internal')) {
    throw new Error(`SSRF_REJECTED: Hostname "${rawHost}" points to private or loopback infrastructure.`);
  }

  // IP address checks
  const ipType = isIP(rawHost);
  if (ipType === 4) {
    const parts = rawHost.split('.').map(Number);
    // 127.0.0.0/8 (Loopback)
    if (parts[0] === 127) throw new Error(`SSRF_REJECTED: IPv4 loopback ${rawHost} is blocked.`);
    // 0.0.0.0/8
    if (parts[0] === 0) throw new Error(`SSRF_REJECTED: IPv4 0.0.0.0 range ${rawHost} is blocked.`);
    // 10.0.0.0/8 (Private)
    if (parts[0] === 10) throw new Error(`SSRF_REJECTED: RFC1918 private IPv4 ${rawHost} is blocked.`);
    // 172.16.0.0/12 (Private)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
      throw new Error(`SSRF_REJECTED: RFC1918 private IPv4 ${rawHost} is blocked.`);
    }
    // 192.168.0.0/16 (Private)
    if (parts[0] === 192 && parts[1] === 168) {
      throw new Error(`SSRF_REJECTED: RFC1918 private IPv4 ${rawHost} is blocked.`);
    }
    // 169.254.0.0/16 (Link-local / Cloud metadata)
    if (parts[0] === 169 && parts[1] === 254) {
      throw new Error(`SSRF_REJECTED: Link-local metadata IPv4 ${rawHost} is blocked.`);
    }
  } else if (ipType === 6) {
    // IPv6 loopback and unique local / link-local
    if (rawHost === '::1' || rawHost === '::' || rawHost.startsWith('fe80:') || rawHost.startsWith('fc00:') || rawHost.startsWith('fd00:')) {
      throw new Error(`SSRF_REJECTED: Private/Loopback IPv6 ${rawHost} is blocked.`);
    }
  }

  return true;
}

/**
 * Validates watchlist configuration against TRMCompetitorWatchlistSchema.
 * @param {object} data 
 * @param {object} [options]
 */
export function validateWatchlist(data, options = {}) {
  if (!data.watchlist_id || !/^trm:watchlist:[a-z0-9-]+$/.test(data.watchlist_id)) {
    throw new Error('INVALID_WATCHLIST: watchlist_id is missing or malformed (must match ^trm:watchlist:[a-z0-9-]+$).');
  }
  if (!data.competitor_name || typeof data.competitor_name !== 'string' || data.competitor_name.length > 100) {
    throw new Error('INVALID_WATCHLIST: competitor_name must be a string up to 100 chars.');
  }
  if (!Array.isArray(data.targets) || data.targets.length === 0) {
    throw new Error('INVALID_WATCHLIST: targets array must contain at least 1 item.');
  }
  if (data.targets.length > 30) {
    throw new Error(`WATCHLIST_LIMIT_EXCEEDED: targets array exceeds 30-item boundary (count: ${data.targets.length}).`);
  }

  const validTypes = ['rest_api', 'git_repo', 'rss_feed', 'documentation_page', 'web_scrape'];
  for (const target of data.targets) {
    if (!target.target_id || !/^[a-z0-9-]+$/.test(target.target_id)) {
      throw new Error(`INVALID_TARGET: target_id '${target.target_id}' is malformed.`);
    }
    if (!target.url || typeof target.url !== 'string') {
      throw new Error(`INVALID_TARGET: target_id '${target.target_id}' is missing a valid URL.`);
    }
    validateTargetUrl(target.url, options);

    if (!validTypes.includes(target.type)) {
      throw new Error(`INVALID_TARGET: target_id '${target.target_id}' has invalid type: ${target.type}`);
    }
    if (!target.hash_baseline || !/^[a-f0-9]{64}$/.test(target.hash_baseline)) {
      throw new Error(`INVALID_TARGET: target_id '${target.target_id}' has invalid SHA-256 hash_baseline.`);
    }
  }

  const alignment = data.memory_alignment;
  if (!alignment || !alignment.layer2_wiki_path || typeof alignment.layer2_wiki_path !== 'string') {
    throw new Error('INVALID_WATCHLIST: memory_alignment.layer2_wiki_path is required.');
  }
  const validStatuses = ['stable', 'drift_detected', 'under_review', 'stale'];
  if (!validStatuses.includes(alignment.status)) {
    throw new Error(`INVALID_WATCHLIST: status has invalid value: ${alignment.status}`);
  }
  if (!alignment.delta_rules || typeof alignment.delta_rules.trigger_comparison !== 'boolean') {
    throw new Error('INVALID_WATCHLIST: delta_rules.trigger_comparison is required.');
  }

  return true;
}

/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) serializer.
 * Produces deterministic, sorted UTF-8 byte representation for cryptographic signing.
 * @param {any} val 
 * @returns {string} Canonical JSON string
 */
export function canonicalizeJson(val) {
  if (val === null || typeof val !== 'object') {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return '[' + val.map(canonicalizeJson).join(',') + ']';
  }
  const keys = Object.keys(val).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalizeJson(val[k])).join(',') + '}';
}

/**
 * Generates an Ed25519 keypair for Sigil envelope signing.
 * @returns {{ publicKeyPem: string, privateKeyPem: string, keyId: string }}
 */
export function generateSigilKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  const keyId = `key_${crypto.randomBytes(8).toString('hex')}`;
  return { publicKeyPem: publicKey, privateKeyPem: privateKey, keyId };
}

/**
 * Signs a canonical Sigil v1.0.0 envelope using Ed25519 and RFC 8785 JCS.
 * @param {object} unsignedEnvelope 
 * @param {string} privateKeyPem 
 * @param {string} keyId 
 * @returns {object} Signed Sigil envelope
 */
export function signSigilEnvelope(unsignedEnvelope, privateKeyPem, keyId) {
  const envelope = JSON.parse(JSON.stringify(unsignedEnvelope));
  delete envelope.signature;

  const canonicalBytes = Buffer.from(canonicalizeJson(envelope), 'utf8');
  const signatureBytes = crypto.sign(null, canonicalBytes, privateKeyPem);

  envelope.signature = {
    algorithm: "Ed25519",
    key_id: keyId,
    value: `base64url:${signatureBytes.toString('base64url')}`
  };

  return envelope;
}

/**
 * Verifies a signed Sigil v1.0.0 envelope.
 * @param {object} signedEnvelope 
 * @param {string} publicKeyPem 
 * @returns {boolean}
 */
export function verifySigilEnvelope(signedEnvelope, publicKeyPem) {
  if (!signedEnvelope?.signature?.value?.startsWith('base64url:')) {
    return false;
  }
  const rawSig = signedEnvelope.signature.value.replace(/^base64url:/, '');
  const sigBuffer = Buffer.from(rawSig, 'base64url');

  const envelopeCopy = JSON.parse(JSON.stringify(signedEnvelope));
  delete envelopeCopy.signature;

  const canonicalBytes = Buffer.from(canonicalizeJson(envelopeCopy), 'utf8');
  return crypto.verify(null, canonicalBytes, publicKeyPem, sigBuffer);
}

/**
 * Deterministic mock responses for testing and air-gapped runs.
 */
export const STATIC_MOCK_TARGETS = {
  'google/sam': JSON.stringify({
    repository: "google/sam",
    framework: "Sovereign Agent Mesh",
    p2p_mesh: true,
    last_commit_hash: "9a9a3b8c6e21d60bf643c9f54b68eacd1024bcde",
    active_features: [
      "Sovereign node validation",
      "libp2p universal routing fabric",
      "OIDC account verification sidecar"
    ]
  }),
  'volcengine/OpenViking': JSON.stringify({
    repository: "volcengine/OpenViking",
    protocol: "viking://",
    layers: ["L0_abstract", "L1_overview", "L2_details"],
    current_version: "v1.1.2-beta"
  })
};

/**
 * Fetches target content safely via live HTTP with fallback to static deterministic mocks.
 * @param {object} target 
 * @param {object} [options]
 * @returns {Promise<string>}
 */
export async function fetchTargetContent(target, options = {}) {
  validateTargetUrl(target.url, options);

  if (process.env.AIRGAP !== 'true' && !options.forceMock) {
    try {
      const response = await fetch(target.url, {
        headers: {
          'User-Agent': 'TRM-Competitor-Watcher/2.0',
          'Accept': target.type === 'rest_api' ? 'application/json' : '*/*'
        },
        signal: AbortSignal.timeout(options.timeoutMs || 5000)
      });
      if (response.ok) {
        return (await response.text()).trim();
      }
    } catch (err) {
      if (options.throwOnFetchError) {
        throw new Error(`FETCH_FAILED: ${target.url} - ${err.message}`);
      }
      logWarn(`Live fetch failed for ${target.url}. Falling back to deterministic static baseline.`);
    }
  }

  for (const [key, payload] of Object.entries(STATIC_MOCK_TARGETS)) {
    if (target.url.includes(key)) {
      return payload;
    }
  }

  return `STATIC_PAYLOAD_FOR_TARGET[${target.target_id}]_URL[${target.url}]`;
}

/**
 * Performs structured line-by-line semantic diffing against Layer 2 Wiki markdown.
 * @param {string} localPath 
 * @param {string} newPayload 
 * @returns {{ change_type: string, added_lines: number, deleted_lines: number, unchanged_lines: number, similarity_ratio: number, patch_preview: string }}
 */
export function performStructuredDiff(localPath, newPayload) {
  if (!fs.existsSync(localPath)) {
    const newLines = newPayload.split('\n');
    return {
      change_type: "new",
      added_lines: newLines.length,
      deleted_lines: 0,
      unchanged_lines: 0,
      similarity_ratio: 0.0,
      patch_preview: `+++ NEW_RECORD: ${localPath}\n` + newLines.slice(0, 10).map(l => `+ ${l}`).join('\n')
    };
  }

  const localContent = fs.readFileSync(localPath, 'utf8');
  if (localContent === newPayload) {
    return {
      change_type: "unchanged",
      added_lines: 0,
      deleted_lines: 0,
      unchanged_lines: localContent.split('\n').length,
      similarity_ratio: 1.0,
      patch_preview: "No changes detected."
    };
  }

  const oldLines = localContent.split('\n');
  const newLines = newPayload.split('\n');
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  let added = 0;
  let deleted = 0;
  let unchanged = 0;

  for (const l of newLines) {
    if (oldSet.has(l)) unchanged++;
    else added++;
  }
  for (const l of oldLines) {
    if (!newSet.has(l)) deleted++;
  }

  const totalLines = Math.max(oldLines.length, newLines.length, 1);
  const similarity = Number((unchanged / totalLines).toFixed(4));

  const preview = [
    `--- BASELINE: ${localPath} (${oldLines.length} lines)`,
    `+++ OBSERVED: payload (${newLines.length} lines)`,
    `@@ -1,${Math.min(oldLines.length, 5)} +1,${Math.min(newLines.length, 5)} @@`,
    ...oldLines.slice(0, 3).map(l => `- ${l}`),
    ...newLines.slice(0, 3).map(l => `+ ${l}`)
  ].join('\n');

  return {
    change_type: "modified",
    added_lines: added,
    deleted_lines: deleted,
    unchanged_lines: unchanged,
    similarity_ratio: similarity,
    patch_preview: preview
  };
}

/**
 * Concurrency-safe task dispatcher supporting SQLite and atomic JSONL queueing.
 * @param {object|null} db 
 * @param {object} signedEnvelope 
 * @param {string} [queuePath] 
 */
export function dispatchSigilEnvelope(db, signedEnvelope, queuePath = './sigil-queue.jsonl') {
  if (db) {
    const stmt = db.prepare(`
      INSERT INTO local_approvals (
        approval_id, profile_id, action_hash, capability, scope, requested_by, status, envelope_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const actionHash = crypto.createHash('sha256')
      .update(canonicalizeJson(signedEnvelope.body))
      .digest('hex');

    stmt.run(
      signedEnvelope.message_id,
      signedEnvelope.sender.endpoint_id,
      actionHash,
      signedEnvelope.capabilities[0] || 'sigil.core/read_shared_context',
      `watchlist:${signedEnvelope.body.watchlist_id}`,
      signedEnvelope.sender.owner_id,
      signedEnvelope.approval.status,
      JSON.stringify(signedEnvelope)
    );
  } else {
    const resolvedPath = path.resolve(queuePath);
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const line = JSON.stringify(signedEnvelope) + '\n';
    fs.appendFileSync(resolvedPath, line, { encoding: 'utf8', flag: 'a' });
  }
}

/**
 * Main monitor execution engine.
 * @param {string} watchlistPath 
 * @param {object} [options]
 */
export async function monitorCompetitorWatchlist(watchlistPath, options = {}) {
  logInfo(`Initializing Competitor Watchlist Monitor using target config: ${watchlistPath}...`);

  if (!fs.existsSync(watchlistPath)) {
    throw new Error(`FILE_NOT_FOUND: Watchlist configuration at '${watchlistPath}' does not exist.`);
  }

  const rawConfig = fs.readFileSync(watchlistPath, 'utf8');
  const watchlist = JSON.parse(rawConfig);
  validateWatchlist(watchlist, options);
  logInfo(`✓ Watchlist schema validated (<= 30 targets cap enforced).`);

  let db = null;
  if (options.dbPath) {
    if (!Database) {
      throw new Error(`SQLITE_UNAVAILABLE: better-sqlite3 module could not be loaded for requested dbPath: ${options.dbPath}`);
    }
    const dbDir = path.dirname(path.resolve(options.dbPath));
    if (!fs.existsSync(dbDir) && !options.dryRun) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    db = new Database(options.dbPath);
    db.pragma('foreign_keys = ON');

    // Ensure table structure exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS local_approvals (
        approval_id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        action_hash TEXT NOT NULL,
        capability TEXT NOT NULL,
        scope TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        status TEXT NOT NULL,
        envelope_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  const keyPair = options.keyPair || generateSigilKeyPair();

  let totalTargets = watchlist.targets.length;
  let cacheHits = 0;
  let driftsDetected = 0;
  const queuedEnvelopes = [];

  for (const target of watchlist.targets) {
    logInfo(`Evaluating target: '${target.target_id}' (${target.type}) ...`);

    const content = await fetchTargetContent(target, options);
    const hash = crypto.createHash('sha256').update(content).digest('hex');

    if (hash === target.hash_baseline) {
      logInfo(`  -> Cache Hit for '${target.target_id}' [SHA-256 MATCH]. No semantic drift, 0 LLM token spend.`);
      cacheHits++;
      continue;
    }

    logWarn(`  -> Drift Detected on target '${target.target_id}'! (Baseline: ${target.hash_baseline.slice(0, 8)}..., Current: ${hash.slice(0, 8)}...)`);
    driftsDetected++;
    watchlist.memory_alignment.status = 'drift_detected';

    if (options.acceptDrift) {
      logInfo(`  -> [ACCEPT-DRIFT] Promoting observed hash as new baseline.`);
      target.hash_baseline = hash;
      watchlist.memory_alignment.status = 'stable';
    }

    if (watchlist.memory_alignment.delta_rules.trigger_comparison) {
      const wikiRoot = options.wikiRoot || process.env.OBSIDIAN_VAULT_ROOT || process.env.WORKSPACE_ROOT || './wiki';
      const localWikiFile = path.join(wikiRoot, watchlist.memory_alignment.layer2_wiki_path);

      logInfo(`  -> Executing structured diffing against local baseline: ${localWikiFile}...`);
      const diffResult = performStructuredDiff(localWikiFile, content);

      if (watchlist.human_in_the_loop?.step_up_required) {
        logWarn(`  -> Constructing signed Sigil envelope for high-assurance human step-up gate...`);

        const unsignedEnvelope = {
          protocol: "sigil/1",
          message_id: `msg_${crypto.randomUUID()}`,
          conversation_id: `conv_trm_${watchlist.watchlist_id.replace(/^trm:watchlist:/, '')}`,
          message_type: "task.request",
          sender: {
            owner_id: "usr_system",
            endpoint_id: "ep_trm_watcher",
            kind: "agent"
          },
          recipient: {
            owner_id: "usr_operator",
            endpoint_id: "ep_sigil_relay"
          },
          body: {
            instruction: "Review detected competitor payload drift and approve promotion to Layer 2 reference wiki.",
            task_id: `task_${target.target_id}_${Date.now()}`,
            watchlist_id: watchlist.watchlist_id,
            target_id: target.target_id,
            baseline_hash: target.hash_baseline,
            observed_hash: hash,
            diff_summary: diffResult
          },
          context_refs: [
            `trm:ref:${target.target_id}:${target.hash_baseline}`,
            `trm:ref:${target.target_id}:${hash}`
          ],
          capabilities: ["sigil.core/read_shared_context"],
          approval: {
            required: true,
            status: "pending"
          },
          correlation_id: `corr_${target.target_id}`,
          idempotency_key: `idem_${target.target_id}_${hash}`,
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 86400000).toISOString() // 24h validity
        };

        const signedEnvelope = signSigilEnvelope(unsignedEnvelope, keyPair.privateKeyPem, keyPair.keyId);
        const isValid = verifySigilEnvelope(signedEnvelope, keyPair.publicKeyPem);
        if (!isValid) {
          throw new Error('ENVELOPE_INTEGRITY_FAILURE: Generated Sigil envelope failed cryptographic self-verification.');
        }

        if (!options.dryRun) {
          dispatchSigilEnvelope(db, signedEnvelope, options.queuePath);
          logInfo(`  -> ✓ Signed Sigil envelope [ID: ${signedEnvelope.message_id}] persisted.`);
        } else {
          logInfo(`  -> [DRY-RUN] Skipped persistence for envelope ${signedEnvelope.message_id}.`);
        }

        queuedEnvelopes.push(signedEnvelope);
      }
    }
  }

  watchlist.last_monitored_at = new Date().toISOString();

  if (!options.dryRun && (options.acceptDrift || driftsDetected > 0)) {
    fs.writeFileSync(watchlistPath, JSON.stringify(watchlist, null, 2), 'utf8');
  }

  if (db) db.close();

  return {
    totalTargets,
    cacheHits,
    driftsDetected,
    queuedEnvelopes,
    keyPair
  };
}

// CLI boundary
if (process.argv[1] && (process.argv[1].endsWith('watch-competitors-v2.mjs') || process.argv[1].endsWith('watch-competitors.mjs'))) {
  const args = process.argv.slice(2);
  const targetWatchlist = args.find(a => !a.startsWith('--')) || './trm/watchlists/google-sam.json';
  const dryRun = args.includes('--dry-run');
  const acceptDrift = args.includes('--accept-drift');
  const allowInsecure = args.includes('--allow-insecure-http');
  const dbArg = args.find(a => a.startsWith('--db='))?.split('=')[1];
  const queueArg = args.find(a => a.startsWith('--queue='))?.split('=')[1] || './sigil-queue.jsonl';

  monitorCompetitorWatchlist(targetWatchlist, {
    dryRun,
    acceptDrift,
    allowInsecureHttp: allowInsecure,
    dbPath: dbArg,
    queuePath: queueArg
  }).then(res => {
    console.log(`\n================================================================================`);
    console.log(`RUN SUMMARY: Targets: ${res.totalTargets} | Hits (0 LLM Spend): ${res.cacheHits} | Drifts: ${res.driftsDetected} | Queued: ${res.queuedEnvelopes.length}`);
    console.log(`================================================================================\n`);
  }).catch(err => {
    logError(`Fatal run error: ${err.message}`);
    process.exit(1);
  });
}
