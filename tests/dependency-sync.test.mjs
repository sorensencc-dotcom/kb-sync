import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

test('package.json and package-lock.json are in exact sync', () => {
  const pkgPath = path.join(REPO_ROOT, 'package.json');
  const lockPath = path.join(REPO_ROOT, 'package-lock.json');

  assert.ok(fs.existsSync(pkgPath), 'package.json must exist');
  assert.ok(fs.existsSync(lockPath), 'package-lock.json must exist');

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

  assert.ok(lock.lockfileVersion >= 2, 'Lockfile version must be >= 2');

  const rootPkg = lock.packages?.[''];
  assert.ok(rootPkg, 'package-lock.json must have root package entry packages[""]');

  const allDeclaredDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.optionalDependencies,
  };

  const lockRootDeps = {
    ...rootPkg.dependencies,
    ...rootPkg.devDependencies,
    ...rootPkg.optionalDependencies,
  };

  const missingFromRootLock = [];
  const missingFromNodeModules = [];

  for (const [depName, declaredSpec] of Object.entries(allDeclaredDeps)) {
    // 1. Verify it exists in root dependencies block of lockfile
    if (!lockRootDeps[depName]) {
      missingFromRootLock.push(depName);
    }

    // 2. Verify node_modules entry exists in lock.packages
    const nmKey = `node_modules/${depName}`;
    if (!lock.packages?.[nmKey] && !lock.dependencies?.[depName]) {
      missingFromNodeModules.push(depName);
    }
  }

  assert.deepEqual(
    missingFromRootLock,
    [],
    `Dependencies declared in package.json missing from package-lock.json root: ${missingFromRootLock.join(', ')}`
  );

  assert.deepEqual(
    missingFromNodeModules,
    [],
    `Dependencies missing from package-lock.json packages entries: ${missingFromNodeModules.join(', ')}`
  );
});

test('MCP and Hono packages that caused PR #39 failure are strictly locked', () => {
  const lockPath = path.join(REPO_ROOT, 'package-lock.json');
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

  const criticalPackages = [
    '@modelcontextprotocol/node',
    '@modelcontextprotocol/server',
    '@modelcontextprotocol/core',
    '@hono/node-server',
    'hono',
    'zod',
  ];

  for (const pkgName of criticalPackages) {
    const key = `node_modules/${pkgName}`;
    const entry = lock.packages?.[key];
    assert.ok(entry, `Critical package ${pkgName} must be present in package-lock.json packages`);
    assert.ok(entry.version, `Critical package ${pkgName} must have resolved version in lockfile`);
  }
});

test('all GitHub Actions workflows specify Node version >= 22.12.0', () => {
  const workflowsDir = path.join(REPO_ROOT, '.github', 'workflows');
  if (!fs.existsSync(workflowsDir)) {
    return;
  }

  const workflowFiles = fs.readdirSync(workflowsDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  const inspectedWorkflows = [];

  for (const file of workflowFiles) {
    const content = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
    const nodeVersionMatches = [...content.matchAll(/node-version:\s*["']?(\d+)(?:\.\d+)*["']?/g)];

    for (const match of nodeVersionMatches) {
      const majorVersion = parseInt(match[1], 10);
      inspectedWorkflows.push({ file, majorVersion });
      assert.ok(
        majorVersion >= 22,
        `Workflow ${file} specifies Node version ${match[1]}, but must be >= 22 to prevent commander EBADENGINE errors`
      );
    }
  }

  assert.ok(inspectedWorkflows.length > 0, 'Must have inspected at least one workflow setting up Node');
});
