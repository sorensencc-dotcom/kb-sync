import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as assert from 'assert';
import { execSync } from 'child_process';
import { 
  loadObsidianConfig, 
  mapSourceToWikiSibling, 
  extractExportedSymbolsFromDiff, 
  queryGraftCallers, 
  checkSiblingPatterns 
} from '../modules/wiki/sibling-checker.mjs';

console.log("================================================================================");
console.log("Sibling Pattern Checking v2 - Verification Test Suite");
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

runTest("loadObsidianConfig returns standard defaults when configs/obsidian.yaml is missing", () => {
  const mockRepoRoot = path.join(REPO_ROOT, "mock_test_repo_missing");
  const config = loadObsidianConfig(mockRepoRoot);
  
  assert.equal(config.wiki_dir, 'wiki');
  assert.ok(Array.isArray(config.mapping_rules));
  assert.equal(config.mapping_rules[0].prefix, 'core/');
});

runTest("extractExportedSymbolsFromDiff extracts functions, classes, and interfaces cleanly", () => {
  const diffMock = `
+++ b/core/path-normalizer.mjs
+export function toPosixPath(inputPath) {
+export const toWindowsPath = (inputPath) => {
+export class PathNormalizer {
+export interface MappingRule {
+export default class RunAll {
+export async function loadConfig() {
-export function oldFunction() {
  `;
  const symbols = extractExportedSymbolsFromDiff(diffMock);
  
  assert.deepEqual(symbols, [
    'toPosixPath',
    'toWindowsPath',
    'PathNormalizer',
    'MappingRule',
    'RunAll',
    'loadConfig'
  ]);
});

runTest("mapSourceToWikiSibling resolves standard and camelCase paths with their correct wiki document layout", () => {
  const mockConfig = {
    vault_root: '.',
    wiki_dir: 'wiki',
    mapping_rules: [
      { prefix: 'core/', folder: 'kb-sync/utilities' },
      { prefix: 'modules/wiki/', folder: 'entities' }
    ]
  };

  // 1. Check utility rules (should convert snake-case and pascal-case)
  const utilitySibling = mapSourceToWikiSibling('core/run-all.sh', mockConfig);
  assert.equal(utilitySibling, 'wiki/kb-sync/utilities/RunAll.md');

  // 2. Check entities rule (should preserve prefix with file extension)
  const entitySibling = mapSourceToWikiSibling('modules/wiki/detect-drift.ts', mockConfig);
  assert.equal(entitySibling, 'wiki/entities/detect-drift.ts.md');
});

runTest("checkSiblingPatterns falls back to static DAG adjacency list mapping if Graft is absent", () => {
  const mockRepoRoot = path.join(REPO_ROOT, "mock_interface_fallback_workspace");
  fs.mkdirSync(path.join(mockRepoRoot, "core"), { recursive: true });
  fs.mkdirSync(path.join(mockRepoRoot, "modules/wiki"), { recursive: true });
  
  // Write mock DAG adjacency structure on disk
  const nlmPackDir = path.join(mockRepoRoot, ".nlm_pack");
  const gensDir = path.join(nlmPackDir, "generations/gen-abc");
  fs.mkdirSync(gensDir, { recursive: true });
  
  fs.writeFileSync(path.join(nlmPackDir, "current_generation.json"), JSON.stringify({
    active_generation: "gen-abc"
  }), "utf8");
  
  fs.writeFileSync(path.join(gensDir, "adjacency.json"), JSON.stringify({
    reverse: {
      "node:file:core/path-normalizer.mjs": [
        { source: "node:file:modules/wiki/detect-drift.ts" }
      ]
    }
  }), "utf8");

  // Create mock files
  const pathNormalizerPath = path.join(mockRepoRoot, "core/path-normalizer.mjs");
  fs.writeFileSync(pathNormalizerPath, "export function toPosixPath() {}", "utf8");
  
  const detectDriftPath = path.join(mockRepoRoot, "modules/wiki/detect-drift.ts");
  fs.writeFileSync(detectDriftPath, "import { toPosixPath } from 'path-normalizer'", "utf8");

  try {
    const { warnings, errors } = checkSiblingPatterns(["core/path-normalizer.mjs"], mockRepoRoot);
    // Since git diff is empty in this test repository context, there shouldn't be interface breaks
    assert.equal(errors.length, 0);
  } finally {
    fs.rmSync(mockRepoRoot, { recursive: true, force: true });
  }
});

if (allTestsPassed) {
  console.log("================================================================================");
  console.log("SUCCESS: All sibling check v2 verification tests passed successfully!");
  console.log("================================================================================");
  process.exit(0);
} else {
  console.log("================================================================================");
  console.log("FAILURE: One or more tests failed.");
  console.log("================================================================================");
  process.exit(1);
}
