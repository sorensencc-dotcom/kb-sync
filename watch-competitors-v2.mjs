import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as https from 'node:https';
import * as http from 'node:http';
import * as dns from 'node:dns/promises';
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
 * Checks whether an IP address belongs to private, loopback, link-local, or reserved ranges.
 * Handles standard IPv4, IPv6, and IPv4-mapped IPv6 addresses.
 * @param {string} ipAddress
 * @returns {boolean} True if the IP is private or blocked.
 */
export function isPrivateOrBlockedIp(ipAddress) {
  let cleanIp = ipAddress.trim().replace(/^\[|\]$/g, '').toLowerCase();

  // Normalize IPv4-mapped IPv6 (::ffff:127.0.0.1 or ::ffff:7f00:1)
  const mappedMatch = cleanIp.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedMatch) {
    cleanIp = mappedMatch[1];
  } else if (cleanIp.startsWith('::ffff:')) {
    const hexPart = cleanIp.slice(7);
    const hexTokens = hexPart.split(':');
    if (hexTokens.length === 2) {
      const num1 = parseInt(hexTokens[0], 16);
      const num2 = parseInt(hexTokens[1], 16);
      if (!Number.isNaN(num1) && !Number.isNaN(num2)) {
        cleanIp = `${(num1 >> 8) & 255}.${num1 & 255}.${(num2 >> 8) & 255}.${num2 & 255}`;
      }
    }
  }

  const ipType = isIP(cleanIp);
  if (ipType === 4) {
    const parts = cleanIp.split('.').map(Number);
    // 127.0.0.0/8 (Loopback)
    if (parts[0] === 127) return true;
    // 0.0.0.0/8 (Current network)
    if (parts[0] === 0) return true;
    // 10.0.0.0/8 (Private RFC1918)
    if (parts[0] === 10) return true;
    // 172.16.0.0/12 (Private RFC1918: 172.16 - 172.31)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16 (Private RFC1918)
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 169.254.0.0/16 (Link-local & AWS/GCP metadata 169.254.169.254)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 100.64.0.0/10 (Carrier-grade NAT)
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) return true;
    // 198.18.0.0/15 (Benchmarking)
    if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true;
    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
    if (parts[0] >= 224) return true;
    return false;
  }

  if (ipType === 6) {
    if (cleanIp === '::1' || cleanIp === '::') return true;
    // Unique local address fc00::/7 (fc00:: and fd00::)
    if (cleanIp.startsWith('fc') || cleanIp.startsWith('fd')) return true;
    // Link-local address fe80::/10
    if (cleanIp.startsWith('fe80:') || cleanIp.startsWith('fe90:') || cleanIp.startsWith('fea0:') || cleanIp.startsWith('feb0:')) return true;
    // Discard prefix 100::/64
    if (cleanIp.startsWith('100::')) return true;
    return false;
  }

  return false;
}

/**
 * Validates a target URL against SSRF and network security rules.
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

  // Allow explicit .test TLD only when options.allowTestTld is explicitly true
  if (rawHost.endsWith('.test')) {
    if (options.allowTestTld) {
      return true;
    }
    throw new Error(`SSRF_REJECTED: .test domain "${rawHost}" is forbidden in production policy.`);
  }

  // Forbidden local / internal hostnames
  const forbiddenHosts = ['localhost', 'loopback', 'metadata.google.internal', 'instance-data'];
  if (forbiddenHosts.includes(rawHost) || rawHost.endsWith('.local') || rawHost.endsWith('.internal')) {
    throw new Error(`SSRF_REJECTED: Hostname "${rawHost}" points to private or loopback infrastructure.`);
  }

  // Check literal IP address
  if (isPrivateOrBlockedIp(rawHost)) {
    throw new Error(`SSRF_REJECTED: Target IP "${rawHost}" is in a private/loopback/reserved address range.`);
  }

  return true;
}

/**
 * Pins DNS resolution and performs anti-TOCTOU HTTP/HTTPS fetch with socket validation.
 * Correctly supports both single and multiple address lookup callback signatures required by Node HTTPS.
 * @param {string} targetUrl
 * @param {object} [options]
 * @returns {Promise<string>}
 */
