import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

describe('kb-sync CLI Script Subprocess Integration Suite', () => {
  let sandboxRoot: string;
  let testDbPath: string;
  let vaultDir: string;
  let gapsFilePath: string;
  let outDir: string;

  beforeEach(() => {
    sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-cli-test-'));
    testDbPath = path.join(sandboxRoot, 'test-kb.db');
    vaultDir = path.join(sandboxRoot, 'wiki', 'research');
    outDir = path.join(sandboxRoot, 'wiki', 'rfc');
    fs.mkdirSync(vaultDir, { recursive: true });
    fs.mkdirSync(outDir, { recursive: true });

    // Seed a markdown file
    fs.writeFileSync(
      path.join(vaultDir, 'auth-spec.md'),
      '# Authentication Spec\nDetails on token lifecycle, refresh tokens, and rate limits.'
    );

    // Seed a gaps file
    gapsFilePath = path.join(sandboxRoot, 'gaps.md');
    fs.writeFileSync(
      gapsFilePath,
      `# TRM Research Gaps\n\n- [ ] **Gap 1**: Token refresh handling under high load\n- [x] **Gap 2**: Initial password reset\n`
    );
  });

  afterEach(async () => {
    try {
      fs.rmSync(sandboxRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {}
  });

  test('CLI-01: sync-kb-cache.mjs populates SQLite database and reports stats', () => {
    const scriptPath = path.join(REPO_ROOT, 'scripts', 'sync-kb-cache.mjs');
    const res = spawnSync(process.execPath, [scriptPath, `--db=${testDbPath}`, '--verbose'], {
      cwd: sandboxRoot,
      encoding: 'utf-8'
    });

    assert.equal(res.status, 0, `Script failed with code ${res.status}: ${res.stderr}`);
    assert.ok(res.stdout.includes('[kb-cache] Synchronizing knowledge base'));
    assert.ok(res.stdout.includes('Sync completed'));
    assert.ok(fs.existsSync(testDbPath), 'SQLite database must exist on disk');
  });

  test('CLI-02: trm-triage.mjs runs dry-run against gaps file and handles missing gaps gracefully', () => {
    const scriptPath = path.join(REPO_ROOT, 'scripts', 'trm-triage.mjs');

    // Sync DB first
    spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'sync-kb-cache.mjs'), `--db=${testDbPath}`], {
      cwd: sandboxRoot,
      encoding: 'utf-8'
    });

    // 1. Dry run
    const resDry = spawnSync(
      process.execPath,
      [
        scriptPath,
        `--gaps=${gapsFilePath}`,
        `--out=${outDir}`,
        `--db=${testDbPath}`,
        '--dry-run'
      ],
      { cwd: sandboxRoot, encoding: 'utf-8' }
    );

    assert.equal(resDry.status, 0, `Dry run failed: ${resDry.stderr}`);
    assert.ok(resDry.stdout.includes('[trm-triage] Starting automated gap triage'));
    assert.ok(resDry.stdout.includes('Triage completed successfully'));

    // 2. Non-existent gaps file
    const resMissing = spawnSync(
      process.execPath,
      [
        scriptPath,
        `--gaps=${path.join(sandboxRoot, 'non-existent.md')}`,
        `--out=${outDir}`,
        `--db=${testDbPath}`
      ],
      { cwd: sandboxRoot, encoding: 'utf-8' }
    );

    assert.equal(resMissing.status, 1, 'Must exit with code 1 for missing gaps file');
    assert.ok(resMissing.stderr.includes('Target gaps file does not exist'));
  });

  test('CLI-03: mcp-memory-server.mjs responds to JSON-RPC over stdio pipe', async () => {
    // Sync DB first
    spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'sync-kb-cache.mjs'), `--db=${testDbPath}`], {
      cwd: sandboxRoot,
      encoding: 'utf-8'
    });

    const scriptPath = path.join(REPO_ROOT, 'scripts', 'mcp-memory-server.mjs');
    const proc = spawn(process.execPath, [scriptPath], {
      cwd: sandboxRoot,
      env: { ...process.env, KB_CACHE_DB: testDbPath },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const responses: any[] = [];
    proc.stdout.setEncoding('utf-8');

    let buffer = '';
    proc.stdout.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) {
          try {
            responses.push(JSON.parse(line.trim()));
          } catch {}
        }
      }
    });

    // Send initialize request
    const initReq = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {}
    }) + '\n';
    proc.stdin.write(initReq);

    // Send tools/list request
    const listReq = JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {}
    }) + '\n';
    proc.stdin.write(listReq);

    // Send tools/call query_context_cache
    const callReq = JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'query_context_cache',
        arguments: { query: 'lifecycle' }
      }
    }) + '\n';
    proc.stdin.write(callReq);

    // Wait for responses
    await new Promise((resolve) => setTimeout(resolve, 500));
    proc.stdin.end();

    await new Promise<void>((resolve) => {
      proc.on('close', () => resolve());
      setTimeout(() => {
        try {
          proc.kill();
        } catch {}
        resolve();
      }, 500);
    });

    const initResp = responses.find((r) => r.id === 1);
    assert.ok(initResp, 'Must receive initialize response');
    assert.equal(initResp.result?.serverInfo?.name, 'local-context-cache');

    const listResp = responses.find((r) => r.id === 2);
    assert.ok(listResp, 'Must receive tools/list response');
    assert.equal(listResp.result?.tools?.length, 2);

    const callResp = responses.find((r) => r.id === 3);
    assert.ok(callResp, 'Must receive tools/call response');
    assert.ok(Array.isArray(callResp.result?.content));
  });
});
