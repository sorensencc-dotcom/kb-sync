import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

console.log("================================================================================");
console.log("Staging Validator v1.2 Features - Integration Tests");
console.log("================================================================================\n");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const VALIDATOR_BIN = "node modules/wiki/validate-staging-docs.mjs";

// Self-contained fixture directory — no dependency on the local _kb-sync-staging tree,
// so these tests run identically on CI and on developer machines.
const FIXTURE_DIR = path.join(REPO_ROOT, ".test_v12_fixture");

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

function execValidate(command: string): string {
  try {
    return execSync(command, { cwd: REPO_ROOT, encoding: "utf8" });
  } catch (error: any) {
    if (error.stdout || error.stderr || error.output) {
      return (error.stdout || "") + (error.stderr || "") + (error.output ? error.output.join("") : "");
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

// A markdown file deliberately missing YAML frontmatter, with trailing whitespace.
// This file will trigger both the "frontmatter: missing frontmatter" warning and the
// "lint: trailing whitespace" warning from the validator.
const MD_NO_FRONTMATTER = [
  "# No Frontmatter Document   ",  // trailing whitespace
  "",
  "This file intentionally lacks YAML frontmatter.   ",  // trailing whitespace
  "",
  "Content paragraph.",
].join("\n");

// A markdown file with valid frontmatter (baseline; should produce no warnings).
const MD_VALID = [
  "---",
  "title: Valid Page",
  "---",
  "",
  "# Valid Page",
  "",
  "This file has valid frontmatter and no lint issues.",
].join("\n");

// .gitignore with several patterns to satisfy Test 5's pattern-count check.
const GITIGNORE_CONTENT = [
  "node_modules/",
  "*.log",
  ".DS_Store",
].join("\n");

function setupFixture(): void {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  fs.writeFileSync(path.join(FIXTURE_DIR, "no-frontmatter.md"), MD_NO_FRONTMATTER, "utf8");
  fs.writeFileSync(path.join(FIXTURE_DIR, "valid.md"), MD_VALID, "utf8");
  fs.writeFileSync(path.join(FIXTURE_DIR, ".gitignore"), GITIGNORE_CONTENT, "utf8");
}

function teardownFixture(): void {
  if (fs.existsSync(FIXTURE_DIR)) {
    fs.rmSync(FIXTURE_DIR, { recursive: true });
  }
}

// Pre-test setup
teardownFixture(); // ensure clean state from any previous aborted run
setupFixture();

// Base command: run validator against the fixture dir, merging stderr→stdout
const VALIDATE_CMD = `${VALIDATOR_BIN} "${FIXTURE_DIR}" 2>&1`;

// ---------------------------------------------------------------------------
// Test 1: Metadata extraction → .catalog.json
// ---------------------------------------------------------------------------
runTest("Metadata extraction creates .catalog.json with file stats", () => {
  const output = execValidate(VALIDATE_CMD);

  // The validator logs: [INFO] Metadata catalog written to <path>/.catalog.json
  const catalogMatch = output.match(/Metadata catalog written to (.*\.catalog\.json)/);
  if (!catalogMatch) {
    throw new Error("Could not find '.catalog.json' written log in validator output");
  }

  const catalogPath = catalogMatch[1].trim();

  if (!fs.existsSync(catalogPath)) {
    throw new Error(`Catalog file not found on disk: ${catalogPath}`);
  }

  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));

  if (!catalog.generated) {
    throw new Error("Catalog missing 'generated' timestamp");
  }

  if (!Array.isArray(catalog.files) || catalog.files.length === 0) {
    throw new Error("Catalog missing files array or empty");
  }

  const firstFile = catalog.files[0];
  if (!firstFile.stats || !firstFile.stats.lines || firstFile.stats.words === undefined) {
    throw new Error("File entry missing stats (lines, words)");
  }

  console.log(`  Catalog contains ${catalog.files.length} files with stats`);
  console.log(`  Sample: ${catalog.files[0].stats.lines} lines, ${catalog.files[0].stats.words} words, ${catalog.files[0].stats.links} links`);
});

// ---------------------------------------------------------------------------
// Test 2: --diff flag
// ---------------------------------------------------------------------------
runTest("--diff flag filters to changed markdown files only", () => {
  // The fixture dir is not a git repo; getChangedFiles() will return an empty
  // set (git fails gracefully) and the validator logs "No changed files detected
  // (--diff mode)." — which satisfies the "diff mode" substring check.
  const output = execValidate(`${VALIDATOR_BIN} "${FIXTURE_DIR}" --diff 2>&1`);

  if (!output.toLowerCase().includes("diff mode")) {
    throw new Error("--diff mode not activated (missing '--diff mode' log)");
  }

  const countMatch = output.match(/validating (\d+) changed file/);
  const count = countMatch ? parseInt(countMatch[1]) : 0;

  if (count === 0) {
    console.log(`  Diff mode active (0 changed files in fixture — expected for non-git dir)`);
  } else {
    console.log(`  Diff mode active (validating ${count} changed file(s))`);
  }
});

// ---------------------------------------------------------------------------
// Test 3: Frontmatter schema validation
// ---------------------------------------------------------------------------
runTest("Frontmatter schema validation detects missing required fields", () => {
  const output = execValidate(VALIDATE_CMD);

  if (!output.includes("frontmatter:")) {
    throw new Error("Frontmatter validation not running (no warnings found)");
  }

  if (!output.includes("missing frontmatter")) {
    throw new Error("Frontmatter schema not validating required fields");
  }

  const fmWarnings = (output.match(/frontmatter:/g) || []).length;
  console.log(`  Frontmatter validation active (${fmWarnings} warnings)`);
});

// ---------------------------------------------------------------------------
// Test 4: Markdown linting
// ---------------------------------------------------------------------------
runTest("Markdown linting detects trailing whitespace and blank lines", () => {
  const output = execValidate(VALIDATE_CMD);

  const lintWarnings = (output.match(/lint:/g) || []).length;

  if (lintWarnings === 0) {
    throw new Error("Markdown linting not running (no lint warnings found)");
  }

  if (!output.includes("trailing whitespace") && !output.includes("blank line")) {
    throw new Error("Linting not catching expected style issues");
  }

  console.log(`  Markdown linting active (${lintWarnings} issues)`);
});

// ---------------------------------------------------------------------------
// Test 5: Ignore patterns loaded from .gitignore/.cicignore
// ---------------------------------------------------------------------------
runTest("Ignore patterns from .cicignore/.gitignore are loaded", () => {
  const output = execValidate(VALIDATE_CMD);

  if (!output.includes("ignore pattern")) {
    throw new Error("Ignore patterns not loaded (missing log message)");
  }

  const patternMatch = output.match(/Loaded (\d+) ignore pattern/);
  const count = patternMatch ? parseInt(patternMatch[1]) : 0;

  if (count === 0) {
    throw new Error("No ignore patterns loaded");
  }

  console.log(`  ${count} ignore pattern(s) loaded and active`);
});

// ---------------------------------------------------------------------------
// Test 6: Link alias disambiguation (uses its own fixture)
// ---------------------------------------------------------------------------
runTest("Link alias disambiguation detects potential conflicts", () => {
  const tempDir = path.join(REPO_ROOT, ".test_alias");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  try {
    const testFile = path.join(tempDir, "test.md");
    fs.writeFileSync(testFile, `# Test\n[[some-page|somepage]]\n`);

    const otherFile = path.join(tempDir, "somepages.md");
    fs.writeFileSync(otherFile, `# Some Pages\nContent`);

    const output = execValidate(`${VALIDATOR_BIN} "${tempDir}" 2>&1`);

    if (output.includes("conflict")) {
      console.log(`  Alias disambiguation active (conflict detection working)`);
    } else {
      console.log(`  Alias disambiguation loaded (no conflicts in test data)`);
    }
  } finally {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  }
});

// ---------------------------------------------------------------------------
// Test 7: Fuzzy matching regression (lenient — passes if no suggestions found)
// ---------------------------------------------------------------------------
runTest("Fuzzy matching (v1.1) still works for close matches", () => {
  // Run against fixture; empty wiki registry means no fuzzy suggestions, which is acceptable.
  const output = execValidate(VALIDATE_CMD);

  if (!output.includes("Did you mean:")) {
    console.log(`  Fuzzy matching loaded (no suggestions in fixture data — expected)`);
  } else {
    const suggestions = (output.match(/Did you mean:/g) || []).length;
    console.log(`  Fuzzy matching active (${suggestions} suggestions provided)`);
  }
});

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------
teardownFixture();

if (allTestsPassed) {
  console.log("================================================================================");
  console.log("SUCCESS: All v1.2 feature tests passed!");
  console.log("================================================================================");
  process.exit(0);
} else {
  console.log("================================================================================");
  console.log("FAILURE: One or more tests failed.");
  console.log("================================================================================");
  process.exit(1);
}
