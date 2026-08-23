import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { monitorCompetitorWatchlist } from './watch-competitors.mjs';

// terminal logging colors
const COLOR_GREEN = '\x1b[32m';
const COLOR_YELLOW = '\x1b[33m';
const COLOR_RED = '\x1b[31m';
const COLOR_CYAN = '\x1b[36m';
const COLOR_RESET = '\x1b[0m';
const TAG = '[WATCHLIST-TEST]';

function logStep(step, title) {
  console.log(`\n${COLOR_CYAN}=== [STEP ${step}] ${title} ===${COLOR_RESET}`);
}

function logInfo(msg) {
  console.log(`${COLOR_GREEN}${TAG} [INFO]${COLOR_RESET} ${msg}`);
}

function logWarn(msg) {
  console.log(`${COLOR_YELLOW}${TAG} [WARN]${COLOR_RESET} ${msg}`);
}

function logError(msg) {
  console.error(`${COLOR_RED}${TAG} [ERROR]${COLOR_RESET} ${msg}`);
}

async function run() {
  logStep(1, 'Setting up isolated test environment');
  
  const testDir = path.resolve('./scratch/test-watchlist-env');
  fs.mkdirSync(testDir, { recursive: true });
  
  const testWatchlistPath = path.join(testDir, 'test-watchlist.json');
  const testDbPath = path.join(testDir, 'test-connector.db');
  
  let schemaPath = path.resolve('./connector-schema.sql');
  if (!fs.existsSync(schemaPath)) {
    schemaPath = path.resolve('./data/connector-schema.sql');
  }
  if (!fs.existsSync(schemaPath)) {
    schemaPath = path.resolve('../connector-schema.sql');
  }
  if (!fs.existsSync(schemaPath)) {
    schemaPath = path.resolve('../sigil-repo/sigil/connectors/v1/connector-schema.sql');
  }
  
  // Clean up any stale test database
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }

  logInfo(`Temporary test directory: ${testDir}`);
  logInfo(`Target Database path:     ${testDbPath}`);
  logInfo(`Schema path:              ${schemaPath}`);
  
  // 1. Create a watchlist config targeted at google/sam
  // We use an intentionally mismatched baseline hash to force a drift detection
  const mockWatchlist = {
    watchlist_id: "trm:watchlist:google-sam-mesh",
    competitor_name: "Google Sovereign Agent Mesh",
    last_monitored_at: new Date().toISOString(),
    targets: [
      {
        target_id: "sam-p2p-repository",
        url: "https://github.com/google/sam",
        type: "git_repo",
        hash_baseline: "0000000000000000000000000000000000000000000000000000000000000000" // This forces dynamic drift detection
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

  fs.writeFileSync(testWatchlistPath, JSON.stringify(mockWatchlist, null, 2), 'utf8');
  logInfo('✓ Staged mock competitor watchlist tracking google/sam with a mismatched SHA-256 baseline.');

  logStep(2, 'Pre-seeding Database Profiles to satisfy foreign keys');
  
  // Initialize DB and run schema setup so we can pre-populate reference tables
  const db = new Database(testDbPath);
  db.pragma('foreign_keys = ON');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schemaSql);
  
  // We must insert 'prof_writer_001' before running the monitor
  // because the database has strict FOREIGN KEY constraints:
  // local_approvals REFERENCES connector_profiles(profile_id)
  const insertProfile = db.prepare(`
    INSERT INTO connector_profiles (
      profile_id, owner_id, endpoint_id, display_name, relay_url, status, secure_key_reference, secure_token_reference
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  insertProfile.run(
    "prof_writer_001",
    "owner_charlie_001",
    "ep_writer_001",
    "Task Writer Profile",
    "https://relay.sigil.network",
    "active",
    "trm://keys/writer_001",
    "trm://tokens/writer_001"
  );
  
  logInfo('✓ Pre-seeded default profile "prof_writer_001" into connector_profiles table.');
  db.close();

  logStep(3, 'Executing watch-competitors daemon monitor run');
  
  // Now we execute the monitor against the test environment
  const result = await monitorCompetitorWatchlist(testWatchlistPath, testDbPath, schemaPath);
  
  logStep(4, 'Verifying test assertions against SQLite storage state');
  
  const verifyDb = new Database(testDbPath);
  verifyDb.pragma('foreign_keys = ON');
  
  // Query 1: Verify the approval task was created and committed
  const approvals = verifyDb.prepare("SELECT * FROM local_approvals").all();
  
  if (approvals.length === 0) {
    throw new Error('ASSERT_FAILURE: No approval task was created in local_approvals!');
  }
  
  const task = approvals[0];
  logInfo(`Found committed approval task [ID: ${task.approval_id}]`);
  
  // Assertions
  if (task.profile_id !== 'prof_writer_001') {
    throw new Error(`ASSERT_FAILURE: Expected profile_id to be 'prof_writer_001', got '${task.profile_id}'`);
  }
  if (task.status !== 'pending') {
    throw new Error(`ASSERT_FAILURE: Expected status to be 'pending', got '${task.status}'`);
  }
  if (task.capability !== 'sigil.core/read_shared_context') {
    throw new Error(`ASSERT_FAILURE: Expected capability to be 'sigil.core/read_shared_context', got '${task.capability}'`);
  }
  if (!/^[a-f0-9]{64}$/.test(task.action_hash)) {
    throw new Error(`ASSERT_FAILURE: Action hash '${task.action_hash}' is not a valid SHA-256 digest`);
  }
  
  logInfo('✓ Assertion PASSED: profile_id matches "prof_writer_001".');
  logInfo('✓ Assertion PASSED: status matches "pending".');
  logInfo('✓ Assertion PASSED: capability matches "sigil.core/read_shared_context".');
  logInfo('✓ Assertion PASSED: action_hash is a valid SHA-256 digest.');
  
  verifyDb.close();

  logStep(5, 'Cleaning up temporary test environment');
  fs.unlinkSync(testWatchlistPath);
  fs.unlinkSync(testDbPath);
  fs.rmdirSync(testDir);
  
  console.log(`\n${COLOR_GREEN}================================================================================`);
  console.log('🎉 SUCCESS: All Integration Test Assertions Passed! Watchlist Trigger matches.');
  console.log(`================================================================================${COLOR_RESET}\n`);
}

run().catch(err => {
  logError(`Fatal run error: ${err.message}`);
  process.exit(1);
});
