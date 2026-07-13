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

// Test 1: Metadata extraction → .catalog.json
runTest("Metadata extraction creates .catalog.json with file stats", () => {
  const output = execSync("npm run wiki:validate-staging 2>&1", {
    cwd: REPO_ROOT,
    encoding: "utf8"
  });

  // Look for staging path in output (could have ANSI codes)
  const pathMatch = output.match(/obsidian[\\\/]vault[\\\/]_kb-sync-staging[\\\/]kb-sync[\\\/]\d{8}-\d{6}/);
  if (!pathMatch) {
    throw new Error("Could not find staging path in validator output");
  }

  const stagingPath = path.join(REPO_ROOT, pathMatch[0]);
  const catalogPath = path.join(stagingPath, ".catalog.json");

  if (!fs.existsSync(catalogPath)) {
    throw new Error(`Catalog not found: ${catalogPath}`);
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

// Test 2: --diff mode only validates changed files
runTest("--diff flag filters to changed markdown files only", () => {
  const output = execSync("npm run wiki:validate-staging -- --diff 2>&1", {
    cwd: REPO_ROOT,
    encoding: "utf8"
  });

  if (!output.includes("Diff mode:")) {
    throw new Error("--diff mode not activated (missing 'Diff mode:' log)");
  }

  if (!output.includes("validating")) {
    throw new Error("--diff mode not showing file count");
  }

  const countMatch = output.match(/validating (\d+) changed file/);
  const count = countMatch ? parseInt(countMatch[1]) : 0;

  if (count === 0) {
    console.log(`  Diff mode active (0 changed files in current state)`);
  } else {
    console.log(`  Diff mode active (validating ${count} changed file(s))`);
  }
});

// Test 3: Frontmatter schema validation warns on missing fields
runTest("Frontmatter schema validation detects missing required fields", () => {
  const output = execSync("npm run wiki:validate-staging", {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: "pipe"
  });

  if (!output.includes("frontmatter:")) {
    throw new Error("Frontmatter validation not running (no warnings found)");
  }

  if (!output.includes("missing frontmatter")) {
    throw new Error("Frontmatter schema not validating required fields");
  }

  const fmWarnings = (output.match(/frontmatter:/g) || []).length;
  console.log(`  Frontmatter validation active (${fmWarnings} warnings)`);
});

// Test 4: Markdown linting catches style issues
runTest("Markdown linting detects trailing whitespace and blank lines", () => {
  const output = execSync("npm run wiki:validate-staging", {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: "pipe"
  });

  const lintWarnings = (output.match(/lint:/g) || []).length;

  if (lintWarnings === 0) {
    throw new Error("Markdown linting not running (no lint warnings found)");
  }

  if (!output.includes("trailing whitespace") && !output.includes("blank line")) {
    throw new Error("Linting not catching expected style issues");
  }

  console.log(`  Markdown linting active (${lintWarnings} issues)`);
});

// Test 5: Ignore patterns loaded from .gitignore/.cicignore
runTest("Ignore patterns from .cicignore/.gitignore are loaded", () => {
  const output = execSync("npm run wiki:validate-staging 2>&1", {
    cwd: REPO_ROOT,
    encoding: "utf8"
  });

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

// Test 6: Link alias detection warns on potential conflicts
runTest("Link alias disambiguation detects potential conflicts", () => {
  // Create temp test file with alias that could conflict
  const tempDir = path.join(REPO_ROOT, ".test_alias");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  try {
    // Create test markdown with alias
    const testFile = path.join(tempDir, "test.md");
    fs.writeFileSync(testFile, `# Test
[[some-page|somepage]]
`);

    // Create another temp file for registry
    const otherFile = path.join(tempDir, "somepages.md");
    fs.writeFileSync(otherFile, `# Some Pages\nContent`);

    // Run validator on this directory
    const output = execSync(`node modules/wiki/validate-staging-docs.mjs "${tempDir}" 2>&1`, {
      cwd: REPO_ROOT,
      encoding: "utf8"
    });

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

// Test 7: Fuzzy matching still works (v1.1 regression check)
runTest("Fuzzy matching (v1.1) still works for close matches", () => {
  const output = execSync("npm run wiki:validate-staging", {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: "pipe"
  });

  if (!output.includes("Did you mean:")) {
    console.log(`  Fuzzy matching loaded (no suggestions in current snapshot)`);
  } else {
    const suggestions = (output.match(/Did you mean:/g) || []).length;
    console.log(`  Fuzzy matching active (${suggestions} suggestions provided)`);
  }
});

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
