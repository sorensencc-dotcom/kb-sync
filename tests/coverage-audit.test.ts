import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

console.log("[TEST] Running: Coverage audit verification...");

const reportPath = path.join(REPO_ROOT, ".coverage-report.json");
if (fs.existsSync(reportPath)) {
  fs.unlinkSync(reportPath);
}

execSync("npx tsx modules/wiki/audit-coverage.ts", { cwd: REPO_ROOT, stdio: "inherit" });

if (!fs.existsSync(reportPath)) {
  throw new Error(".coverage-report.json was not generated");
}

const data = JSON.parse(fs.readFileSync(reportPath, "utf8"));

if (
  typeof data.timestamp !== "string" ||
  typeof data.source_files_count !== "number" ||
  typeof data.wiki_pages_count !== "number" ||
  !Array.isArray(data.unmapped_sources) ||
  typeof data.coverage_score_pct !== "number" ||
  !data.link_health ||
  typeof data.link_health.total_links !== "number" ||
  !Array.isArray(data.link_health.broken_links) ||
  typeof data.link_health.healthy_pct !== "number"
) {
  throw new Error("Invalid .coverage-report.json structure");
}

console.log(`[INFO] Coverage Score: ${data.coverage_score_pct}% (${data.source_files_count - data.unmapped_sources.length}/${data.source_files_count} mapped)`);
console.log(`[INFO] Link Health: ${data.link_health.healthy_pct}% (${data.link_health.total_links - data.link_health.broken_links.length}/${data.link_health.total_links} valid links)`);
console.log("[PASS] ✓ Coverage audit completed successfully");
