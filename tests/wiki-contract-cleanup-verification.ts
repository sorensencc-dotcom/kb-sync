import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

console.log("================================================================================");
console.log("Wiki Contract & Archive Cleanup Verification Tests");
console.log("================================================================================\n");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

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

function createTempDir(prefix: string): string {
  const dir = path.join(REPO_ROOT, `.test_tmp_${prefix}_${Date.now()}`);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupTempDir(dir: string) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ================================================================================
// PART 1: Automated Test Assertions for validate-contract.mjs
// ================================================================================

runTest("validate-contract.mjs: passes valid frontmatter and valid absolute links", () => {
  const tempDir = createTempDir("contract_valid");
  try {
    const validFile = path.join(tempDir, "valid-note.md");
    fs.writeFileSync(
      validFile,
      `---
title: Valid Note Title
category: wiki
status: active
---

# Valid Note
Check link to [[kb-sync/wiki/concepts/immutable-staging]].
`
    );

    const output = execSync(`node modules/wiki/validate-contract.mjs "${tempDir}" 2>&1`, {
      cwd: REPO_ROOT,
      encoding: "utf8"
    });

    if (!output.includes("STATUS: PASS") && !output.includes("✔ STATUS: PASS")) {
      throw new Error(`Expected PASS output, got:\n${output}`);
    }
  } finally {
    cleanupTempDir(tempDir);
  }
});

runTest("validate-contract.mjs: detects missing mandatory frontmatter fields", () => {
  const tempDir = createTempDir("contract_missing_fm");
  try {
    const invalidFile = path.join(tempDir, "missing-title.md");
    fs.writeFileSync(
      invalidFile,
      `---
category: wiki
status: active
---

# Missing Title Note
`
    );

    let failed = false;
    let output = "";
    try {
      output = execSync(`node modules/wiki/validate-contract.mjs "${tempDir}" 2>&1`, {
        cwd: REPO_ROOT,
        encoding: "utf8"
      });
    } catch (err: any) {
      failed = true;
      output = err.stdout || err.output?.join("\n") || err.message;
    }

    if (!failed) {
      throw new Error("Expected validate-contract.mjs to fail for missing frontmatter title");
    }

    if (!output.includes("Missing mandatory key 'title'")) {
      throw new Error(`Expected 'Missing mandatory key 'title'' error message, got:\n${output}`);
    }
  } finally {
    cleanupTempDir(tempDir);
  }
});

runTest("validate-contract.mjs: detects invalid non-canonical category and status", () => {
  const tempDir = createTempDir("contract_invalid_enums");
  try {
    const invalidFile = path.join(tempDir, "bad-enums.md");
    fs.writeFileSync(
      invalidFile,
      `---
title: Bad Enums Note
category: invalid_cat
status: unknown_status
---

# Bad Enums Note
`
    );

    let failed = false;
    let output = "";
    try {
      output = execSync(`node modules/wiki/validate-contract.mjs "${tempDir}" 2>&1`, {
        cwd: REPO_ROOT,
        encoding: "utf8"
      });
    } catch (err: any) {
      failed = true;
      output = err.stdout || err.output?.join("\n") || err.message;
    }

    if (!failed) {
      throw new Error("Expected validate-contract.mjs to fail for non-canonical category/status");
    }

    if (!output.includes("Non-canonical category")) {
      throw new Error(`Expected 'Non-canonical category' error message, got:\n${output}`);
    }
  } finally {
    cleanupTempDir(tempDir);
  }
});

runTest("validate-contract.mjs: enforces absolute link format rule", () => {
  const tempDir = createTempDir("contract_non_absolute_link");
  try {
    const invalidFile = path.join(tempDir, "bare-link.md");
    fs.writeFileSync(
      invalidFile,
      `---
title: Bare Link Note
category: wiki
status: active
---

Reference to [[bare-link-target]] without slash.
`
    );

    let failed = false;
    let output = "";
    try {
      output = execSync(`node modules/wiki/validate-contract.mjs "${tempDir}" 2>&1`, {
        cwd: REPO_ROOT,
        encoding: "utf8"
      });
    } catch (err: any) {
      failed = true;
      output = err.stdout || err.output?.join("\n") || err.message;
    }

    if (!failed) {
      throw new Error("Expected validate-contract.mjs to fail for bare link target");
    }

    if (!output.includes("Non-canonical local link format")) {
      throw new Error(`Expected 'Non-canonical local link format' error message, got:\n${output}`);
    }
  } finally {
    cleanupTempDir(tempDir);
  }
});

runTest("validate-contract.mjs: detects invalid top-level folder in link", () => {
  const tempDir = createTempDir("contract_bad_root_folder");
  try {
    const invalidFile = path.join(tempDir, "bad-root-link.md");
    fs.writeFileSync(
      invalidFile,
      `---
title: Bad Root Link Note
category: wiki
status: active
---

Reference to [[untracked-folder/some-doc]].
`
    );

    let failed = false;
    let output = "";
    try {
      output = execSync(`node modules/wiki/validate-contract.mjs "${tempDir}" 2>&1`, {
        cwd: REPO_ROOT,
        encoding: "utf8"
      });
    } catch (err: any) {
      failed = true;
      output = err.stdout || err.output?.join("\n") || err.message;
    }

    if (!failed) {
      throw new Error("Expected validate-contract.mjs to fail for invalid root folder link");
    }

    if (!output.includes("references an invalid or untracked repository boundary folder")) {
      throw new Error(`Expected invalid root folder error message, got:\n${output}`);
    }
  } finally {
    cleanupTempDir(tempDir);
  }
});

runTest("validate-contract.mjs: detects duplicate file basenames across directories", () => {
  const tempDir = createTempDir("contract_basename_collision");
  try {
    const subDirA = path.join(tempDir, "folderA");
    const subDirB = path.join(tempDir, "folderB");
    fs.mkdirSync(subDirA, { recursive: true });
    fs.mkdirSync(subDirB, { recursive: true });

    const fileA = path.join(subDirA, "duplicate-name.md");
    const fileB = path.join(subDirB, "duplicate-name.md");

    const content = `---
title: Duplicate Note
category: wiki
status: active
---
`;
    fs.writeFileSync(fileA, content);
    fs.writeFileSync(fileB, content);

    let failed = false;
    let output = "";
    try {
      output = execSync(`node modules/wiki/validate-contract.mjs "${tempDir}" 2>&1`, {
        cwd: REPO_ROOT,
        encoding: "utf8"
      });
    } catch (err: any) {
      failed = true;
      output = err.stdout || err.output?.join("\n") || err.message;
    }

    if (!failed) {
      throw new Error("Expected validate-contract.mjs to fail on duplicate basenames");
    }

    if (!output.includes("Filename collision detected")) {
      throw new Error(`Expected 'Filename collision detected' error message, got:\n${output}`);
    }
  } finally {
    cleanupTempDir(tempDir);
  }
});

runTest("validate-contract.mjs: strips code blocks to avoid false link positives", () => {
  const tempDir = createTempDir("contract_code_fences");
  try {
    const codeBlockFile = path.join(tempDir, "code-fence-note.md");
    fs.writeFileSync(
      codeBlockFile,
      `---
title: Code Fence Note
category: wiki
status: active
---

Example code snippet containing raw link syntax:

\`\`\`markdown
Example: [[bare-link-in-code]]
Example bad root: [[invalid-root/sub-doc]]
\`\`\`

Valid body link: [[kb-sync/wiki/concepts/immutable-staging]]
`
    );

    const output = execSync(`node modules/wiki/validate-contract.mjs "${tempDir}" 2>&1`, {
      cwd: REPO_ROOT,
      encoding: "utf8"
    });

    if (!output.includes("STATUS: PASS") && !output.includes("✔ STATUS: PASS")) {
      throw new Error(`Expected PASS output when code fences contain raw link examples, got:\n${output}`);
    }
  } finally {
    cleanupTempDir(tempDir);
  }
});

// ================================================================================
// PART 2: Automated Test Assertions for cleanup-staging-archives.mjs
// ================================================================================

function createTimestampFolder(baseDir: string, daysAgo: number, suffix: string = "000000"): string {
  const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const folderName = `${year}${month}${day}-${suffix}`;
  const fullPath = path.join(baseDir, folderName);
  fs.mkdirSync(fullPath, { recursive: true });
  fs.writeFileSync(path.join(fullPath, "dummy.txt"), "test payload");
  return folderName;
}

runTest("cleanup-staging-archives.mjs: handles empty staging root gracefully", () => {
  const tempDir = createTempDir("cleanup_empty");
  try {
    const output = execSync(`node modules/wiki/cleanup-staging-archives.mjs 2>&1`, {
      cwd: REPO_ROOT,
      env: { ...process.env, STAGING_ROOT: tempDir },
      encoding: "utf8"
    });

    if (!output.includes("No snapshots found.")) {
      throw new Error(`Expected 'No snapshots found.', got:\n${output}`);
    }
  } finally {
    cleanupTempDir(tempDir);
  }
});

runTest("cleanup-staging-archives.mjs: --dry-run reports candidates without deleting", () => {
  const tempDir = createTempDir("cleanup_dry_run");
  try {
    // Create 7 snapshots, all older than 10 days
    const names: string[] = [];
    for (let i = 1; i <= 7; i++) {
      const name = createTimestampFolder(tempDir, 10 + i, `12000${i}`);
      names.push(name);
    }

    const output = execSync(`node modules/wiki/cleanup-staging-archives.mjs --dry-run --verbose 2>&1`, {
      cwd: REPO_ROOT,
      env: { ...process.env, STAGING_ROOT: tempDir },
      encoding: "utf8"
    });

    if (!output.includes("DRY RUN: Would delete 2 snapshot(s)")) {
      throw new Error(`Expected dry run to target 2 snapshots for deletion, got:\n${output}`);
    }

    // Verify all 7 folders still exist on disk
    const remaining = fs.readdirSync(tempDir);
    if (remaining.length !== 7) {
      throw new Error(`Dry run deleted files! Expected 7 remaining, got ${remaining.length}`);
    }
  } finally {
    cleanupTempDir(tempDir);
  }
});

runTest("cleanup-staging-archives.mjs: respects keep_min_snapshots policy (keep 5 minimum)", () => {
  const tempDir = createTempDir("cleanup_keep_min");
  try {
    // Create 4 snapshots, all 30 days old (> retention 7 days)
    for (let i = 1; i <= 4; i++) {
      createTimestampFolder(tempDir, 30 + i, `10000${i}`);
    }

    const output = execSync(`node modules/wiki/cleanup-staging-archives.mjs 2>&1`, {
      cwd: REPO_ROOT,
      env: { ...process.env, STAGING_ROOT: tempDir },
      encoding: "utf8"
    });

    if (!output.includes("No snapshots to delete (all within retention policy).")) {
      throw new Error(`Expected minimum retention policy to protect 4 snapshots, got:\n${output}`);
    }

    const remaining = fs.readdirSync(tempDir);
    if (remaining.length !== 4) {
      throw new Error(`Expected all 4 snapshots to be preserved, but ${remaining.length} remained`);
    }
  } finally {
    cleanupTempDir(tempDir);
  }
});

runTest("cleanup-staging-archives.mjs: deletes snapshots exceeding age and minimum count", () => {
  const tempDir = createTempDir("cleanup_delete_expired");
  try {
    // Create 8 snapshots: 5 recent (1-5 days old), 3 old (10, 12, 14 days old)
    for (let i = 1; i <= 5; i++) {
      createTimestampFolder(tempDir, i, `12000${i}`);
    }
    for (let i = 1; i <= 3; i++) {
      createTimestampFolder(tempDir, 10 + i * 2, `12000${i}`);
    }

    const output = execSync(`node modules/wiki/cleanup-staging-archives.mjs 2>&1`, {
      cwd: REPO_ROOT,
      env: { ...process.env, STAGING_ROOT: tempDir },
      encoding: "utf8"
    });

    if (!output.includes("Complete. Deleted 3/3 snapshot(s).")) {
      throw new Error(`Expected 3 snapshots deleted, got:\n${output}`);
    }

    const remaining = fs.readdirSync(tempDir);
    if (remaining.length !== 5) {
      throw new Error(`Expected 5 recent snapshots to remain, got ${remaining.length}`);
    }
  } finally {
    cleanupTempDir(tempDir);
  }
});

runTest("cleanup-staging-archives.mjs: ignores non-matching directory names", () => {
  const tempDir = createTempDir("cleanup_ignore_non_matching");
  try {
    // Create non-timestamp directory and files
    fs.mkdirSync(path.join(tempDir, "custom-folder"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "random-file.txt"), "data");

    // Also add 6 valid old snapshots
    for (let i = 1; i <= 6; i++) {
      createTimestampFolder(tempDir, 15 + i, `10000${i}`);
    }

    const output = execSync(`node modules/wiki/cleanup-staging-archives.mjs 2>&1`, {
      cwd: REPO_ROOT,
      env: { ...process.env, STAGING_ROOT: tempDir },
      encoding: "utf8"
    });

    if (!fs.existsSync(path.join(tempDir, "custom-folder"))) {
      throw new Error("cleanup-staging-archives.mjs modified or deleted non-snapshot folder!");
    }

    if (!fs.existsSync(path.join(tempDir, "random-file.txt"))) {
      throw new Error("cleanup-staging-archives.mjs deleted non-snapshot file!");
    }

    // 1 old snapshot out of 6 should be deleted (keeping 5)
    if (!output.includes("Complete. Deleted 1/1 snapshot(s).")) {
      throw new Error(`Expected 1 snapshot deleted, got:\n${output}`);
    }
  } finally {
    cleanupTempDir(tempDir);
  }
});

// Final verdict
if (allTestsPassed) {
  console.log("================================================================================");
  console.log("SUCCESS: All Wiki Contract & Archive Cleanup verification tests passed!");
  console.log("================================================================================");
  process.exit(0);
} else {
  console.log("================================================================================");
  console.log("FAILURE: One or more tests failed.");
  console.log("================================================================================");
  process.exit(1);
}
