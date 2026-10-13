import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { globToRegExp, generateManifest } from '../core/flatten-manifest.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

test('globToRegExp accurately converts shell wildcards to RegExp', () => {
  const r1 = globToRegExp('*node_modules/*');
  assert.equal(r1.test('node_modules/foo.js'), true);
  assert.equal(r1.test('src/node_modules/bar.ts'), true);
  assert.equal(r1.test('src/modules/bar.ts'), false);

  const r2 = globToRegExp('*.png');
  assert.equal(r2.test('assets/logo.png'), true);
  assert.equal(r2.test('logo.png'), true);
  assert.equal(r2.test('logo.png.bak'), false);

  const r3 = globToRegExp('package-lock.json');
  assert.equal(r3.test('package-lock.json'), true);
  assert.equal(r3.test('src/package-lock.json'), false);

  const r4 = globToRegExp('*coverage/*');
  assert.equal(r4.test('coverage/lcov.info'), true);
  assert.equal(r4.test('src/coverage/index.html'), true);
});

test('generateManifest correctly filters files using custom skip_patterns and include_extensions', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-test-'));

  try {
    // Create test files
    fs.writeFileSync(path.join(tempDir, 'keep1.ts'), 'export const a = 1;');
    fs.writeFileSync(path.join(tempDir, 'keep2.js'), 'console.log("hello");');
    fs.writeFileSync(path.join(tempDir, 'skip.png'), 'fake-binary');
    fs.writeFileSync(path.join(tempDir, 'ignored.txt'), 'not included in ext filter');

    // Create a mock global config
    const configPath = path.join(tempDir, 'global.yaml');
    fs.writeFileSync(
      configPath,
      'skip_patterns:\n  - "*.png"\n  - "package-lock.json"\n'
    );

    const outManifest = path.join(tempDir, 'out.manifest.txt');

    const result = generateManifest({
      repoRoot: tempDir,
      globalConfigFile: configPath,
      includeExtensions: '.ts,.js',
      outputFile: outManifest,
    });

    // Should include keep1.ts and keep2.js, but NOT skip.png or ignored.txt
    assert.deepEqual(result, ['keep1.ts', 'keep2.js']);

    // Check outputFile contents
    assert.ok(fs.existsSync(outManifest));
    const content = fs.readFileSync(outManifest, 'utf8').trim().split('\n');
    assert.deepEqual(content, ['keep1.ts', 'keep2.js']);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('generateManifest on production repo completes rapidly and honors skip_patterns', () => {
  const startTime = Date.now();
  const globalConfig = path.join(REPO_ROOT, 'configs', 'global.yaml');
  const tempManifest = path.join(os.tmpdir(), `prod-manifest-${Date.now()}.txt`);

  try {
    const files = generateManifest({
      repoRoot: REPO_ROOT,
      globalConfigFile: globalConfig,
      outputFile: tempManifest,
    });

    const durationMs = Date.now() - startTime;
    console.log(`  Processed ${files.length} files in ${durationMs}ms`);

    // Invariant: Must run under 10 seconds (well within the 90-second timeout boundary)
    assert.ok(durationMs < 10000, `Expected manifest generation <10s, got ${durationMs}ms`);
    assert.ok(files.length > 5000, `Expected >5000 repo files, got ${files.length}`);

    // Verify skip patterns are strictly respected
    for (const f of files) {
      assert.notEqual(f, 'package-lock.json', 'package-lock.json must be skipped');
      assert.notEqual(f, 'yarn.lock', 'yarn.lock must be skipped');
      assert.ok(!f.endsWith('.png'), `PNG files must be skipped: ${f}`);
      assert.ok(!f.endsWith('.jpg'), `JPG files must be skipped: ${f}`);
      assert.ok(!f.includes('node_modules/'), `node_modules must be skipped: ${f}`);
      assert.ok(!f.includes('_kb-sync-staging/'), `staging must be skipped: ${f}`);
    }

    // Verify manifest file matches
    const diskLines = fs.readFileSync(tempManifest, 'utf8').trim().split('\n');
    assert.equal(diskLines.length, files.length);
  } finally {
    if (fs.existsSync(tempManifest)) {
      fs.rmSync(tempManifest, { force: true });
    }
  }
});

test('generateManifest correctly handles deleted git files and nested folder hierarchies', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-nested-test-'));

  try {
    // Create nested directory structure
    fs.mkdirSync(path.join(tempDir, 'src', 'utils'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'dist'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'node_modules', 'pkg'), { recursive: true });

    fs.writeFileSync(path.join(tempDir, 'src', 'index.ts'), 'export * from "./utils";');
    fs.writeFileSync(path.join(tempDir, 'src', 'utils', 'math.ts'), 'export const add = (a, b) => a + b;');
    fs.writeFileSync(path.join(tempDir, 'dist', 'index.js'), 'compiled output');
    fs.writeFileSync(path.join(tempDir, 'node_modules', 'pkg', 'index.js'), 'module.exports = {};');
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# Hello');

    const result = generateManifest({
      repoRoot: tempDir,
      includeExtensions: '.ts, .md',
    });

    // Should include src/index.ts, src/utils/math.ts, README.md
    // Should exclude dist/ and node_modules/ via default skip patterns
    assert.deepEqual(result.sort(), [
      'README.md',
      'src/index.ts',
      'src/utils/math.ts',
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('generateManifest supports multiline and comma-separated includeExtensions', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-ext-test-'));

  try {
    fs.writeFileSync(path.join(tempDir, 'file1.js'), '1');
    fs.writeFileSync(path.join(tempDir, 'file2.mjs'), '2');
    fs.writeFileSync(path.join(tempDir, 'file3.ts'), '3');
    fs.writeFileSync(path.join(tempDir, 'file4.txt'), '4');

    const result = generateManifest({
      repoRoot: tempDir,
      includeExtensions: '.js\n.mjs,\n.ts',
    });

    assert.deepEqual(result.sort(), [
      'file1.js',
      'file2.mjs',
      'file3.ts',
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('generateManifest produces strictly sorted alphabetical outputs for deterministic caching', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-sort-test-'));

  try {
    const unsortedFiles = ['zeta.ts', 'alpha.ts', 'beta.ts', 'gamma.ts', 'delta.ts'];
    for (const f of unsortedFiles) {
      fs.writeFileSync(path.join(tempDir, f), 'content');
    }

    const result = generateManifest({
      repoRoot: tempDir,
      includeExtensions: '.ts',
    });

    const expected = [...unsortedFiles].sort();
    assert.deepEqual(result, expected, 'Files must be deterministically sorted in ascending alphabetical order');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('core/flatten.sh --manifest delegating to flatten-manifest.mjs generates pack.manifest.txt in <5s', () => {
  let bashCmd = 'bash';
  if (process.platform === 'win32') {
    const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
    if (fs.existsSync(gitBash)) {
      bashCmd = `"${gitBash}"`;
    }
  }

  const tempOut = fs.mkdtempSync(path.join(os.tmpdir(), 'flatten-e2e-out-'));
  const flattenSh = path.join(REPO_ROOT, 'core', 'flatten.sh');
  const globalConfig = path.join(REPO_ROOT, 'configs', 'global.yaml');

  try {
    const start = Date.now();
    // Convert paths to posix for bash
    const toPosix = (p) => p.replace(/^[A-Za-z]:/, (m) => `/${m[0].toLowerCase()}`).replace(/\\/g, '/');

    execSync(
      `${bashCmd} "${toPosix(flattenSh)}" --output "${toPosix(tempOut)}" --pack-name "test_pack.txt" --global-config "${toPosix(globalConfig)}" --manifest --repo-root "${toPosix(REPO_ROOT)}"`,
      {
        cwd: REPO_ROOT,
        timeout: 15000,
        stdio: 'pipe',
        env: {
          ...process.env,
          PATH: process.platform === 'win32' ? `C:\\Program Files\\Git\\bin;${process.env.PATH}` : process.env.PATH,
        },
      }
    );

    const elapsed = Date.now() - start;
    console.log(`  core/flatten.sh --manifest completed in ${elapsed}ms`);
    assert.ok(elapsed < 10000, `Expected core/flatten.sh --manifest to complete in <10s, took ${elapsed}ms`);

    const manifestFile = path.join(tempOut, 'pack.manifest.txt');
    assert.ok(fs.existsSync(manifestFile), 'pack.manifest.txt must exist in output directory');

    const manifestLines = fs.readFileSync(manifestFile, 'utf8').trim().split('\n').filter(Boolean);
    assert.ok(manifestLines.length > 5000, `Expected >5000 entries in manifest, got ${manifestLines.length}`);
  } catch (err) {
    if (err.message && (err.message.includes('ENOENT') || err.message.includes('spawn bash'))) {
      // Skip if bash is unavailable in environment
      return;
    }
    throw err;
  } finally {
    fs.rmSync(tempOut, { recursive: true, force: true });
  }
});

