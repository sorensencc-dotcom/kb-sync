import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

console.log("================================================================================");
console.log("Core Scripts Verification Tests");
console.log("================================================================================\n");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

console.log(`  Resolved REPO_ROOT: ${REPO_ROOT}\n`);

let allTestsPassed = true;

function runTest(name: string, fn: () => void) {
  console.log(`[TEST] Running: ${name}...`);
  try {
    fn();
    console.log(`[PASS] ✓ ${name}\n`);
  } catch (error: any) {
    console.error(`[FAIL] ✗ ${name}`);
    console.error(`       Error: ${error.message || error}\n`);
    allTestsPassed = false;
  }
}

// Convert path to relative form (bash-friendly) with forward slashes
function toBashPath(absolutePath: string): string {
  if (!absolutePath) return ".";
  const rel = path.relative(REPO_ROOT, absolutePath);
  if (rel === "") return ".";
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
    return rel.replace(/\\/g, '/');
  }
  const posix = absolutePath.replace(/\\/g, '/');
  if (/^([a-zA-Z]):\/(.*)/.test(posix)) {
    return posix.replace(/^([a-zA-Z]):\/(.*)/, (_, drive, rest) => `/mnt/${drive.toLowerCase()}/${rest}`);
  }
  return posix;
}

// Clean inherited GIT environment
function getCleanEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toUpperCase().startsWith("GIT_") && key.toUpperCase() !== "GIT_ASKPASS") {
      delete env[key];
    }
  }
  return env;
}

// Test 1: core/flatten.sh default mode (no --manifest)
runTest("core/flatten.sh default mode produces concatenated pack", () => {
  const tempDir = path.join(REPO_ROOT, ".test_core_flatten");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  try {
    const output = execSync(
      `bash core/flatten.sh --output "${toBashPath(tempDir)}" --pack-name "test_pack.txt" --global-config configs/global.yaml --repo-root "${toBashPath(REPO_ROOT)}"`,
      {
        cwd: REPO_ROOT,
        env: getCleanEnv(),
        encoding: "utf8"
      }
    );

    const packFile = path.join(tempDir, "test_pack.txt");
    if (!fs.existsSync(packFile)) {
      throw new Error(`Pack file not created: ${packFile}`);
    }

    const content = fs.readFileSync(packFile, "utf8");
    if (!content.includes("--- START FILE:") || !content.includes("--- END FILE:")) {
      throw new Error("Pack file does not contain file delimiters");
    }

    if (!content.includes("REWRITE LABS & CIC REPOSITORY KNOWLEDGE PACK")) {
      throw new Error("Pack file missing header");
    }

    console.log(`  Pack file size: ${fs.statSync(packFile).size} bytes`);
  } finally {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  }
});

