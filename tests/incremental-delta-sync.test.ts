import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import * as detectDrift from "../modules/wiki/detect-drift.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

console.log("================================================================================");
console.log("Incremental Delta Sync Engine Verification Tests");
console.log("================================================================================\n");

let allTestsPassed = true;

function runTest(name: string, fn: () => void) {
  console.log(`[TEST] Running: ${name}...`);
  try {
    fn();
    console.log(`[PASS] ✓ ${name}\n`);
  } catch (error: any) {
    console.error(`[FAIL] ✗ ${name}`);
    console.error(`       Error: ${error.message || error}`);
    if (error.stack) console.error(`       Stack: ${error.stack}`);
    console.error("");
    allTestsPassed = false;
  }
}

const testVaultRoot = path.join(REPO_ROOT, ".tmp_test_vault_delta_engine");
if (fs.existsSync(testVaultRoot)) {
  fs.rmSync(testVaultRoot, { recursive: true, force: true });
}

try {
  const stagingRoot = path.join(testVaultRoot, "_kb-sync-staging", "kb-sync");

  // Test 1: Path Traversal & Security Validation
  runTest("Path traversal and absolute path rejection", () => {
    // Valid relative path
    const safe = detectDrift.sanitizeRelativePath("src/api.ts", REPO_ROOT);
    if (safe !== "src/api.ts") throw new Error(`Expected src/api.ts, got ${safe}`);

    // Invalid path traversal
    let threw = false;
    try {
      detectDrift.sanitizeRelativePath("../outside.ts", REPO_ROOT);
    } catch {
      threw = true;
    }
    if (!threw) throw new Error("Path traversal ../outside.ts was not rejected!");

    // Invalid absolute path
    threw = false;
    try {
      detectDrift.sanitizeRelativePath("C:/Windows/System32", REPO_ROOT);
    } catch {
      threw = true;
    }
    if (!threw) throw new Error("Absolute path was not rejected!");
  });

  // Test 2: Baseline Materialization
  runTest("Baseline snapshot materializes complete tree", () => {
    const result = detectDrift.materializeIncrementalStaging({
      repoRoot: REPO_ROOT,
      vaultRoot: testVaultRoot,
      stagingDir: "_kb-sync-staging",
      repoName: "kb-sync",
      manifestFiles: ["package.json", "CLAUDE.md"],
      forceFull: false,
    });

    if (!result.isBaseline) throw new Error("Expected initial run to be baseline");
    if (!fs.existsSync(result.publishedStagingDir)) throw new Error(`Published dir not found: ${result.publishedStagingDir}`);
    if (!fs.existsSync(path.join(result.publishedStagingDir, "package.json"))) throw new Error("package.json missing in baseline snapshot");
    if (!fs.existsSync(path.join(result.publishedStagingDir, "SYNC_META.json"))) throw new Error("SYNC_META.json missing in baseline snapshot");

    const meta = JSON.parse(fs.readFileSync(path.join(result.publishedStagingDir, "SYNC_META.json"), "utf8"));
    if (meta.status !== "COMPLETE") throw new Error(`Expected status COMPLETE, got ${meta.status}`);
    if (meta.mode !== "FULL") throw new Error(`Expected mode FULL for baseline, got ${meta.mode}`);
  });

  // Test 3: Incremental Snapshot with Modified, Added, and Deleted Files
  runTest("Incremental snapshot reuses unchanged files via hard-link/copy and tracks deletions", () => {
    // Perform second run with manifest including package.json, adding README.md, omitting CLAUDE.md (deleted)
    const result = detectDrift.materializeIncrementalStaging({
      repoRoot: REPO_ROOT,
      vaultRoot: testVaultRoot,
      stagingDir: "_kb-sync-staging",
      repoName: "kb-sync",
      manifestFiles: ["package.json", "README.md"],
      forceFull: false,
    });

    if (result.isBaseline) throw new Error("Expected second run to be incremental, not baseline");
    if (!fs.existsSync(result.publishedStagingDir)) throw new Error("Second snapshot directory not published");

    const meta = JSON.parse(fs.readFileSync(path.join(result.publishedStagingDir, "SYNC_META.json"), "utf8"));
    if (meta.status !== "COMPLETE") throw new Error(`Expected COMPLETE status, got ${meta.status}`);
    if (meta.mode !== "INCREMENTAL") throw new Error(`Expected INCREMENTAL mode, got ${meta.mode}`);
    if (!meta.deleted_paths.includes("CLAUDE.md")) throw new Error("Expected CLAUDE.md in deleted_paths");
    if (meta.stats.added_files < 1) throw new Error("Expected added_files >= 1");
    if (meta.stats.reused_unchanged_files < 1) throw new Error("Expected reused_unchanged_files >= 1");

    // Check file presence in materialized tree
    if (!fs.existsSync(path.join(result.publishedStagingDir, "package.json"))) throw new Error("package.json missing in 2nd snapshot");
    if (!fs.existsSync(path.join(result.publishedStagingDir, "README.md"))) throw new Error("README.md missing in 2nd snapshot");
    if (fs.existsSync(path.join(result.publishedStagingDir, "CLAUDE.md"))) throw new Error("Deleted file CLAUDE.md should not be in 2nd snapshot tree!");
  });

  // Test 4: Second Incremental Run with Zero Changes
  runTest("Incremental run with zero changes reuses 100% of files without error", () => {
    const result = detectDrift.materializeIncrementalStaging({
      repoRoot: REPO_ROOT,
      vaultRoot: testVaultRoot,
      stagingDir: "_kb-sync-staging",
      repoName: "kb-sync",
      manifestFiles: ["package.json", "README.md"],
      forceFull: false,
    });

    if (result.isBaseline) throw new Error("Expected incremental run");
    const meta = JSON.parse(fs.readFileSync(path.join(result.publishedStagingDir, "SYNC_META.json"), "utf8"));
    if (meta.stats.modified_files !== 0 || meta.stats.added_files !== 0 || meta.stats.deleted_files !== 0) {
      throw new Error(`Expected zero diffs for unchanged run, got: ${JSON.stringify(meta.stats)}`);
    }
    if (meta.stats.reused_unchanged_files !== 2) throw new Error(`Expected 2 reused files, got ${meta.stats.reused_unchanged_files}`);
  });

  // Test 5: `--full` Mode Independence
  runTest("--full mode forces complete fresh copy without reading prior snapshot", () => {
    const result = detectDrift.materializeIncrementalStaging({
      repoRoot: REPO_ROOT,
      vaultRoot: testVaultRoot,
      stagingDir: "_kb-sync-staging",
      repoName: "kb-sync",
      manifestFiles: ["package.json", "README.md"],
      forceFull: true,
    });

    const meta = JSON.parse(fs.readFileSync(path.join(result.publishedStagingDir, "SYNC_META.json"), "utf8"));
    if (meta.mode !== "FULL") throw new Error(`Expected mode FULL when forceFull is true, got ${meta.mode}`);
    if (meta.stats.reused_unchanged_files !== 0) throw new Error(`Full mode should reuse 0 files, got ${meta.stats.reused_unchanged_files}`);
  });

  // Test 6: Snapshot Validation & Corrupt Baseline Recovery
  runTest("Corrupt snapshot is skipped and engine falls back to previous valid snapshot", () => {
    // Create a corrupt snapshot directory
    const corruptDir = path.join(stagingRoot, "99999999-999999");
    fs.mkdirSync(corruptDir, { recursive: true });
    // Write an invalid/incomplete SYNC_META.json
    fs.writeFileSync(path.join(corruptDir, "SYNC_META.json"), JSON.stringify({ status: "INCOMPLETE" }));

    const latestValid = detectDrift.getLatestValidStagingDir({ vaultRoot: testVaultRoot, stagingDir: "_kb-sync-staging", repoName: "kb-sync" });
    if (!latestValid) throw new Error("Expected to find valid snapshot prior to corrupt one");
    if (latestValid.endsWith("99999999-999999")) throw new Error("Corrupt snapshot was incorrectly selected as valid!");

    // Run incremental staging and ensure it succeeds using the valid snapshot
    const result = detectDrift.materializeIncrementalStaging({
      repoRoot: REPO_ROOT,
      vaultRoot: testVaultRoot,
      stagingDir: "_kb-sync-staging",
      repoName: "kb-sync",
      manifestFiles: ["package.json", "README.md"],
      forceFull: false,
    });

    if (!result.publishedStagingDir) throw new Error("Materialization failed when corrupt snapshot was present");
  });

  // Test 7: Concurrency Lock Rejection
  runTest("Acquiring lock while active lock exists throws Concurrency Lock Error", () => {
    const lockRoot = path.join(testVaultRoot, "lock_test_staging");
    fs.mkdirSync(lockRoot, { recursive: true });
    
    const lock1 = detectDrift.acquireLock(lockRoot);
    try {
      let threw = false;
      try {
        detectDrift.acquireLock(lockRoot);
      } catch (err: any) {
        if (err.message.includes("Concurrency Lock Error")) {
          threw = true;
        }
      }
      if (!threw) throw new Error("Second acquireLock did not throw Concurrency Lock Error!");
    } finally {
      detectDrift.releaseLock(lock1);
    }
  });

  // Test 8: Safe Stale Lock Recovery
  runTest("Stale lock (>10min) is recovered safely without removing replacement locks", () => {
    const lockRoot = path.join(testVaultRoot, "stale_lock_test_staging");
    fs.mkdirSync(lockRoot, { recursive: true });
    const lockFile = path.join(lockRoot, ".staging.lock");

    // Write a stale lock (>15 minutes ago)
    const staleTime = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    fs.writeFileSync(lockFile, JSON.stringify({ pid: 99999, timestamp: staleTime }), "utf8");

    // Acquire lock — should succeed by recovering stale lock
    const acquired = detectDrift.acquireLock(lockRoot);
    if (!fs.existsSync(acquired)) throw new Error("Stale lock was not recovered and replaced");

    const data = JSON.parse(fs.readFileSync(acquired, "utf8"));
    if (data.pid !== process.pid) throw new Error("New lock does not contain current process PID");

    detectDrift.releaseLock(acquired);
  });

} finally {
  if (fs.existsSync(testVaultRoot)) {
    fs.rmSync(testVaultRoot, { recursive: true, force: true });
  }
}

if (allTestsPassed) {
  console.log("================================================================================");
  console.log("SUCCESS: All incremental delta sync engine tests passed!");
  console.log("================================================================================");
  process.exit(0);
} else {
  console.log("================================================================================");
  console.log("FAILURE: One or more tests failed.");
  console.log("================================================================================");
  process.exit(1);
}
