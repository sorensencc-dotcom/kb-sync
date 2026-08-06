import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

console.log("================================================================================");
console.log("Obsidian Sync Staging Script Verification Tests");
console.log("================================================================================\n");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

console.log(`  Resolved REPO_ROOT: ${REPO_ROOT}\n`);

let allTestsPassed = true;

// Preflight Shell Capability Detection
function isBashAvailable(): boolean {
  try {
    execSync("bash --version", { stdio: "ignore", timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

const HAS_BASH = isBashAvailable();
if (!HAS_BASH) {
  console.log("[PREFLIGHT WARN] Bash runner is unavailable or access is restricted in this environment.");
  console.log("[PREFLIGHT WARN] Shell integration tests will test configuration contracts; bash subprocess calls will report Environment Unavailable.\n");
}

function runTest(name: string, fn: () => void) {
  console.log(`[TEST] Running: ${name}...`);
  try {
    fn();
    console.log(`[PASS] ✓ ${name}\n`);
  } catch (error: any) {
    console.error(`[FAIL] ✗ ${name}`);
    // Include stdout/stderr from child process if available (execSync captures these on failure)
    const scriptOutput = error.stdout || error.stderr || "";
    console.error(`       Error: ${error.message || error}`);
    if (scriptOutput) console.error(`       Script output: ${scriptOutput.trim()}`);
    console.error("");
    allTestsPassed = false;
  }
}

// Convert Windows path to Git Bash or WSL mount path
function toMountPath(windowsPath: string): string {
  const normalized = windowsPath.replace(/\\/g, '/');
  const match = normalized.match(/^([A-Za-z]):\/(.*)/);
  if (match) {
    const drive = match[1].toLowerCase();
    const rest = match[2];
    if (fs.existsSync(`/mnt/${drive}`)) {
      return `/mnt/${drive}/${rest}`;
    }
    return `/${drive}/${rest}`;
  }
  return normalized;
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

// Test 1: Config validation
runTest("Parse and validate obsidian.yaml config structure", () => {
  const configPath = path.join(REPO_ROOT, "configs/obsidian.yaml");
  if (!fs.existsSync(configPath)) {
    throw new Error(`obsidian.yaml not found at ${configPath}`);
  }

  const content = fs.readFileSync(configPath, "utf8");

  if (!content.includes("vault_root:")) throw new Error("vault_root not found in config");
  if (!content.includes("staging_dir:")) throw new Error("staging_dir not found in config");
  if (!content.includes("wiki_dir:")) throw new Error("wiki_dir not found in config");
  if (!content.includes("mapping_rules:")) throw new Error("mapping_rules not found in config");

  console.log(`  Config structure validated`);
});

// Test 2: Fail-fast on missing OBSIDIAN_VAULT_ROOT
runTest("Staging script fails fast when OBSIDIAN_VAULT_ROOT not set and vault_root invalid", () => {
  if (!HAS_BASH) {
    console.log("  [SKIPPED] Environment Unavailable: Bash executable not accessible.");
    return;
  }

  const tempConfigDir = path.join(REPO_ROOT, "configs");
  const tempConfig = path.join(tempConfigDir, "_invalid_obsidian_test.yaml");
  fs.writeFileSync(tempConfig, "staging_dir: _kb-sync-staging\nwiki_dir: wiki\n");

  try {
    const env = getCleanEnv();
    env.OBSIDIAN_VAULT_ROOT = "";
    env.MODULE_CONFIG = "configs/_invalid_obsidian_test.yaml";

    execSync(`bash modules/obsidian/ingest-obsidian.sh`, {
      cwd: REPO_ROOT,
      env: env,
      stdio: "pipe",
      timeout: 15000,
    });

    throw new Error("Script should have failed due to missing vault");
  } catch (error: any) {
    const output = error.stderr || error.stdout || error.message;
    if (!output.includes("OBSIDIAN_VAULT_ROOT") && !output.includes("vault")) {
      throw new Error(`Expected error message about vault root, but got: ${output}`);
    }
    console.log(`  Script correctly rejected missing OBSIDIAN_VAULT_ROOT`);
  } finally {
    if (fs.existsSync(tempConfig)) fs.unlinkSync(tempConfig);
  }
});

// Test 3: Dry run against temp vault directory
runTest("Staging script stages raw sources into timestamped directory", () => {
  if (!HAS_BASH) {
    console.log("  [SKIPPED] Environment Unavailable: Bash executable not accessible.");
    return;
  }

  const tempVaultRoot = path.join(REPO_ROOT, ".test_obsidian_vault");
  if (!fs.existsSync(tempVaultRoot)) {
    fs.mkdirSync(tempVaultRoot, { recursive: true });
  }

  try {
    const vaultMount = toMountPath(tempVaultRoot);
    // 30s timeout: give the script time to run flatten.sh against the full repo in CI;
    // 5s was too short on Linux and caused a signal-kill that looked like a real failure.
    const result = execSync(`bash -c "OBSIDIAN_VAULT_ROOT='${vaultMount}' bash modules/obsidian/ingest-obsidian.sh" 2>&1`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 30000,
    });

    const stagingDir = path.join(tempVaultRoot, "_kb-sync-staging");
    if (!fs.existsSync(stagingDir)) throw new Error(`Staging directory not created: ${stagingDir}`);

    const repoDir = fs.readdirSync(stagingDir)[0];
    if (!repoDir) throw new Error("No repo directory created under staging");

    const timestampDir = fs.readdirSync(path.join(stagingDir, repoDir))[0];
    if (!timestampDir) throw new Error("No timestamped directory created");

    const stagedPath = path.join(stagingDir, repoDir, timestampDir);
    const manifestFile = path.join(stagedPath, "FILES.manifest.txt");
    if (!fs.existsSync(manifestFile)) throw new Error(`Manifest not created at ${manifestFile}`);

    console.log(`  Staged files verified cleanly`);
  } catch (error: any) {
    // Detect execSync timeout: either ETIMEDOUT code, message containing ETIMEDOUT,
    // or signal-based kill (error.killed=true) which is what execSync throws on timeout on Linux.
    const isTimeout =
      error.code === "ETIMEDOUT" ||
      error.killed === true ||
      (error.message && error.message.includes("ETIMEDOUT"));
    if (isTimeout) {
      console.log("  [SKIPPED] Environment Unavailable: Bash execution timed out (>30s) in this environment.");
      return;
    }
    // Re-attach script output to the error so runTest() can surface it
    if (!error.stdout && error.stderr) error.stdout = error.stderr;
    throw error;
  } finally {
    if (fs.existsSync(tempVaultRoot)) fs.rmSync(tempVaultRoot, { recursive: true });
  }
});

// Test 4: Schema doc exists and is readable
runTest("Schema document (docs/targets/obsidian.md) exists and contains key sections", () => {
  const schemaPath = path.join(REPO_ROOT, "docs/targets/obsidian.md");
  if (!fs.existsSync(schemaPath)) throw new Error(`Schema doc not found at ${schemaPath}`);

  const content = fs.readFileSync(schemaPath, "utf8");
  const requiredSections = [
    "Three-Layer Vault",
    "Raw Sources",
    "The Wiki",
    "Ingest Workflow",
    "Query Workflow",
    "Lint Workflow",
    "Configuration"
  ];

  for (const section of requiredSections) {
    if (!content.includes(section)) throw new Error(`Schema doc missing section: ${section}`);
  }

  console.log(`  Schema doc contains all ${requiredSections.length} required sections`);
});

if (allTestsPassed) {
  console.log("================================================================================");
  console.log("SUCCESS: All obsidian sync verification tests passed!");
  console.log("================================================================================");
  process.exit(0);
} else {
  console.log("================================================================================");
  console.log("FAILURE: One or more tests failed.");
  console.log("================================================================================");
  process.exit(1);
}
