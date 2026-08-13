import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

/**
 * Empirical Performance Benchmark Harness for kb-sync core operations.
 * Executes 10 baseline iterations of flatten, chunk, and DAG analysis.
 * Computes median, p95, and 1.5x median upper bounds to establish deterministic gates.
 */

const ITERATIONS = 10;
const repoRoot = process.cwd();
const reportPath = path.join(repoRoot, '.performance-report.json');

function benchmarkFn(name, fn) {
  console.log(`[BENCHMARK] Running ${name} (${ITERATIONS} iterations)...`);
  const timings = [];

  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    try {
      fn();
    } catch (err) {
      console.warn(`  [Iteration ${i + 1}] Warning/Error: ${err.message}`);
    }
    const end = performance.now();
    timings.push(end - start);
  }

  timings.sort((a, b) => a - b);
  const sum = timings.reduce((acc, v) => acc + v, 0);
  const avg = sum / timings.length;
  const median = timings[Math.floor(timings.length / 2)];
  const p95 = timings[Math.floor(timings.length * 0.95)];
  const threshold15x = Math.round(median * 1.5);

  return {
    iterations: ITERATIONS,
    timings_ms: timings.map(t => Math.round(t)),
    mean_ms: Math.round(avg),
    median_ms: Math.round(median),
    p95_ms: Math.round(p95),
    threshold_15x_ms: threshold15x
  };
}

async function runAllBenchmarks() {
  const results = {};

  const { countNonTrivialSCCs } = await import('../core/dag.mjs');
  const { readConfigValue } = await import('../core/config-loader.mjs');
  const { scanAndSanitizeText } = await import('../modules/compactor/secret-pii-sanitizer.mjs');

  // 1. DAG Graph Analysis Benchmark
  const nodes = Array.from({ length: 500 }, (_, i) => ({ id: `node_${i}` }));
  const edges = Array.from({ length: 1000 }, (_, i) => ({
    source: `node_${i % 500}`,
    target: `node_${(i * 3 + 1) % 500}`
  }));

  results.dag_analysis = benchmarkFn('core/dag.mjs countNonTrivialSCCs', () => {
    countNonTrivialSCCs(nodes, edges);
  });

  // 2. Config Loader Benchmark
  results.config_loader = benchmarkFn('core/config-loader.mjs', () => {
    readConfigValue('pyragify.yaml', 'version');
  });

  // 3. Compactor Secret Sanitizer Benchmark
  results.secret_sanitizer = benchmarkFn('modules/compactor/secret-pii-sanitizer.mjs', () => {
    const mockKey = 'AIzaSy' + '123456789012345678901234567890123';
    scanAndSanitizeText(`const token = "${mockKey}";`);
  });

  const report = {
    timestamp: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    node_version: process.version,
    benchmarks: results
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`[BENCHMARK] Complete! Report written to ${reportPath}`);
  console.dir(results, { depth: null });
}

runAllBenchmarks().catch(err => {
  console.error('[BENCHMARK] Error:', err);
  process.exit(1);
});
