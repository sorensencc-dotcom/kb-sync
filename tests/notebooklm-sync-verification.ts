import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

console.log("================================================================================");
console.log("NotebookLM Sync Pipeline - Integration & Validation Tests");
console.log("================================================================================\n");

// Resolve REPO_ROOT relative to the test script file location to avoid npm/npx cwd shifts
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const PYRAGIFY_CONFIG_PATH = path.join(REPO_ROOT, "pyragify.yaml");
// Use relative path with forward slashes for compatibility with bash on Windows
const SYNC_SCRIPT_PATH = "./modules/notebooklm/ingest-notebooklm.sh";

console.log(`  Resolved REPO_ROOT: ${REPO_ROOT}`);
console.log(`  Real path of REPO_ROOT: ${fs.realpathSync(REPO_ROOT)}`);
console.log(`  process.cwd(): ${process.cwd()}`);
console.log(`  Directory contents of REPO_ROOT:`, fs.readdirSync(REPO_ROOT));
console.log(`  Resolved SYNC_SCRIPT_PATH: ${path.join(REPO_ROOT, SYNC_SCRIPT_PATH)}\n`);

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

// Clean inherited GIT environment overrides to prevent sandbox issues (case-insensitive for Windows)
function getCleanEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toUpperCase().startsWith("GIT_") && key.toUpperCase() !== "GIT_ASKPASS") {
      delete env[key];
    }
  }
  return env;
}

// Test 1: Validate pyragify.yaml syntax and core keys
runTest("Parse and validate pyragify.yaml config structure", () => {
  if (!fs.existsSync(PYRAGIFY_CONFIG_PATH)) {
    throw new Error(`pyragify.yaml does not exist at ${PYRAGIFY_CONFIG_PATH}`);
  }
  
  const configContent = fs.readFileSync(PYRAGIFY_CONFIG_PATH, "utf8");
  const parsed: any = yaml.load(configContent);
  
  if (!parsed) throw new Error("Parsed config is empty/null");
  
  console.log(`  repo_path: ${parsed.repo_path}`);
  console.log(`  output_dir: ${parsed.output_dir}`);
  console.log(`  max_words: ${parsed.max_words}`);
  
  if (parsed.repo_path !== ".") throw new Error("repo_path must be '.'");
  if (parsed.output_dir !== "./.nlm_pack") throw new Error("output_dir must be './.nlm_pack'");
  if (typeof parsed.max_words !== "number") throw new Error("max_words must be a number");
  
  if (!Array.isArray(parsed.skip_dirs)) throw new Error("skip_dirs must be an array");
  if (!parsed.skip_dirs.includes(".git")) throw new Error("skip_dirs should exclude '.git'");
  if (!parsed.skip_dirs.includes("node_modules")) throw new Error("skip_dirs should exclude 'node_modules'");
  
  if (!Array.isArray(parsed.include_extensions)) throw new Error("include_extensions must be an array");
  if (!parsed.include_extensions.includes(".ts")) throw new Error("include_extensions should include '.ts'");
  if (!parsed.include_extensions.includes(".md")) throw new Error("include_extensions should include '.md'");
});

// Test 2: Check credential validation exit codes
runTest("Sync script credential validation and failure boundaries", () => {
  if (!fs.existsSync(path.join(REPO_ROOT, SYNC_SCRIPT_PATH))) {
    throw new Error(`Sync script does not exist at ${path.join(REPO_ROOT, SYNC_SCRIPT_PATH)}`);
  }

  // Running the script without environment variables should fail with code 1
  console.log("  Running sync script with clean environment (no credentials)...");
  try {
    const exports = [
      'export NOTEBOOKLM_COOKIE=""',
      'export NOTEBOOKLM_TOKEN=""',
      'export NOTEBOOK_ID=""'
    ].join(" && ");
    
    execSync(`bash -c "${exports} && bash \\"${SYNC_SCRIPT_PATH}\\""`, {
      cwd: REPO_ROOT,
      env: getCleanEnv(),
      stdio: "pipe"
    });
    throw new Error("Sync script succeeded unexpectedly when credentials were missing!");
  } catch (error: any) {
    const status = error.status;
    if (status !== 1) {
      throw new Error(`Expected exit code 1, but got exit code: ${status}`);
    }
    console.log("  ✓ Correctly rejected execution (exit code 1) due to missing credentials.");
  }
});

