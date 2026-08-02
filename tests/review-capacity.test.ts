import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

console.log("[TEST] Running: Review Capacity weekly metrics verification...");

const tempCsv = path.join(REPO_ROOT, "modules/review-capacity/test-capacity.csv");

// Write mock CSV with sample PR rows
const header = "pr_id,repo,author,created_at,merged_at,human_reviewers,human_review_minutes,first_review_latency_minutes,lines_changed,ai_assisted,ai_authored_bucket,automated_findings_count,rework_commits_count,outcome\n";
const row1 = "owner/repo#1,owner/repo,alice,2026-07-27T10:00:00Z,2026-07-27T14:00:00Z,bob,30,60,150,yes,26-50,1,0,merged\n";
const row2 = "owner/repo#2,owner/repo,bob,2026-07-28T10:00:00Z,2026-07-28T16:00:00Z,alice,45,120,300,no,0,0,1,merged\n";
const row3 = "owner/repo#3,owner/repo,alice,2026-07-29T10:00:00Z,2026-07-29T18:00:00Z,charlie,60,90,500,yes,51-75,2,2,merged\n";

fs.writeFileSync(tempCsv, header + row1 + row2 + row3, "utf8");

try {
  const scriptPath = path.join(REPO_ROOT, "modules/review-capacity/scripts/compute-weekly-metrics.ps1");
  const cmd = `powershell -ExecutionPolicy Bypass -Command "& '${scriptPath}' -CsvPath '${tempCsv}' -WeekStart '2026-07-27' -SustainablePrsPerEngineer 1"`;
  const output = execSync(cmd, { encoding: "utf8" });
  const result = JSON.parse(output);

  if (result.merged_prs_week !== 3) {
    throw new Error(`Expected merged_prs_week = 3, got ${result.merged_prs_week}`);
  }

  if (result.active_engineers_week !== 2) {
    throw new Error(`Expected active_engineers_week = 2, got ${result.active_engineers_week}`);
  }

  if (result.review_ceiling !== 2) {
    throw new Error(`Expected review_ceiling = 2, got ${result.review_ceiling}`);
  }

  if (result.is_saturated !== true) {
    throw new Error(`Expected is_saturated = true, got ${result.is_saturated}`);
  }

  console.log("[PASS] ✓ Review Capacity weekly metrics calculation verified successfully");
} finally {
  if (fs.existsSync(tempCsv)) {
    fs.unlinkSync(tempCsv);
  }
}