export async function secureFetchWithPinnedDns(targetUrl, options = {}) {
  validateTargetUrl(targetUrl, options);
  const parsed = new URL(targetUrl);
  const cleanHost = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();

  let resolvedIp = cleanHost;
  if (!isIP(cleanHost)) {
    const records = await dns.lookup(cleanHost, { all: true });
    if (!records || records.length === 0) {
      throw new Error(`DNS_ERROR: No DNS records returned for ${cleanHost}`);
    }
    for (const rec of records) {
      if (isPrivateOrBlockedIp(rec.address)) {
        throw new Error(`SSRF_REJECTED: Hostname "${cleanHost}" resolved to private/blocked IP ${rec.address}.`);
      }
    }
    resolvedIp = records[0].address;
  } else if (isPrivateOrBlockedIp(cleanHost)) {
    throw new Error(`SSRF_REJECTED: Literal IP ${cleanHost} is private or blocked.`);
  }

  return new Promise((resolve, reject) => {
    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;
    const fam = isIP(resolvedIp) || 4;

    const reqOptions = {
      protocol: parsed.protocol,
      hostname: cleanHost,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'Host': cleanHost,
        'User-Agent': 'TRM-Competitor-Watcher/2.0',
        'Accept': '*/*'
      },
      lookup: (hostname, opts, callback) => {
        // Correctly handle opts.all requested by tls.connect / lookupAndConnectMultiple
        if (opts && opts.all) {
          callback(null, [{ address: resolvedIp, family: fam }]);
        } else {
          callback(null, resolvedIp, fam);
        }
      },
      timeout: options.timeoutMs || 8000
    };

    if (isHttps && !isIP(cleanHost)) {
      reqOptions.servername = cleanHost; // Ensure TLS SNI matches expected hostname (forbidden for raw IPs per RFC 6066)
    }

    const req = client.request(reqOptions, (res) => {
      // Disallow automatic redirects to prevent secondary SSRF bounces
      if (res.statusCode >= 300 && res.statusCode < 400) {
        req.destroy();
        return reject(new Error(`SSRF_REDIRECT_BLOCKED: HTTP redirects (${res.statusCode}) are forbidden.`));
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        req.destroy();
        return reject(new Error(`HTTP_ERROR: Target returned status ${res.statusCode} ${res.statusMessage}`));
      }

      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data.trim()));
    });

    req.on('socket', (socket) => {
      socket.on('connect', () => {
        const peer = socket.remoteAddress;
        if (peer && isPrivateOrBlockedIp(peer)) {
          req.destroy();
          reject(new Error(`SSRF_BLOCKED: Connected socket peer ${peer} is in a private address range.`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`TIMEOUT: Request to ${targetUrl} timed out.`));
    });

    req.on('error', err => reject(err));
    req.end();
  });
}

/**
 * Safely resolves and validates Layer 2 Wiki markdown paths to prevent directory traversal.
 * @param {string} wikiRoot
 * @param {string} relativePath
 * @returns {string} Absolute resolved file path
 */
export function resolveSafeWikiPath(wikiRoot, relativePath) {
  if (!relativePath || typeof relativePath !== 'string') {
    throw new Error('INVALID_PATH: layer2_wiki_path must be a non-empty string.');
  }

  if (path.isAbsolute(relativePath)) {
    throw new Error(`PATH_TRAVERSAL_DETECTED: Absolute paths are forbidden: "${relativePath}".`);
  }

  const normalized = path.normalize(relativePath);
  if (normalized.startsWith('..') || normalized.includes(`..${path.sep}`)) {
    throw new Error(`PATH_TRAVERSAL_DETECTED: Directory traversal sequence detected in "${relativePath}".`);
  }

  const rootAbs = path.resolve(wikiRoot);
  const targetAbs = path.resolve(rootAbs, normalized);
  const rel = path.relative(rootAbs, targetAbs);

  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`PATH_TRAVERSAL_DETECTED: Resolved path "${targetAbs}" escapes root "${rootAbs}".`);
  }

  return targetAbs;
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
  resolveSafeWikiPath(options.wikiRoot || '.', alignment.layer2_wiki_path);

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
 * Strict RFC 8785 JSON Canonicalization Scheme (JCS) serializer.
 * @param {any} val
 * @returns {string} Canonical JSON string
 */
