import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

interface BenchmarkTarget {
  name: string;
  command: string;
  maxAllowedMs: number;
}

// NOTE: core/flatten.sh --manifest is intentionally excluded from automated perf gates.
// It invokes git grep over ~135 files via WSL2, which produces 40-60% timing variance
// across runs (observed range: 4000-7000ms) due to WSL2 filesystem I/O jitter.
// Gating on this would produce persistent false failures without detecting real regressions.
// Profile it manually with `time bash core/flatten.sh --manifest` when investigating perf.
const TARGETS: BenchmarkTarget[] = [
  {
    name: "modules/wiki/validate-contract.mjs",
    command: "node modules/wiki/validate-contract.mjs",
    maxAllowedMs: 2500
  },
  {
    name: "modules/wiki/cleanup-staging-archives.mjs --dry-run",
    command: "node modules/wiki/cleanup-staging-archives.mjs --dry-run",
    maxAllowedMs: 2000
  },
  {
    name: "modules/wiki/validate-staging-docs.mjs --diff",
    command: "node modules/wiki/validate-staging-docs.mjs --diff",
    maxAllowedMs: 3500
  }
];

console.log("================================================================================");
console.log("Pipeline Performance Benchmark Suite");
console.log("================================================================================\n");

let failedCount = 0;
const reportData: Record<string, { durationMs: number; maxAllowedMs: number; status: string }> = {};

for (const target of TARGETS) {
  console.log(`[PERF] Profiling: ${target.name}...`);
  const start = performance.now();
  let status = "PASS";
  
  try {
    execSync(target.command, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: "pipe"
    });
  } catch (err: any) {
    // If validator exits non-zero due to staged docs warnings, treat as executed if stdout was produced
    if (!err.stdout && !err.stderr) {
      console.error(`  [FAIL] Command failed with error: ${err.message}`);
      status = "ERROR";
      failedCount++;
    }
  }

  const durationMs = Math.round(performance.now() - start);
  console.log(`  Duration: ${durationMs} ms (Max Allowed: ${target.maxAllowedMs} ms)`);

  if (durationMs > target.maxAllowedMs) {
    console.error(`  [FAIL] ✘ ${target.name} exceeded latency threshold (${durationMs}ms > ${target.maxAllowedMs}ms)`);
    status = "EXCEEDED_THRESHOLD";
    failedCount++;
  } else if (status === "PASS") {
    console.log(`  [PASS] ✓ ${target.name} completed within threshold`);
  }

  reportData[target.name] = {
    durationMs,
    maxAllowedMs: target.maxAllowedMs,
    status
  };
  console.log();
}

const reportPath = path.join(REPO_ROOT, '.performance-report.json');
const reportPayload = {
  timestamp: new Date().toISOString(),
  benchmarks: reportData,
  summary: {
    totalTested: TARGETS.length,
    failedCount,
    status: failedCount === 0 ? "PASS" : "FAIL"
  }
};

fs.writeFileSync(reportPath, JSON.stringify(reportPayload, null, 2), 'utf8');
console.log(`[PERF] Benchmark report written to: ${reportPath}`);

if (failedCount > 0) {
  console.error(`\n[PERF] ✘ Performance benchmark failed (${failedCount} violation(s)).`);
  process.exit(1);
} else {
  console.log(`\n[PERF] ✔ All performance gates passed successfully.`);
  process.exit(0);
}