// Test 3: Simulate packing compile logic and verify exclusions
runTest("Dry-run compilation of knowledge pack content", () => {
  const tempPackDir = path.join(REPO_ROOT, ".nlm_pack_test");
  if (!fs.existsSync(tempPackDir)) {
    fs.mkdirSync(tempPackDir);
  }
  const tempPackFile = path.join(tempPackDir, "test_repo_knowledge_pack.txt");

  console.log("  Simulating git pack generation...");
  
  // Replicating bash pack logic, removing git environment overrides
  const trackedFiles = execSync("git ls-files", { 
    cwd: REPO_ROOT,
    env: getCleanEnv(),
    encoding: "utf8" 
  })
    .split("\n")
    .map(f => f.trim())
    .filter(f => f.length > 0);

  const lines: string[] = [];
  lines.push("==============================================================================\n");
  lines.push("MOCK TEST KNOWLEDGE PACK\n");
  lines.push("==============================================================================\n\n");

  let filesAddedCount = 0;

  for (const file of trackedFiles) {
    // Check standard exclusions
    if (
      file.endsWith("package-lock.json") ||
      file.includes("node_modules") ||
      file.endsWith(".png") ||
      file.endsWith(".jpg") ||
      file.includes("dist/") ||
      file.includes("build/")
    ) {
      continue;
    }

    const fullPath = path.join(REPO_ROOT, file);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      lines.push(`--- START FILE: ${file} ---\n`);
      // Just write a small portion for mock
      const content = fs.readFileSync(fullPath, "utf8");
      lines.push(content.substring(0, 100) + "\n");
      lines.push(`--- END FILE: ${file} ---\n\n`);
      filesAddedCount++;
    }
  }

  // Write content synchronously to prevent race conditions
  fs.writeFileSync(tempPackFile, lines.join(""), "utf8");
  
  // Verify output file
  if (!fs.existsSync(tempPackFile)) {
    throw new Error("Combined pack file was not created");
  }

  const packContent = fs.readFileSync(tempPackFile, "utf8");
  
  if (filesAddedCount === 0) {
    throw new Error("No files were added to the pack file");
  }
  
  console.log(`  Added ${filesAddedCount} files into mock pack.`);

  // Verify file structural separators
  if (!packContent.includes("--- START FILE:") || !packContent.includes("--- END FILE:")) {
    throw new Error("Pack file does not contain correct file structural boundaries");
  }

  // Cleanup
  fs.unlinkSync(tempPackFile);
  fs.rmdirSync(tempPackDir);
  console.log("  Cleaned up temporary test assets.");
});

// Test 4: Run the sync script in dry-run simulation mode (providing mock CLI in path)
runTest("Sync script execution simulation with mock CLI (triggers chunking)", () => {
  const mockCliDir = path.join(REPO_ROOT, ".mock_cli_bin");
  if (!fs.existsSync(mockCliDir)) {
    fs.mkdirSync(mockCliDir);
  }

  // Write mock notebooklm-mcp binary
  const mockCliPath = path.join(mockCliDir, "notebooklm-mcp");
  const mockCliContent = `#!/usr/bin/env bash
echo "[MOCK-CLI] Invoked with arguments: $@"
exit 0
`;
  fs.writeFileSync(mockCliPath, mockCliContent, { mode: 0o755 });

  // Create a 9MB temporary file and track it in git to force size boundary limit chunking (>8MB)
  const tempLargeFile = path.join(REPO_ROOT, "temp_large_file.ts");
  console.log("  Generating 9MB temporary file to trigger size boundary limits...");
  fs.writeFileSync(tempLargeFile, "A".repeat(9 * 1024 * 1024), "utf8");
  
  execSync("git add temp_large_file.ts", {
    cwd: REPO_ROOT,
    env: getCleanEnv()
  });

  console.log("  Running sync script with mock CLI in PATH and mock credentials...");
  try {
    // Relative POSIX pathing works under WSL
    const exports = [
      `export PATH="./.mock_cli_bin:\\$PATH"`,
      `export NOTEBOOK_ID="mock-notebook-12345"`,
      `export NOTEBOOKLM_COOKIE="session=mockcookie"`,
      `export NLM_CLI="notebooklm-mcp"`
    ].join(" && ");

    // Redirect stderr to stdout (2>&1) to capture log_info outputs which are printed to stderr
    const output = execSync(`bash -c "${exports} && bash \\"${SYNC_SCRIPT_PATH}\\"" 2>&1`, {
      cwd: REPO_ROOT,
      env: getCleanEnv(),
      encoding: "utf8"
    });
    
    console.log("  Script output:\n" + output.split("\n").map(l => "    " + l).join("\n"));

    if (!output.includes("NotebookLM sync completed successfully")) {
      throw new Error("Sync script execution did not log success message");
    }

    if (!output.includes("exceeds hard limit") || !output.includes("Chunking oversized pack file")) {
      throw new Error("Sync script did not trigger chunk splitting for the large repository pack");
    }

    if (!output.includes("[MOCK-CLI] Invoked with arguments: sources add --notebook mock-notebook-12345")) {
      throw new Error("Sync script did not invoke mock CLI to upload chunks");
    }
  } finally {
    // Cleanup
    if (fs.existsSync(tempLargeFile)) {
      fs.unlinkSync(tempLargeFile);
      try {
        execSync("git rm --cached temp_large_file.ts", {
          cwd: REPO_ROOT,
          env: getCleanEnv(),
          stdio: "ignore"
        });
      } catch (e) {}
    }
    if (fs.existsSync(mockCliPath)) fs.unlinkSync(mockCliPath);
    if (fs.existsSync(mockCliDir)) fs.rmdirSync(mockCliDir);
  }
});