export function canonicalizeJson(val) {
  if (val === null) {
    return 'null';
  }
  const t = typeof val;
  if (t === 'boolean') {
    return val ? 'true' : 'false';
  }
  if (t === 'number') {
    if (!Number.isFinite(val)) {
      throw new TypeError('JCS_ERROR: Non-finite numbers (NaN, Infinity) are forbidden in JCS serialization.');
    }
    return Object.is(val, -0) ? '0' : JSON.stringify(val);
  }
  if (t === 'string') {
    return JSON.stringify(val);
  }
  if (t === 'undefined' || t === 'symbol' || t === 'function') {
    return undefined;
  }
  if (Array.isArray(val)) {
    const items = val.map(item => {
      const canon = canonicalizeJson(item);
      return canon === undefined ? 'null' : canon;
    });
    return '[' + items.join(',') + ']';
  }
  if (t === 'object') {
    const keys = Object.keys(val).filter(k => val[k] !== undefined && typeof val[k] !== 'symbol' && typeof val[k] !== 'function');
    keys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const entries = keys.map(k => JSON.stringify(k) + ':' + canonicalizeJson(val[k]));
    return '{' + entries.join(',') + '}';
  }

  throw new TypeError(`JCS_ERROR: Unsupported data type: ${t}`);
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
 * Deterministic mock responses for explicit air-gapped test modes.
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
  }),
  'nanonets/graft': JSON.stringify({
    repository: "nanonets/graft",
    architecture: "Linked Markdown Knowledge Graph",
    features: ["AST indexing", "file:line spans", "deterministic graph build"]
  })
};

/**
 * Fetches target content safely via secure anti-TOCTOU live network fetch.
 * Fails closed on network errors; only returns mock payloads when explicitly requested via forceMock/AIRGAP.
 * @param {object} target
 * @param {object} [options]
 * @returns {Promise<string>}
 */
export async function fetchTargetContent(target, options = {}) {
  validateTargetUrl(target.url, options);

  const isAirGap = process.env.AIRGAP === 'true' || options.forceMock === true;

  if (isAirGap) {
    for (const [key, payload] of Object.entries(STATIC_MOCK_TARGETS)) {
      if (target.url.includes(key)) {
        return payload;
      }
    }
    throw new Error(`MOCK_UNAVAILABLE: Target "${target.url}" is not configured in static mock fixtures.`);
  }

  // Live transport path — fails closed on any connection/HTTP error
  try {
    return await secureFetchWithPinnedDns(target.url, options);
  } catch (err) {
    throw new Error(`LIVE_FETCH_FAILED: Target "${target.url}" failed live transport: ${err.message}`);
  }
}

/**
 * Performs local file diffing for Layer 2 Semantic Wiki vs the new payload.
 * @param {string} localPath
 * @param {string} newPayload
 * @returns {string} Formatted difference report
 */
export function performLocalDiff(localPath, newPayload) {
  if (!fs.existsSync(localPath)) {
    return `[NEW_CONCEPT] Local baseline file at '${localPath}' does not exist yet. Promoting as a fresh, unstaged concept entry.`;
  }
  const localContent = fs.readFileSync(localPath, 'utf8');
  return `--- BASELINE LOCAL REFERENCE ---\n${localContent}\n\n--- INBOUND CHANGED DRIFT ---\n${newPayload}`;
}

/**
 * Computes line-by-line longest common subsequence (LCS) matrix.
 * @param {Array<string>} a
 * @param {Array<string>} b
 * @returns {Array<Array<number>>}
 */
function computeLcsMatrix(a, b) {
  const m = a.length;
  const n = b.length;
  const matrix = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      if (a[i] === b[j]) {
        matrix[i + 1][j + 1] = matrix[i][j] + 1;
      } else {
        matrix[i + 1][j + 1] = Math.max(matrix[i + 1][j], matrix[i][j + 1]);
      }
    }
  }
  return matrix;
}

