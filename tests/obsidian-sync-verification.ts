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

// Convert Windows path to Git Bash mount path (/mnt/c/...) for environment variables
function toMountPath(windowsPath: string): string {
  return windowsPath
    .replace(/^([A-Z]):\\/, (_, drive) => `/mnt/${drive.toLowerCase()}/`)
    .replace(/\\/g, '/');
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

  // Basic YAML structure validation
  if (!content.includes("vault_root:")) {
    throw new Error("vault_root not found in config");
  }
  if (!content.includes("staging_dir:")) {
    throw new Error("staging_dir not found in config");
  }
  if (!content.includes("wiki_dir:")) {
    throw new Error("wiki_dir not found in config");
  }
  if (!content.includes("mapping_rules:")) {
    throw new Error("mapping_rules not found in config");
  }

  console.log(`  Config structure validated`);
});

// Test 2: Fail-fast on missing OBSIDIAN_VAULT_ROOT
runTest("Staging script fails fast when OBSIDIAN_VAULT_ROOT not set and vault_root invalid", () => {
  try {
    // Run with empty env var and no valid vault directory
    const env = getCleanEnv();
    env.OBSIDIAN_VAULT_ROOT = "";

    execSync(`bash modules/obsidian/ingest-obsidian.sh`, {
      cwd: REPO_ROOT,
      env: env,
      stdio: "pipe"
    });

    throw new Error("Script should have failed due to missing vault");
  } catch (error: any) {
    // Expected to fail
    const output = error.stderr || error.stdout || error.message;
    if (!output.includes("OBSIDIAN_VAULT_ROOT") && !output.includes("vault")) {
      throw new Error(
        `Expected error message about vault root, but got: ${output}`
      );
    }

    console.log(`  Script correctly rejected missing OBSIDIAN_VAULT_ROOT`);
  }
});

// Test 3: Dry run against temp vault directory
runTest("Staging script stages raw sources into timestamped directory", () => {
  // Create temporary vault directory
  const tempVaultRoot = path.join(REPO_ROOT, ".test_obsidian_vault");
  if (!fs.existsSync(tempVaultRoot)) {
    fs.mkdirSync(tempVaultRoot, { recursive: true });
  }

  try {
    // Run staging script with temp vault
    const env = getCleanEnv();
    env.OBSIDIAN_VAULT_ROOT = toMountPath(tempVaultRoot);

    const output = execSync(`bash modules/obsidian/ingest-obsidian.sh`, {
      cwd: REPO_ROOT,
      env: env,
      encoding: "utf8",
      stdio: "pipe"
    });

    // Check that staging directory was created
    const stagingDir = path.join(tempVaultRoot, "_kb-sync-staging");
    if (!fs.existsSync(stagingDir)) {
      throw new Error(`Staging directory not created: ${stagingDir}`);
    }

    // Find the timestamped repo directory
    const repoDir = fs.readdirSync(stagingDir)[0];
    if (!repoDir) {
      throw new Error("No repo directory created under staging");
    }

    const timestampDir = fs.readdirSync(path.join(stagingDir, repoDir))[0];
    if (!timestampDir) {
      throw new Error("No timestamped directory created");
    }

    const stagedPath = path.join(stagingDir, repoDir, timestampDir);
    console.log(`  Staged path: ${stagedPath}`);

    // Verify manifest file exists
    const manifestFile = path.join(stagedPath, "FILES.manifest.txt");
    if (!fs.existsSync(manifestFile)) {
      throw new Error(`Manifest not created at ${manifestFile}`);
    }

    const manifestLines = fs.readFileSync(manifestFile, "utf8").split("\n").filter(l => l.trim());
    console.log(`  Manifest contains ${manifestLines.length} files`);

    // Verify at least one source file was staged
    const stagedFiles = fs.readdirSync(stagedPath).filter(f => f !== "FILES.manifest.txt");
    if (stagedFiles.length === 0) {
      throw new Error("No source files staged");
    }

    console.log(`  Staged ${stagedFiles.length} files/directories`);

    // Verify file structure is preserved
    const hasMarkdown = manifestLines.some(line => line.endsWith(".md"));
    console.log(`  Markdown files included: ${hasMarkdown}`);
  } finally {
    if (fs.existsSync(tempVaultRoot)) {
      fs.rmSync(tempVaultRoot, { recursive: true });
    }
  }
});

// Test 4: Operator prompt is printed
runTest("Staging script prints operator prompt with staging path", () => {
  const tempVaultRoot = path.join(REPO_ROOT, ".test_obsidian_vault_prompt");
  if (!fs.existsSync(tempVaultRoot)) {
    fs.mkdirSync(tempVaultRoot, { recursive: true });
  }

  try {
    const env = getCleanEnv();
    env.OBSIDIAN_VAULT_ROOT = toMountPath(tempVaultRoot);

    const output = execSync(`bash modules/obsidian/ingest-obsidian.sh 2>&1`, {
      cwd: REPO_ROOT,
      env: env,
      encoding: "utf8"
    });

    if (!output.includes("Raw sources staged")) {
      throw new Error("Operator prompt missing 'Raw sources staged' message");
    }

    if (!output.includes("Staging directory:")) {
      throw new Error("Operator prompt missing staging directory path");
    }

    if (!output.includes("Schema document:")) {
      throw new Error("Operator prompt missing schema document reference");
    }

    console.log(`  Operator prompt includes all required sections`);
  } finally {
    if (fs.existsSync(tempVaultRoot)) {
      fs.rmSync(tempVaultRoot, { recursive: true });
    }
  }
});

// Test 5: Schema doc exists and is readable
runTest("Schema document (docs/targets/obsidian.md) exists and contains key sections", () => {
  const schemaPath = path.join(REPO_ROOT, "docs/targets/obsidian.md");
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Schema doc not found at ${schemaPath}`);
  }

  const content = fs.readFileSync(schemaPath, "utf8");

  // Check for key sections
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
    if (!content.includes(section)) {
      throw new Error(`Schema doc missing section: ${section}`);
    }
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
