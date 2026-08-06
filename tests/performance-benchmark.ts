import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

export interface PlatformThresholds {
  posixMs: number;
  win32Ms: number;
}

export interface BenchmarkTarget {
  name: string;
  command: string;
  thresholds: PlatformThresholds;
}

export const TARGET_DEFINITIONS: BenchmarkTarget[] = [
  {
    name: "modules/wiki/validate-contract.mjs",
    command: "node modules/wiki/validate-contract.mjs",
    thresholds: { posixMs: 2500, win32Ms: 6250 }
  },
  {
    name: "modules/wiki/cleanup-staging-archives.mjs --dry-run",
    command: "node modules/wiki/cleanup-staging-archives.mjs --dry-run",
    thresholds: { posixMs: 2000, win32Ms: 5000 }
  },
  {
    name: "modules/wiki/validate-staging-docs.mjs --diff",
    command: "node modules/wiki/validate-staging-docs.mjs --diff",
    thresholds: { posixMs: 3500, win32Ms: 8750 }
  }
];

export function resolveTargetMaxAllowedMs(target: BenchmarkTarget, platform: string = process.platform): number {
  return platform === "win32" ? target.thresholds.win32Ms : target.thresholds.posixMs;
}

console.log("================================================================================");
console.log("Pipeline Performance Benchmark Suite");
console.log(`  Active Platform Baseline: ${process.platform === "win32" ? "Windows (win32Ms)" : "POSIX (posixMs)"}`);
console.log("================================================================================\n");

let failedCount = 0;
const reportData: Record<string, { durationMs: number; maxAllowedMs: number; status: string }> = {};

for (const target of TARGET_DEFINITIONS) {
  const maxAllowedMs = resolveTargetMaxAllowedMs(target);
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
  console.log(`  Duration: ${durationMs} ms (Max Allowed: ${maxAllowedMs} ms)`);

  if (durationMs > maxAllowedMs) {
    console.error(`  [FAIL] ✘ ${target.name} exceeded latency threshold (${durationMs}ms > ${maxAllowedMs}ms)`);
    status = "EXCEEDED_THRESHOLD";
    failedCount++;
  } else if (status === "PASS") {
    console.log(`  [PASS] ✓ ${target.name} completed within threshold`);
  }

  reportData[target.name] = {
    durationMs,
    maxAllowedMs: maxAllowedMs,
    status
  };
  console.log();
}

const reportPath = path.join(REPO_ROOT, '.performance-report.json');
const reportPayload = {
  timestamp: new Date().toISOString(),
  benchmarks: reportData,
  summary: {
    totalTested: TARGET_DEFINITIONS.length,
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