/**
 * Performs structured position-aware line-by-line diffing against Layer 2 Wiki markdown.
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

  const a = localContent.split('\n');
  const b = newPayload.split('\n');
  const matrix = computeLcsMatrix(a, b);

  const edits = [];
  let i = a.length;
  let j = b.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      edits.unshift({ type: 'unchanged', text: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || matrix[i][j - 1] >= matrix[i - 1][j])) {
      edits.unshift({ type: 'added', text: b[j - 1] });
      j--;
    } else if (i > 0 && (j === 0 || matrix[i][j - 1] < matrix[i - 1][j])) {
      edits.unshift({ type: 'deleted', text: a[i - 1] });
      i--;
    }
  }

  let added = 0;
  let deleted = 0;
  let unchanged = 0;
  const patchLines = [];

  for (const edit of edits) {
    if (edit.type === 'added') {
      added++;
      patchLines.push(`+ ${edit.text}`);
    } else if (edit.type === 'deleted') {
      deleted++;
      patchLines.push(`- ${edit.text}`);
    } else {
      unchanged++;
      patchLines.push(`  ${edit.text}`);
    }
  }

  const totalLines = Math.max(a.length, b.length, 1);
  const similarity = Number((unchanged / totalLines).toFixed(4));

  const preview = [
    `--- BASELINE: ${localPath} (${a.length} lines)`,
    `+++ OBSERVED: payload (${b.length} lines)`,
    `@@ -1,${a.length} +1,${b.length} @@`,
    ...patchLines.slice(0, 15)
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
 * Concurrency-safe, deduplicated JSONL queue dispatcher.
 * Uses atomic read-check-append with locking semantics.
 * @param {object|null} db
 * @param {object} signedEnvelope
 * @param {string} [queuePath]
 * @param {string} [profileId] - Explicit profile_id for the approval row. Must match an existing
 *   connector_profiles row when `db` is provided. Passing null/undefined falls back to
 *   'prof_trm_system', but callers should always supply this explicitly.
 * @returns {boolean} True if appended, false if deduplicated.
 */