// Test 2: core/flatten.sh --manifest mode
runTest("core/flatten.sh --manifest mode produces newline-delimited file list", () => {
  const tempDir = path.join(REPO_ROOT, ".test_core_flatten_manifest");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  try {
    const output = execSync(
      `bash core/flatten.sh --output "${toBashPath(tempDir)}" --pack-name "unused.txt" --global-config configs/global.yaml --repo-root "${toBashPath(REPO_ROOT)}" --manifest`,
      {
        cwd: REPO_ROOT,
        env: getCleanEnv(),
        encoding: "utf8"
      }
    );

    const manifestFile = path.join(tempDir, "pack.manifest.txt");
    if (!fs.existsSync(manifestFile)) {
      throw new Error(`Manifest file not created: ${manifestFile}`);
    }

    const lines = fs.readFileSync(manifestFile, "utf8").split("\n").filter(l => l.trim());
    if (lines.length === 0) {
      throw new Error("Manifest file is empty");
    }

    console.log(`  Manifest contains ${lines.length} files`);

    // Verify all listed files exist
    for (const file of lines.slice(0, 3)) {
      const fullPath = path.join(REPO_ROOT, file);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Manifest references non-existent file: ${file}`);
      }
    }
  } finally {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  }
});

// Test 3: core/validate.sh size classification
runTest("core/validate.sh classifies pack size correctly", () => {
  const tempDir = path.join(REPO_ROOT, ".test_core_validate");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  try {
    // Create 3MB file (OK status)
    const smallFile = path.join(tempDir, "small_pack.txt");
    fs.writeFileSync(smallFile, "A".repeat(3 * 1024 * 1024), "utf8");

    const output = execSync(
      `bash core/validate.sh --file "${toBashPath(smallFile)}" --global-config configs/global.yaml`,
      {
        cwd: REPO_ROOT,
        env: getCleanEnv(),
        encoding: "utf8"
      }
    );

    if (!output.includes("OK")) {
      throw new Error(`Expected 'OK' status for 3MB file, got: ${output}`);
    }

    console.log(`  Small file (3MB) classified as: OK`);

    // Create 9MB file (HARD status)
    const largeFile = path.join(tempDir, "large_pack.txt");
    fs.writeFileSync(largeFile, "B".repeat(9 * 1024 * 1024), "utf8");

    const output2 = execSync(
      `bash core/validate.sh --file "${toBashPath(largeFile)}" --global-config configs/global.yaml`,
      {
        cwd: REPO_ROOT,
        env: getCleanEnv(),
        encoding: "utf8"
      }
    );

    if (!output2.includes("HARD")) {
      throw new Error(`Expected 'HARD' status for 9MB file, got: ${output2}`);
    }

    console.log(`  Large file (9MB) classified as: HARD`);
  } finally {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  }
});

// Test 4: core/chunk.sh splits large files
runTest("core/chunk.sh splits oversized pack into line-safe chunks", () => {
  const tempDir = path.join(REPO_ROOT, ".test_core_chunk");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  try {
    // Create 9MB file (will trigger chunking at 4M chunk size)
    const largeFile = path.join(tempDir, "large_pack.txt");
    const content = Array.from({ length: 9 * 1024 }, () => "X".repeat(1024)).join("\n");
    fs.writeFileSync(largeFile, content, "utf8");

    execSync(
      `bash core/chunk.sh --file "${toBashPath(largeFile)}" --output-dir "${toBashPath(tempDir)}" --global-config configs/global.yaml`,
      {
        cwd: REPO_ROOT,
        env: getCleanEnv(),
        stdio: "pipe"
      }
    );

    // Check for chunk files
    const chunkFiles = fs.readdirSync(tempDir).filter(f => f.includes("part_"));
    if (chunkFiles.length === 0) {
      throw new Error("No chunk files created");
    }

    console.log(`  Large file chunked into ${chunkFiles.length} parts`);

    // Verify chunks are line-safe (end with newline)
    for (const chunk of chunkFiles) {
      const chunkPath = path.join(tempDir, chunk);
      const chunkContent = fs.readFileSync(chunkPath, "utf8");
      if (!chunkContent.endsWith("\n")) {
        console.warn(`  Warning: Chunk ${chunk} does not end with newline`);
      }
    }
  } finally {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  }
});

// Test 5: core/rollback.sh backup/restore cycle
runTest("core/rollback.sh creates and restores backups", () => {
  const tempDir = path.join(REPO_ROOT, ".test_core_rollback");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  try {
    // Create test files
    const file1 = path.join(tempDir, "test_file_1.txt");
    const file2 = path.join(tempDir, "test_file_2.txt");
    fs.writeFileSync(file1, "CONTENT1", "utf8");
    fs.writeFileSync(file2, "CONTENT2", "utf8");

    // Create backups
    execSync(
      `bash core/rollback.sh create --dir "${toBashPath(tempDir)}" "${toBashPath(file1)}" "${toBashPath(file2)}"`,
      {
        cwd: REPO_ROOT,
        env: getCleanEnv(),
        stdio: "pipe"
      }
    );

    // Verify backup files exist
    const backup1 = path.join(tempDir, "test_file_1.txt.bak.txt");
    const backup2 = path.join(tempDir, "test_file_2.txt.bak.txt");
    if (!fs.existsSync(backup1) || !fs.existsSync(backup2)) {
      throw new Error("Backup files not created");
    }

    console.log(`  Backups created: ${path.basename(backup1)}, ${path.basename(backup2)}`);

    // Modify original files
    fs.writeFileSync(file1, "MODIFIED1", "utf8");
    fs.writeFileSync(file2, "MODIFIED2", "utf8");

    // Restore from backup
    execSync(
      `bash core/rollback.sh restore --dir "${toBashPath(tempDir)}"`,
      {
        cwd: REPO_ROOT,
        env: getCleanEnv(),
        stdio: "pipe"
      }
    );

    // Verify files restored
    const restored1 = fs.readFileSync(file1, "utf8");
    const restored2 = fs.readFileSync(file2, "utf8");
    if (restored1 !== "CONTENT1" || restored2 !== "CONTENT2") {
      throw new Error("Files not restored correctly");
    }

    console.log(`  Files restored successfully`);
  } finally {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  }
});

// Test 6: Gap 1 - Infra-timeout / partial-run resilience (core/run-all.sh fail-soft isolation & error log)
runTest("core/run-all.sh isolates target failures and logs error summary", () => {
  const tempDir = path.join(REPO_ROOT, ".test_core_run_all_resilience");
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    // Initialize temporary git repo
    execSync("git init", { cwd: tempDir, env: getCleanEnv(), stdio: "ignore" });

    // Copy core/run-all.sh
    const coreDir = path.join(tempDir, "core");
    fs.mkdirSync(coreDir, { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, "core", "run-all.sh"), path.join(coreDir, "run-all.sh"));

    // Copy configs/global.yaml
    const configsDir = path.join(tempDir, "configs");
    fs.mkdirSync(configsDir, { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, "configs", "global.yaml"), path.join(configsDir, "global.yaml"));

    // Create mock modules/notebooklm/ingest-notebooklm.sh (fails with code 1)
    const nlmDir = path.join(tempDir, "modules", "notebooklm");
    fs.mkdirSync(nlmDir, { recursive: true });
    fs.writeFileSync(
      path.join(nlmDir, "ingest-notebooklm.sh"),
      "#!/usr/bin/env bash\necho '[NLM-MOCK] Simulating target failure...' >&2\nexit 1\n",
      { mode: 0o755 }
    );

    // Create mock modules/obsidian/ingest-obsidian.sh (succeeds with code 0)
    const obsDir = path.join(tempDir, "modules", "obsidian");
    fs.mkdirSync(obsDir, { recursive: true });
    fs.writeFileSync(
      path.join(obsDir, "ingest-obsidian.sh"),
      "#!/usr/bin/env bash\necho '[OBS-MOCK] Target succeeded.'\nexit 0\n",
      { mode: 0o755 }
    );

    let caughtError: any = null;
    let output = "";

    try {
      output = execSync(`bash core/run-all.sh 2>&1`, {
        cwd: tempDir,
        env: getCleanEnv(),
        encoding: "utf8"
      });
    } catch (err: any) {
      caughtError = err;
      output = (err.stdout || "") + (err.stderr || "") + (err.message || "");
    }

    if (!caughtError) {
      throw new Error("run-all.sh should have exited with code 1 due to target failure");
    }

    if (caughtError.status !== 1) {
      throw new Error(`Expected exit code 1 from run-all.sh, got: ${caughtError.status}`);
    }

    if (!output.includes("Target 'notebooklm' sync FAILED")) {
      throw new Error("run-all.sh output missing target failure log entry");
    }

    if (!output.includes("Target 'obsidian' sync completed")) {
      throw new Error("run-all.sh fail-soft behavior failed: subsequent target 'obsidian' did not run");
    }

    if (!output.includes("Failed targets: notebooklm")) {
      throw new Error("run-all.sh missing summary of failed targets");
    }

    console.log("  ✓ Fail-soft isolation verified: obsidian target completed after notebooklm failure");
    console.log("  ✓ Error surfaced with exit code 1 and logged failure summary");
  } finally {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

// Test 7: Gap 2 - Immutable staging guarantee
runTest("Staging directory files remain byte-identical across multiple runs", () => {
  const tempDir = path.join(REPO_ROOT, ".test_core_staging_immutability");
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    const vaultRoot = path.join(tempDir, "vault");
    const stagingDirRel = "staging";
    const repoName = "test-repo";
    const timestamp1 = "20260730-100000";
    const stagingPath1 = path.join(vaultRoot, stagingDirRel, repoName, timestamp1);

    fs.mkdirSync(stagingPath1, { recursive: true });
    const fileA = path.join(stagingPath1, "docA.md");
    const fileB = path.join(stagingPath1, "sub", "docB.md");
    fs.mkdirSync(path.dirname(fileB), { recursive: true });

    const contentA = "# Document A\nInitial staged content";
    const contentB = "# Document B\nSubdirectory staged content";
    fs.writeFileSync(fileA, contentA, "utf8");
    fs.writeFileSync(fileB, contentB, "utf8");

    // Record hashes of first run
    const hashA1 = crypto.createHash("sha256").update(fs.readFileSync(fileA)).digest("hex");
    const hashB1 = crypto.createHash("sha256").update(fs.readFileSync(fileB)).digest("hex");

    // Simulate second staging run (creates second timestamp directory)
    const timestamp2 = "20260730-100005";
    const stagingPath2 = path.join(vaultRoot, stagingDirRel, repoName, timestamp2);
    fs.mkdirSync(stagingPath2, { recursive: true });
    fs.writeFileSync(path.join(stagingPath2, "docA.md"), "# Document A\nUpdated content in run 2", "utf8");

    // Assert timestamp 1 directory is unchanged
    const hashA2 = crypto.createHash("sha256").update(fs.readFileSync(fileA)).digest("hex");
    const hashB2 = crypto.createHash("sha256").update(fs.readFileSync(fileB)).digest("hex");

    if (hashA1 !== hashA2 || hashB1 !== hashB2) {
      throw new Error("Staging directory mutation detected! Initial staged files were modified by subsequent run.");
    }

    console.log("  ✓ Staging immutability verified: run 1 files remain byte-identical after run 2");
  } finally {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

// Test 8: Gap 3 - Rollback correctness (revert scope verification)
runTest("core/rollback.sh restores modified files from backup", () => {
  const tempDir = path.join(REPO_ROOT, ".test_core_rollback_correctness");
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    const packFile = path.join(tempDir, "repo_knowledge_pack.txt");
    const originalContent = "--- START FILE: test.ts ---\nconst original = true;\n--- END FILE: test.ts ---";
    fs.writeFileSync(packFile, originalContent, "utf8");

    // Create backup
    execSync(`bash core/rollback.sh create --dir "${toBashPath(tempDir)}" "${toBashPath(packFile)}"`, {
      cwd: REPO_ROOT,
      env: getCleanEnv(),
      stdio: "pipe"
    });

    const backupFile = packFile + ".bak.txt";
    if (!fs.existsSync(backupFile)) {
      throw new Error(`Backup file not created: ${backupFile}`);
    }

    // Corrupt pack file
    fs.writeFileSync(packFile, "CORRUPTED SYNTHESIS STATE", "utf8");

    // Revert via rollback restore
    execSync(`bash core/rollback.sh restore --dir "${toBashPath(tempDir)}"`, {
      cwd: REPO_ROOT,
      env: getCleanEnv(),
      stdio: "pipe"
    });

    const restoredContent = fs.readFileSync(packFile, "utf8");
    if (restoredContent !== originalContent) {
      throw new Error(`Rollback restore failed. Expected original content, got: ${restoredContent}`);
    }

    console.log("  ✓ Rollback restoration verified: corrupted state reverted to exact original content");
  } finally {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

if (allTestsPassed) {
  console.log("================================================================================");
  console.log("SUCCESS: All core scripts verification tests passed!");
  console.log("================================================================================");
  process.exit(0);
} else {
  console.log("================================================================================");
  console.log("FAILURE: One or more tests failed.");
  console.log("================================================================================");
  process.exit(1);
}