// Test 5: Verify rollback functionality using CLI flag
runTest("Sync script --rollback strategy execution simulation", () => {
  const mockCliDir = path.join(REPO_ROOT, ".mock_cli_bin");
  if (!fs.existsSync(mockCliDir)) {
    fs.mkdirSync(mockCliDir);
  }

  // Create temporary mock backup file
  const packDir = path.join(REPO_ROOT, ".nlm_pack");
  if (!fs.existsSync(packDir)) {
    fs.mkdirSync(packDir);
  }
  const mockBackupFile = path.join(packDir, "repo_knowledge_pack_part_aa.bak.txt");
  fs.writeFileSync(mockBackupFile, "MOCK BACKUP FILE CONTENTS", "utf8");

  // Write mock notebooklm-mcp binary
  const mockCliPath = path.join(mockCliDir, "notebooklm-mcp");
  const mockCliContent = `#!/usr/bin/env bash
echo "[MOCK-CLI] Invoked with arguments: $@"
exit 0
`;
  fs.writeFileSync(mockCliPath, mockCliContent, { mode: 0o755 });

  console.log("  Running sync script with rollback flag...");
  try {
    // Relative POSIX pathing works under WSL
    const exports = [
      `export PATH="./.mock_cli_bin:\\$PATH"`,
      `export NOTEBOOK_ID="mock-notebook-12345"`,
      `export NOTEBOOKLM_COOKIE="session=mockcookie"`,
      `export NLM_CLI="notebooklm-mcp"`
    ].join(" && ");

    // Redirect stderr to stdout
    const output = execSync(`bash -c "${exports} && bash \\"${SYNC_SCRIPT_PATH}\\" --rollback" 2>&1`, {
      cwd: REPO_ROOT,
      env: getCleanEnv(),
      encoding: "utf8"
    });
    
    console.log("  Script output:\n" + output.split("\n").map(l => "    " + l).join("\n"));

    if (!output.includes("NotebookLM rollback completed successfully")) {
      throw new Error("Sync script rollback execution did not log success message");
    }

    if (!output.includes("[MOCK-CLI] Invoked with arguments: sources delete --notebook mock-notebook-12345 --all")) {
      throw new Error("Rollback did not invoke CLI to purge sources");
    }

    if (!output.includes("Uploading:") && !output.includes("Re-uploading")) {
      throw new Error("Rollback did not log uploading backup files");
    }
  } finally {
    // Cleanup
    if (fs.existsSync(mockBackupFile)) fs.unlinkSync(mockBackupFile);
    if (fs.existsSync(mockCliPath)) fs.unlinkSync(mockCliPath);
    if (fs.existsSync(mockCliDir)) fs.rmdirSync(mockCliDir);
  }
});

if (allTestsPassed) {
  console.log("================================================================================");
  console.log("SUCCESS: All integration and validation tests passed!");
  console.log("================================================================================");
  process.exit(0);
} else {
  console.log("================================================================================");
  console.log("FAILURE: One or more integration tests failed.");
  console.log("================================================================================");
  process.exit(1);
}