export function dispatchSigilEnvelope(db, signedEnvelope, queuePath = './sigil-queue.jsonl', profileId) {
  if (db) {
    const actionHash = crypto.createHash('sha256')
      .update(canonicalizeJson(signedEnvelope.body))
      .digest('hex');

    // Resolve profile_id: use the caller-supplied value, or look it up by the well-known
    // system profile ID rather than letting LIMIT 1 pick an arbitrary row.
    const resolvedProfileId = profileId || 'prof_trm_system';
    const profileRow = db.prepare('SELECT profile_id FROM connector_profiles WHERE profile_id = ?').get(resolvedProfileId);
    if (!profileRow) {
      throw new Error(
        `DISPATCH_PROFILE_MISSING: No connector_profiles row found for profile_id="${resolvedProfileId}". ` +
        `Ensure the system profile is provisioned before dispatching envelopes.`
      );
    }

    const tableInfo = db.prepare('PRAGMA table_info(local_approvals)').all();
    const hasEnvelopeJson = tableInfo.some(col => col.name === 'envelope_json');

    if (hasEnvelopeJson) {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO local_approvals (
          approval_id, profile_id, action_hash, capability, scope, requested_by, status, envelope_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const res = stmt.run(
        signedEnvelope.message_id,
        resolvedProfileId,
        actionHash,
        signedEnvelope.capabilities?.[0] || 'sigil.core/read_shared_context',
        `watchlist:${signedEnvelope.body?.watchlist_id || 'default'}`,
        signedEnvelope.sender?.owner_id || 'usr_system',
        signedEnvelope.approval?.status || 'pending',
        JSON.stringify(signedEnvelope)
      );
      return res.changes > 0;
    } else {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO local_approvals (
          approval_id, profile_id, action_hash, capability, scope, requested_by, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const res = stmt.run(
        signedEnvelope.message_id,
        resolvedProfileId,
        actionHash,
        signedEnvelope.capabilities?.[0] || 'sigil.core/read_shared_context',
        `watchlist:${signedEnvelope.body?.watchlist_id || 'default'}`,
        signedEnvelope.sender?.owner_id || 'usr_system',
        signedEnvelope.approval?.status || 'pending'
      );
      return res.changes > 0;
    }
  }

  const resolvedPath = path.resolve(queuePath);
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Atomic file lock / deduplication check — fail closed if lock is unavailable
  const lockFile = `${resolvedPath}.lock`;
  let lockFd = null;
  try {
    // Attempt to acquire lock with a 2-second deadline
    const startTime = Date.now();
    while (lockFd === null && Date.now() - startTime < 2000) {
      try {
        lockFd = fs.openSync(lockFile, 'wx');
      } catch {
        // Lock file exists; short busy wait then retry
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }

    if (lockFd === null) {
      throw new Error(
        `QUEUE_LOCK_TIMEOUT: Could not acquire exclusive lock on ${resolvedPath} within 2 seconds. ` +
        `Another process may be holding it. Dispatch aborted to prevent unsafe concurrent writes.`
      );
    }

    if (fs.existsSync(resolvedPath)) {
      const existingContent = fs.readFileSync(resolvedPath, 'utf8');
      if (
        existingContent.includes(`"message_id":"${signedEnvelope.message_id}"`) ||
        (signedEnvelope.idempotency_key && existingContent.includes(`"idempotency_key":"${signedEnvelope.idempotency_key}"`))
      ) {
        logInfo(`  -> [IDEMPOTENT] Envelope ${signedEnvelope.message_id} already queued. Skipping duplicate.`);
        return false;
      }
    }

    const line = JSON.stringify(signedEnvelope) + '\n';
    fs.appendFileSync(resolvedPath, line, { encoding: 'utf8', flag: 'a' });
    return true;
  } finally {
    if (lockFd !== null) {
      fs.closeSync(lockFd);
      try { fs.unlinkSync(lockFile); } catch {}
    }
  }
}

/**
 * Legacy task adapter routing into signed envelope dispatcher.
 * @param {object|null} db
 * @param {object} task
 * @param {string} [queuePath]
 * @param {string} [profileId] - connector_profiles profile_id to attach the approval row to.
 *   Defaults to task.profile_id when present, then 'prof_trm_system'.
 */
export function dispatchSigilTask(db, task, queuePath, profileId) {
  const envelope = {
    protocol: "sigil/1",
    message_id: task.approval_id || `msg_${crypto.randomUUID()}`,
    conversation_id: "conv_trm_legacy",
    message_type: "task.request",
    sender: { owner_id: task.requested_by || "agent_trm_harvester", endpoint_id: "ep_legacy", kind: "agent" },
    recipient: { owner_id: "usr_operator", endpoint_id: "ep_sigil_relay" },
    body: { task_id: task.approval_id, action_hash: task.action_hash },
    context_refs: [],
    capabilities: [task.capability || "sigil.core/read_shared_context"],
    approval: { required: true, status: "pending" },
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString()
  };
  const keyPair = generateSigilKeyPair();
  const signed = signSigilEnvelope(envelope, keyPair.privateKeyPem, keyPair.keyId);
  const resolvedProfile = profileId || task.profile_id || 'prof_trm_system';
  return dispatchSigilEnvelope(db, signed, queuePath || './sigil-queue.jsonl', resolvedProfile);
}

/**
 * Main monitor execution engine.
 * @param {string} watchlistPath
 * @param {object} [options]
 */
export async function monitorCompetitorWatchlist(watchlistPath, optionsOrDbPath = {}, maybeSchemaPath = null) {
  logInfo(`Initializing Competitor Watchlist Monitor using target config: ${watchlistPath}...`);

  if (!fs.existsSync(watchlistPath)) {
    throw new Error(`FILE_NOT_FOUND: Watchlist configuration at '${watchlistPath}' does not exist.`);
  }

  let options = {};
  if (typeof optionsOrDbPath === 'string') {
    options = { dbPath: optionsOrDbPath, schemaPath: maybeSchemaPath };
  } else if (optionsOrDbPath && typeof optionsOrDbPath === 'object') {
    options = { ...optionsOrDbPath };
    if (maybeSchemaPath && typeof maybeSchemaPath === 'string' && !options.schemaPath) {
      options.schemaPath = maybeSchemaPath;
    }
  }

  const isDryRun = process.env.DRY_RUN === 'true' || options.dryRun === true;

  const rawConfig = fs.readFileSync(watchlistPath, 'utf8');
  const watchlist = JSON.parse(rawConfig);
  validateWatchlist(watchlist, options);
  logInfo(`✓ Watchlist schema validated (<= 30 targets cap enforced).`);

  let db = null;
  try {
    // ---------------------------------------------------------------------------
    // SQLite schema bootstrap & migration
    // ---------------------------------------------------------------------------
    if (options.dbPath && !isDryRun) {
      if (!Database) {
        throw new Error(`SQLITE_UNAVAILABLE: better-sqlite3 module could not be loaded for requested dbPath: ${options.dbPath}`);
      }
      const dbDir = path.dirname(path.resolve(options.dbPath));
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
      db = new Database(options.dbPath);
      db.pragma('foreign_keys = OFF'); // Disabled during migrations; re-enabled after

      // Schema version tracking
      db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )`);

      const currentVersion = (() => {
        const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get();
        return row?.v ?? 0;
      })();

      // Migration v1 — initial full schema (connector_profiles, local_approvals)
      if (currentVersion < 1) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS connector_profiles (
            profile_id TEXT PRIMARY KEY,
            owner_id TEXT NOT NULL,
            endpoint_id TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            relay_url TEXT NOT NULL,
            status TEXT CHECK(status IN ('active', 'suspended', 'decommissioned')) DEFAULT 'active',
            secure_key_reference TEXT NOT NULL,
            secure_token_reference TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
          );

          CREATE TABLE IF NOT EXISTS local_approvals (
            approval_id TEXT PRIMARY KEY,
            profile_id TEXT NOT NULL,
            action_hash TEXT NOT NULL,
            capability TEXT NOT NULL,
            scope TEXT NOT NULL,
            requested_by TEXT NOT NULL,
            status TEXT CHECK(status IN ('pending','approved','denied')) DEFAULT 'pending',
            decision_signature TEXT,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            decided_at TEXT
          );

          CREATE TABLE IF NOT EXISTS endpoint_keys (
            key_id TEXT PRIMARY KEY,
            profile_id TEXT NOT NULL,
            algorithm TEXT NOT NULL DEFAULT 'Ed25519',
            public_key_pem TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            expires_at TEXT
          );

          INSERT OR IGNORE INTO schema_version (version) VALUES (1);
        `);
      }

      // Migration v2 — add envelope_json to local_approvals (if absent)
      if (currentVersion < 2) {
        const cols = db.prepare('PRAGMA table_info(local_approvals)').all().map(c => c.name);
        if (!cols.includes('envelope_json')) {
          db.exec(`ALTER TABLE local_approvals ADD COLUMN envelope_json TEXT`);
        }
        db.exec(`INSERT OR IGNORE INTO schema_version (version) VALUES (2)`);
      }

      // Migration v3 — ensure endpoint_keys table exists for pre-v2 databases
      if (currentVersion < 3) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS endpoint_keys (
            key_id TEXT PRIMARY KEY,
            profile_id TEXT NOT NULL,
            algorithm TEXT NOT NULL DEFAULT 'Ed25519',
            public_key_pem TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            expires_at TEXT
          );
          INSERT OR IGNORE INTO schema_version (version) VALUES (3);
        `);
      }

      db.pragma('foreign_keys = ON'); // Re-enable after migrations

      // Provision system profile if absent. Validates prerequisite before any insert.
      const systemProfileId = options.systemProfileId || 'prof_trm_system';
      const existingProfile = db.prepare('SELECT profile_id FROM connector_profiles WHERE profile_id = ?').get(systemProfileId);
      if (!existingProfile) {
        if (options.requireExistingProfile) {
          throw new Error(
            `DB_PREREQUISITE: connector_profiles requires a profile row (profile_id="${systemProfileId}") ` +
            `but none was found. Provision the profile before running the monitor, or pass systemProfileId ` +
            `matching an existing row.`
          );
        }
        // Auto-provision system watcher profile so the monitor is self-contained
        db.prepare(`
          INSERT OR IGNORE INTO connector_profiles
            (profile_id, owner_id, endpoint_id, display_name, relay_url, secure_key_reference, secure_token_reference)
          VALUES (?, 'usr_system', 'ep_trm_watcher', 'TRM Competitor Watcher', 'sigil://relay/trm', 'key_ref:none', 'token_ref:none')
        `).run(systemProfileId);
        logInfo(`  -> Provisioned system connector profile: ${systemProfileId}`);
      }

      // Register the session's public signing key in endpoint_keys for relay verification
      options._systemProfileId = systemProfileId;
    }

    const keyPair = options.keyPair || generateSigilKeyPair();

    // Persist the signing key into endpoint_keys so the relay can verify envelopes independently
    if (db) {
      db.prepare(`
        INSERT OR IGNORE INTO endpoint_keys (key_id, profile_id, algorithm, public_key_pem, expires_at)
        VALUES (?, ?, 'Ed25519', ?, ?)
      `).run(
        keyPair.keyId,
        options._systemProfileId || 'prof_trm_system',
        keyPair.publicKeyPem,
        new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString() // 30-day key lifetime
      );
      logInfo(`  -> Signing key ${keyPair.keyId} registered in endpoint_keys.`);
    }

    const totalTargets = watchlist.targets.length;
    let cacheHits = 0;
    let driftsDetected = 0;
    let fetchErrors = 0;
    const queuedEnvelopes = [];


    for (const target of watchlist.targets) {
      logInfo(`Evaluating target: '${target.target_id}' (${target.type}) ...`);

      let content;
      try {
        content = await fetchTargetContent(target, options);
      } catch (err) {
        logError(`Target '${target.target_id}' fetch failed: ${err.message}`);
        fetchErrors++;
        watchlist.memory_alignment.status = 'stale';
        continue;
      }

      const hash = crypto.createHash('sha256').update(content).digest('hex');

      if (hash === target.hash_baseline) {
        logInfo(`  -> Cache Hit for '${target.target_id}' [SHA-256 MATCH]. No semantic drift, 0 LLM token spend.`);
        cacheHits++;
        continue;
      }

      const previousBaseline = target.hash_baseline;
      logWarn(`  -> Drift Detected on target '${target.target_id}'! (Baseline: ${previousBaseline.slice(0, 8)}..., Current: ${hash.slice(0, 8)}...)`);
      driftsDetected++;
      watchlist.memory_alignment.status = 'drift_detected';

      if (watchlist.memory_alignment.delta_rules.trigger_comparison) {
        const wikiRoot = options.wikiRoot || process.env.OBSIDIAN_VAULT_ROOT || process.env.WORKSPACE_ROOT || './wiki';
        const localWikiFile = resolveSafeWikiPath(wikiRoot, watchlist.memory_alignment.layer2_wiki_path);

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
              baseline_hash: previousBaseline,
              observed_hash: hash,
              diff_summary: diffResult
            },
            context_refs: [
              `trm:ref:${target.target_id}:${previousBaseline}`,
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
            expires_at: new Date(Date.now() + 86400000).toISOString()
          };

          const signedEnvelope = signSigilEnvelope(unsignedEnvelope, keyPair.privateKeyPem, keyPair.keyId);
          const isValid = verifySigilEnvelope(signedEnvelope, keyPair.publicKeyPem);
          if (!isValid) {
            throw new Error('ENVELOPE_INTEGRITY_FAILURE: Generated Sigil envelope failed cryptographic self-verification.');
          }

          if (!isDryRun) {
            const queued = dispatchSigilEnvelope(db, signedEnvelope, options.queuePath, options._systemProfileId);
            if (queued) {
              logInfo(`  -> ✓ Signed Sigil envelope [ID: ${signedEnvelope.message_id}] persisted.`);
            }
          } else {
            logInfo(`  -> [DRY-RUN] Skipped persistence for envelope ${signedEnvelope.message_id}.`);
          }

          queuedEnvelopes.push(signedEnvelope);
        }
      }
    }

    watchlist.last_monitored_at = new Date().toISOString();

    if (!isDryRun && driftsDetected > 0) {
      fs.writeFileSync(watchlistPath, JSON.stringify(watchlist, null, 2), 'utf8');
    }

    return {
      totalTargets,
      cacheHits,
      driftsDetected,
      fetchErrors,
      queuedEnvelopes,
      keyPair
    };
  } finally {
    if (db) {
      db.close();
    }
  }
}

// Production CLI boundary
if (process.argv[1] && (process.argv[1].endsWith('watch-competitors-v2.mjs') || process.argv[1].endsWith('watch-competitors.mjs'))) {
  const args = process.argv.slice(2);
  const targetWatchlist = args.find(a => !a.startsWith('--')) || './trm/watchlists/google-sam.json';
  const dryRun = args.includes('--dry-run');
  const allowInsecure = args.includes('--allow-insecure-http');
  const dbArg = args.find(a => a.startsWith('--db='))?.split('=')[1];
  const queueArg = args.find(a => a.startsWith('--queue='))?.split('=')[1] || './sigil-queue.jsonl';

  monitorCompetitorWatchlist(targetWatchlist, {
    dryRun,
    allowInsecureHttp: allowInsecure,
    dbPath: dbArg,
    queuePath: queueArg
  }).then(res => {
    console.log(`\n================================================================================`);
    console.log(`RUN SUMMARY: Targets: ${res.totalTargets} | Hits (0 LLM Spend): ${res.cacheHits} | Drifts: ${res.driftsDetected} | Errors: ${res.fetchErrors} | Queued: ${res.queuedEnvelopes.length}`);
    console.log(`================================================================================\n`);
  }).catch(err => {
    logError(`Fatal run error: ${err.message}`);
    process.exit(1);
  });
}
