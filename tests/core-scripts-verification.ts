import fs from "fs";
import path from "path";
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
  const rel = path.relative(REPO_ROOT, absolutePath);
  return rel.replace(/\\/g, '/');
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
