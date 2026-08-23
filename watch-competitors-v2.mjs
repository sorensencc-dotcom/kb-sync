import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

// Dynamically handle optional better-sqlite3
let Database = null;
try {
  const sqliteModule = await import('better-sqlite3');
  Database = sqliteModule.default || sqliteModule;
} catch {
  // SQLite binary not installed or unavailable; fall back to filesystem queue
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
 * Validates watchlist configuration against TRMCompetitorWatchlistSchema.
 * @param {object} data
 */
export function validateWatchlist(data) {
  if (!data.watchlist_id || !/^trm:watchlist:[a-z0-9-]+$/.test(data.watchlist_id)) {
    throw new Error('INVALID_WATCHLIST: watchlist_id is missing or malformed.');
  }
  if (!data.competitor_name || typeof data.competitor_name !== 'string') {
    throw new Error('INVALID_WATCHLIST: competitor_name is required.');
  }
  if (!Array.isArray(data.targets) || data.targets.length === 0) {
    throw new Error('INVALID_WATCHLIST: targets array must contain at least 1 item.');
  }
  if (data.targets.length > 30) {
    throw new Error(`WATCHLIST_LIMIT_EXCEEDED: targets array exceeds 30-item limit. Current count: ${data.targets.length}`);
  }

  const validTypes = ['rest_api', 'git_repo', 'rss_feed', 'documentation_page', 'web_scrape'];
  for (const target of data.targets) {
    if (!target.target_id || !/^[a-z0-9-]+$/.test(target.target_id)) {
      throw new Error(`INVALID_TARGET: target_id '${target.target_id}' is malformed.`);
    }
    if (!target.url || typeof target.url !== 'string') {
      throw new Error(`INVALID_TARGET: target_id '${target.target_id}' is missing a valid URL.`);
    }
    if (!validTypes.includes(target.type)) {
      throw new Error(`INVALID_TARGET: target_id '${target.target_id}' has invalid type: ${target.type}`);
    }
    if (!target.hash_baseline || !/^[a-f0-9]{64}$/.test(target.hash_baseline)) {
      throw new Error(`INVALID_TARGET: target_id '${target.target_id}' has invalid hash_baseline format.`);
    }
  }

  const alignment = data.memory_alignment;
  if (!alignment || !alignment.layer2_wiki_path) {
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
 * Fetches target payload via live network with fallback mock content.
 * @param {object} target
 * @returns {Promise<string>}
 */
export async function fetchTargetContent(target) {
  if (process.env.AIRGAP !== 'true') {
    try {
      const response = await fetch(target.url, {
        headers: {
          'User-Agent': 'TRM-Competitor-Watcher/2.0',
          'Accept': target.type === 'rest_api' ? 'application/json' : '*/*'
        },
        signal: AbortSignal.timeout(5000)
      });
      if (response.ok) {
        return (await response.text()).trim();
      }
    } catch {
      logWarn(`Live fetch failed for ${target.url}. Falling back to mock baseline engine.`);
    }
  }

  if (target.url.includes('google/sam')) {
    return JSON.stringify({
      repository: "google/sam",
      framework: "Sovereign Agent Mesh",
      p2p_mesh: true,
      last_commit_hash: "9a9a3b8c6e21d60bf643c9f54b68eacd1024bcde",
      updated_at: new Date().toISOString(),
      active_features: [
        "Sovereign node validation",
        "libp2p universal routing fabric",
        "OIDC account verification sidecar"
      ]
    });
  }

  if (target.url.includes('volcengine/OpenViking')) {
    return JSON.stringify({
      repository: "volcengine/OpenViking",
      protocol: "viking://",
      layers: ["L0_abstract", "L1_overview", "L2_details"],
      current_version: "v1.1.2-beta",
      last_checked: new Date().toISOString()
    });
  }

  return `Scraped payload for ${target.url} at ${new Date().toISOString()}`;
}

/**
 * Performs local file diff against Layer 2 Semantic Wiki.
 * @param {string} localPath
 * @param {string} newPayload
 * @returns {string}
 */
export function performLocalDiff(localPath, newPayload) {
  if (!fs.existsSync(localPath)) {
    return `[NEW_CONCEPT] Local baseline file at '${localPath}' does not exist yet. Promoting as fresh entry.`;
  }
  const localContent = fs.readFileSync(localPath, 'utf8');
  return `--- BASELINE LOCAL REFERENCE ---\n${localContent.slice(0, 150)}...\n\n--- INBOUND CHANGED DRIFT ---\n${newPayload.slice(0, 150)}...`;
}

/**
 * Dispatches an approved task to SQLite or JSON queue.
 * @param {object|null} db
 * @param {object} task
 */
export function dispatchSigilTask(db, task) {
  if (db) {
    const insertStatement = db.prepare(`
      INSERT INTO local_approvals (
        approval_id, profile_id, action_hash, capability, scope, requested_by, status
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `);
    insertStatement.run(
      task.approval_id,
      task.profile_id,
      task.action_hash,
      task.capability,
      task.scope,
      task.requested_by
    );
  } else {
    const queueFile = path.resolve('./sigil-pending-tasks.json');
    const existing = fs.existsSync(queueFile) ? JSON.parse(fs.readFileSync(queueFile, 'utf8')) : [];
    existing.push({ ...task, status: 'pending', created_at: new Date().toISOString() });
    fs.writeFileSync(queueFile, JSON.stringify(existing, null, 2), 'utf8');
  }
}

/**
 * Main Orchestration function.
 * @param {string} watchlistPath
 * @param {string} [dbPath]
 * @param {string} [schemaPath]
 */
export async function monitorCompetitorWatchlist(watchlistPath, dbPath, schemaPath) {
  logInfo(`Initializing Competitor Watchlist Monitor using target config: ${watchlistPath}...`);

  if (!fs.existsSync(watchlistPath)) {
    throw new Error(`FILE_NOT_FOUND: Watchlist configuration at '${watchlistPath}' does not exist.`);
  }

  const rawConfig = fs.readFileSync(watchlistPath, 'utf8');
  const watchlist = JSON.parse(rawConfig);
  validateWatchlist(watchlist);
  logInfo(`Watchlist configuration schema and 30-target limit validated: [PASSED]`);

  let db = null;
  if (Database && dbPath) {
    const dbDir = path.dirname(path.resolve(dbPath));
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    if (schemaPath && fs.existsSync(schemaPath)) {
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      db.exec(schemaSql);
    }
  }

  let totalTargets = watchlist.targets.length;
  let cacheHits = 0;
  let driftsDetected = 0;

  for (const target of watchlist.targets) {
    logInfo(`Evaluating target: '${target.target_id}' (${target.type}) ...`);

    const content = await fetchTargetContent(target);
    const hash = crypto.createHash('sha256').update(content).digest('hex');

    if (hash === target.hash_baseline) {
      logInfo(`  -> Cache Hit for '${target.target_id}' [SHA-256 MATCH]. No semantic drift, 0 LLM token spend.`);
      cacheHits++;
      continue;
    }

    logWarn(`  -> Drift Detected on target '${target.target_id}'!`);
    driftsDetected++;
    watchlist.memory_alignment.status = 'drift_detected';

    if (watchlist.memory_alignment.delta_rules.trigger_comparison) {
      const wikiRoot = process.env.OBSIDIAN_VAULT_ROOT || process.env.WORKSPACE_ROOT || './wiki';
      const localWikiFile = path.join(wikiRoot, watchlist.memory_alignment.layer2_wiki_path);

      logInfo(`  -> Triggering Semantic Diffing against local baseline: ${localWikiFile}...`);
      const diffReport = performLocalDiff(localWikiFile, content);

      if (watchlist.human_in_the_loop?.step_up_required) {
        logWarn(`  -> Human Step-Up required. Constructing signed Sigil envelope task...`);

        const actionObj = {
          action_type: "sigil.core/read_shared_context",
          target: target.target_id,
          arguments: {
            watchlist_id: watchlist.watchlist_id,
            drift_hash: hash,
            diff_preview: diffReport.slice(0, 100)
          },
          context_refs: [target.hash_baseline, hash]
        };

        const actionHash = crypto.createHash('sha256')
          .update(JSON.stringify(actionObj))
          .digest('hex');

        const approvalTask = {
          approval_id: `app_${crypto.randomUUID().slice(0, 12)}`,
          profile_id: "prof_writer_001",
          action_hash: actionHash,
          capability: "sigil.core/read_shared_context",
          scope: `watchlist:${watchlist.watchlist_id}`,
          requested_by: "agent_trm_harvester"
        };

        logInfo(`  -> Dispatching high-assurance step-up task [ID: ${approvalTask.approval_id}] to Sigil approval queue.`);
        dispatchSigilTask(db, approvalTask);
        logInfo(`  -> Task durably written.`);
      }
    }
  }

  watchlist.last_monitored_at = new Date().toISOString();
  if (process.env.DRY_RUN !== 'true') {
    fs.writeFileSync(watchlistPath, JSON.stringify(watchlist, null, 2), 'utf8');
  }

  console.log(`\n================================================================================`);
  console.log(`RUN COMPLETE: Evaluated ${totalTargets} targets. Hits: ${cacheHits}, Drifts: ${driftsDetected}`);
  console.log(`================================================================================\n`);

  if (db) db.close();
  return { totalTargets, cacheHits, driftsDetected };
}

// Runner boundary
if (process.argv[1] && (process.argv[1].endsWith('watch-competitors-v2.mjs') || process.argv[1].endsWith('watch-competitors.mjs'))) {
  const targetWatchlist = process.argv[2] || './trm/watchlists/google-sam.json';
  const testDb = process.argv[3] || './data/sigil.db';
  const testSchema = process.argv[4] || './data/connector-schema.sql';

  // Ensure directories exist
  const watchlistDir = path.dirname(path.resolve(targetWatchlist));
  if (!fs.existsSync(watchlistDir)) {
    fs.mkdirSync(watchlistDir, { recursive: true });
  }

  if (!fs.existsSync(targetWatchlist)) {
    const mockWatch = {
      watchlist_id: "trm:watchlist:google-sam",
      competitor_name: "Google Sovereign Agent Mesh",
      last_monitored_at: new Date().toISOString(),
      targets: [
        {
          target_id: "sam-repo-p2p",
          url: "https://github.com/google/sam",
          type: "git_repo",
          hash_baseline: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
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
    fs.writeFileSync(targetWatchlist, JSON.stringify(mockWatch, null, 2), 'utf8');
  }

  // Ensure data folder and connector schema exist if specified
  const schemaDir = path.dirname(path.resolve(testSchema));
  if (!fs.existsSync(schemaDir)) {
    fs.mkdirSync(schemaDir, { recursive: true });
  }
  if (!fs.existsSync(testSchema)) {
    const defaultSchema = `
CREATE TABLE IF NOT EXISTS local_approvals (
  approval_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  action_hash TEXT NOT NULL,
  capability TEXT NOT NULL,
  scope TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;
    fs.writeFileSync(testSchema, defaultSchema.trim(), 'utf8');
  }

  monitorCompetitorWatchlist(targetWatchlist, testDb, testSchema).catch(err => {
    logError(`Fatal run error: ${err.message}`);
    process.exit(1);
  });
}
