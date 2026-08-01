import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { generateDeltaSummary } from "../modules/wiki/generate-delta-summary.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

console.log("[TEST] Running: Delta summarizer unit & CLI verification...");

// 1. Test CLI execution
const output = execSync("npx tsx modules/wiki/generate-delta-summary.ts", {
  cwd: REPO_ROOT,
  encoding: "utf8",
});

if (!output.includes("Delta Summary") && !output.includes("Baseline")) {
  throw new Error("Delta summarizer did not output expected header in CLI execution");
}

// 2. Test programmatic behavior with temporary staging dir
const testTmpStaging = path.join(REPO_ROOT, ".tmp_test_staging_delta");
if (fs.existsSync(testTmpStaging)) {
  fs.rmSync(testTmpStaging, { recursive: true, force: true });
}

try {
  // Scenario A: 0 snapshots -> Initial Baseline
  fs.mkdirSync(testTmpStaging, { recursive: true });
  const res0 = generateDeltaSummary("kb-sync", testTmpStaging);
  if (!res0.includes("Initial Baseline") && !res0.includes("No prior staging snapshots found")) {
    throw new Error(`Scenario A failed: expected Initial Baseline summary, got: ${res0}`);
  }

  // Scenario B: 1 snapshot -> Single Baseline
  const snap1 = path.join(testTmpStaging, "20260731-120000");
  fs.mkdirSync(snap1, { recursive: true });
  fs.writeFileSync(path.join(snap1, "doc1.md"), "# Doc 1\nInitial content.");
  fs.writeFileSync(path.join(snap1, "doc2.md"), "# Doc 2\nInitial content.");

  const res1 = generateDeltaSummary("kb-sync", testTmpStaging);
  if (!res1.includes("Baseline staging snapshot created") || !res1.includes("doc1.md") || !res1.includes("doc2.md")) {
    throw new Error(`Scenario B failed: expected single snapshot baseline listing, got: ${res1}`);
  }

  // Scenario C: 2 snapshots -> Diff calculation (Added, Modified, Deleted)
  const snap2 = path.join(testTmpStaging, "20260801-140000");
  fs.mkdirSync(snap2, { recursive: true });
  // doc1.md modified
  fs.writeFileSync(path.join(snap2, "doc1.md"), "# Doc 1\nUpdated content in snap2.");
  // doc2.md deleted (not written to snap2)
  // doc3.md added
  fs.writeFileSync(path.join(snap2, "doc3.md"), "# Doc 3\nNew document.");

  const res2 = generateDeltaSummary("kb-sync", testTmpStaging);
  if (
    !res2.includes("1 Added, 1 Modified, 1 Deleted") ||
    !res2.includes("+ [ADDED] doc3.md") ||
    !res2.includes("~ [MODIFIED] doc1.md") ||
    !res2.includes("- [DELETED] doc2.md")
  ) {
    throw new Error(`Scenario C failed: expected detailed diff summary, got:\n${res2}`);
  }

  console.log("[PASS] ✓ Delta summarizer generated output cleanly across all snapshot scenarios");
} finally {
  if (fs.existsSync(testTmpStaging)) {
    fs.rmSync(testTmpStaging, { recursive: true, force: true });
  }
}
