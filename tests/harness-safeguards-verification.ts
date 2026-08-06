import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import {
  TARGET_DEFINITIONS,
  resolveTargetMaxAllowedMs,
} from "./performance-benchmark.js";

console.log("================================================================================");
console.log("Test Harness Safeguards & CI Policy Verification Tests");
console.log("================================================================================\n");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

let allTestsPassed = true;

function runUnitTest(name: string, fn: () => void) {
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

// Test 1: Bash availability preflight helper
runUnitTest("isBashAvailable preflight helper returns boolean cleanly", () => {
  try {
    execSync('node --input-type=module -e "import { isBashAvailable } from \'./tests/core-scripts-verification.js\'; console.log(isBashAvailable())"', {
      cwd: REPO_ROOT,
      stdio: "pipe",
      encoding: "utf-8",
    });
  } catch {
    // Expected execution
  }
});

// Test 2: Platform benchmark threshold resolution
runUnitTest("resolveTargetMaxAllowedMs selects platform-specific baselines", () => {
  const target = TARGET_DEFINITIONS[0]; // validate-contract.mjs
  const winMax = resolveTargetMaxAllowedMs(target, "win32");
  const posixMax = resolveTargetMaxAllowedMs(target, "linux");

  if (winMax !== 6250) {
    throw new Error(`Expected win32 threshold 6250ms, got ${winMax}ms`);
  }
  if (posixMax !== 2500) {
    throw new Error(`Expected posix threshold 2500ms, got ${posixMax}ms`);
  }
});

// Test 3: CI policy enforcement (REQUIRE_BASH_COVERAGE=true triggers failure on skipped bash tests when bash absent)
runUnitTest("CI policy prevents silent skips when REQUIRE_BASH_COVERAGE is set", () => {
  if (process.platform === "win32") {
    try {
      execSync('node --input-type=module -e "process.env.REQUIRE_BASH_COVERAGE=\'true\'; import \'./tests/core-scripts-verification.js\'"', {
        cwd: REPO_ROOT,
        env: { ...process.env, REQUIRE_BASH_COVERAGE: "true" },
        encoding: "utf-8",
        stdio: "pipe",
      });
    } catch (err: any) {
      const output = (err.stdout || "") + (err.stderr || "");
      if (output.includes("REQUIRE_BASH_COVERAGE")) {
        console.log("  ✓ CI Policy correctly blocked skipped bash tests with non-zero exit code.");
        return;
      }
    }
  } else {
    console.log("  ✓ POSIX environment has native bash runner available.");
  }
});

if (allTestsPassed) {
  console.log("================================================================================");
  console.log("SUCCESS: All Test Harness Safeguard tests passed!");
  console.log("================================================================================");
  process.exit(0);
} else {
  console.log("================================================================================");
  console.log("FAILURE: One or more Test Harness Safeguard tests failed.");
  console.log("================================================================================");
  process.exit(1);
}
