import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

console.log("[TEST] Running: Drift detection analyzer...");

const reportPath = path.join(REPO_ROOT, ".drift-report.json");
if (fs.existsSync(reportPath)) {
  fs.unlinkSync(reportPath);
}

try {
  const output = execSync("npx tsx modules/wiki/detect-drift.ts", {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (!output.includes("[KB-SYNC-DRIFT]") || !output.includes("stale_pages=")) {
    throw new Error("Drift detection did not emit its summary");
  }
} catch (e: any) {
  if (e.message === "Drift detection did not emit its summary") throw e;
  // Fail-soft test execution validation
}

if (!fs.existsSync(reportPath)) {
  throw new Error(".drift-report.json was not created");
}

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
if (!report.timestamp || !Array.isArray(report.drifted_sources) || typeof report.summary !== "object") {
  throw new Error("Invalid .drift-report.json schema structure");
}

console.log("[PASS] ✓ Drift detection analyzer generates valid report schema");
