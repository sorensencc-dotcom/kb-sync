import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LoopbackWatchdog,
  MAX_RESTARTS,
  writeHealthTelemetry,
} from '../scripts/mcp/loopback-watchdog.mjs';

function fakeChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.kill = () => {
    child.killed = true;
    child.exitCode = 0;
    child.emit('exit', 0, 'SIGTERM');
    return true;
  };
  return child;
}

function createHarness({ probes = [], occupied = false } = {}) {
  const children = [];
  const telemetry = [];
  let now = 1_000;
  let probeIndex = 0;
  const watchdog = new LoopbackWatchdog({
    port: 40_000 + Math.floor(Math.random() * 1_000),
    token: ['test', 'token'].join('-'),
    intervalMs: 10,
    telemetryPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'watchdog-')), 'health.json'),
    now: () => now,
    spawnImpl: () => {
      const child = fakeChild(10_000 + children.length);
      children.push(child);
      return child;
    },
    probeImpl: async () => probes[probeIndex++] || { ok: true },
    portOccupiedImpl: async () => occupied,
    writeTelemetryImpl: (_file, payload) => telemetry.push(payload),
    sleepImpl: async () => {},
  });
  return { watchdog, children, telemetry, advance: (ms) => { now += ms; } };
}

test('watchdog refuses to start when an unrelated listener owns the port', async () => {
  const { watchdog } = createHarness({ occupied: true });

  await assert.rejects(() => watchdog.start(), /already occupied/);
});
test('watchdog restarts only its owned child after two failed probes', async () => {
  const harness = createHarness({ probes: [
    { ok: false, error: 'connection refused' },
    { ok: false, error: 'connection refused' },
  ] });
  await harness.watchdog.start();

  await harness.watchdog.checkOnce();
  await harness.watchdog.checkOnce();

  assert.equal(harness.children.length, 2);
  assert.equal(harness.children[0].killed, true);
  assert.equal(harness.watchdog.status, 'starting');
});

test('watchdog enters alert-only mode after the restart limit', async () => {
  const harness = createHarness({ probes: Array.from({ length: 8 }, () => ({ ok: false, error: 'down' })) });
  await harness.watchdog.start();

  for (let i = 0; i < 8; i += 1) await harness.watchdog.checkOnce();

  assert.equal(harness.children.length, MAX_RESTARTS + 1);
  assert.equal(harness.watchdog.status, 'alert_only');
  assert.match(harness.watchdog.lastError, /restart limit/);
});

test('watchdog stops its owned child gracefully', async () => {
  const { watchdog, children } = createHarness();
  await watchdog.start();

  await watchdog.stop();

  assert.equal(children[0].killed, true);
  assert.equal(watchdog.status, 'stopped');
});

test('health telemetry writes atomically to the target path', () => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), '.tmp-watchdog-telemetry-'));
  const filePath = path.join(directory, 'nested', 'health.json');
  try {
    writeHealthTelemetry(filePath, { status: 'healthy', port: 40001 });

    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), {
      status: 'healthy',
      port: 40001,
    });
    assert.deepEqual(fs.readdirSync(path.dirname(filePath)), ['health.json']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
test('live daemon health probe works on an isolated random port', {
  timeout: 15_000,
  skip: process.env.KB_WATCHDOG_LIVE === '1' ? false : 'set KB_WATCHDOG_LIVE=1 for loopback process verification',
}, async () => {
  const sourceDb = path.join(process.cwd(), '.kb_cache', 'knowledge.db');
  assert.equal(fs.existsSync(sourceDb), true, 'the local cache fixture is required');
  const directory = fs.mkdtempSync(path.join(process.cwd(), '.tmp-watchdog-live-'));
  const databasePath = path.join(directory, 'knowledge.db');
  for (const suffix of ['', '-wal', '-shm']) {
    const source = `${sourceDb}${suffix}`;
    if (fs.existsSync(source)) fs.copyFileSync(source, `${databasePath}${suffix}`);
  }

  const port = 41_000 + Math.floor(Math.random() * 1_000);
  const token = ['isolated', 'live', 'token'].join('-');
  const child = spawn(process.execPath, ['scripts/mcp-memory-daemon.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      KB_CACHE_DB: databasePath,
      KB_CACHE_DAEMON_PORT: String(port),
      KB_CACHE_DAEMON_TOKEN: token,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const waitForHealth = async () => {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (response.status === 200) return response;
      } catch {
        // The daemon may still be opening the isolated database.
      }
      if (child.exitCode != null) throw new Error(`isolated daemon exited ${child.exitCode}: ${stderr}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('isolated daemon did not become healthy');
  };

  try {
    await waitForHealth();
    const unauthorized = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(unauthorized.status, 401);
    const authorized = await waitForHealth();
    assert.deepEqual(await authorized.json(), { status: 'ok', port, db_mode: 'wal' });
  } finally {
    if (child.exitCode == null) child.kill('SIGTERM');
    await new Promise((resolve) => {
      if (child.exitCode != null) {
        resolve();
        return;
      }
      child.once('exit', resolve);
      setTimeout(() => {
        if (child.exitCode == null) child.kill('SIGKILL');
        resolve();
      }, 5_000).unref();
    });
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
