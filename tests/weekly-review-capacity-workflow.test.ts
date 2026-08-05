import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

console.log("================================================================================");
console.log("Weekly Review Capacity Workflow Validation");
console.log("================================================================================\n");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const ROOT_DEV = path.resolve(REPO_ROOT, "..");
const WORKFLOW_PATH = path.join(ROOT_DEV, ".github", "workflows", "weekly-review-capacity.yml");
const KB_PACKAGE_PATH = path.join(REPO_ROOT, "package.json");

let allPassed = true;

function test(name: string, fn: () => void) {
  console.log(`[TEST] ${name}...`);
  try {
    fn();
    console.log(`[PASS] ✓ ${name}\n`);
  } catch (err: any) {
    console.error(`[FAIL] ✗ ${name}`);
    console.error(`       ${err.message}\n`);
    allPassed = false;
  }
}

test("Workflow file existence", () => {
  if (!fs.existsSync(WORKFLOW_PATH)) {
    throw new Error(`Workflow file missing at: ${WORKFLOW_PATH}`);
  }
});

test("Workflow configuration & path alignment", () => {
  const content = fs.readFileSync(WORKFLOW_PATH, "utf8");

  if (!content.includes("working-directory: kb-sync")) {
    throw new Error("Workflow must explicitly specify 'working-directory: kb-sync'");
  }

  if (!content.includes("concurrency:")) {
    throw new Error("Workflow must define concurrency protection block");
  }

  if (!content.includes("modules/review-capacity/scripts/extract-github-prs.ps1")) {
    throw new Error("Extraction script path must be relative to kb-sync/ working directory");
  }

  if (!content.includes("modules/review-capacity/review-capacity-baseline.csv")) {
    throw new Error("Staged baseline CSV path must be relative to kb-sync/ working directory");
  }

  if (content.includes("owner/cic-ingestion") || content.includes("owner/charlie-deep-research")) {
    throw new Error("Workflow contains unverified placeholder repository names ('owner/')");
  }
});

test("Referenced extraction script existence", () => {
  const scriptPath = path.join(REPO_ROOT, "modules", "review-capacity", "scripts", "extract-github-prs.ps1");
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Extraction script missing at: ${scriptPath}`);
  }
});

test("Package script kb:review-metrics in kb-sync/package.json", () => {
  const pkgContent = fs.readFileSync(KB_PACKAGE_PATH, "utf8");
  const pkg = JSON.parse(pkgContent);

  if (!pkg.scripts || !pkg.scripts["kb:review-metrics"]) {
    throw new Error("kb-sync/package.json missing 'kb:review-metrics' script definition!");
  }
});

if (allPassed) {
  console.log("================================================================================");
  console.log("SUCCESS: All workflow validation tests passed!");
  console.log("================================================================================");
  process.exit(0);
} else {
  console.log("================================================================================");
  console.log("FAILURE: Workflow validation failed.");
  console.log("================================================================================");
  process.exit(1);
}
