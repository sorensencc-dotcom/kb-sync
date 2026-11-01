#!/usr/bin/env node

import { spawn as spawnChild } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

export const DEFAULT_PORT = 8765;
export const DEFAULT_INTERVAL_MS = 30_000;
export const DEFAULT_TIMEOUT_MS = 2_000;
export const MAX_RESTARTS = 3;
export const RESTART_WINDOW_MS = 15 * 60_000;
export const DEFAULT_TELEMETRY_PATH = path.join(REPO_ROOT, '_status-feed', 'loopback_gateway_health.json');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sanitizeError(error, token = '') {
  return String(error?.message || error || 'unknown error')
    .replaceAll(token, token ? '[redacted]' : '')
    .replaceAll(/[A-Za-z]:\\[^\s]+/g, '[path]')
    .slice(0, 300);
}

export function writeHealthTelemetry(filePath, payload) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, resolved);
}

export function isPortOccupied(port, host = '127.0.0.1', timeoutMs = 250) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (occupied) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(occupied);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(timeoutMs, () => finish(false));
  });
}

export async function probeHealth({ port, token, timeoutMs = DEFAULT_TIMEOUT_MS, requestImpl = http.request }) {
  return new Promise((resolve) => {
    const request = requestImpl({
      hostname: '127.0.0.1',
      port,
      path: '/health',
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
      timeout: timeoutMs,
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          resolve({ ok: false, error: `health returned HTTP ${response.statusCode}` });
          return;
        }
        try {
          const parsed = JSON.parse(body);
          const ok = parsed.status === 'ok' && parsed.port === port && parsed.db_mode === 'wal';
          resolve(ok ? { ok: true } : { ok: false, error: 'health response was not ready' });
        } catch {
          resolve({ ok: false, error: 'health response was not valid JSON' });
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('health probe timed out')));
    request.on('error', (error) => resolve({ ok: false, error: sanitizeError(error, token) }));
    request.end();
  });
}

export class LoopbackWatchdog {
  constructor(options = {}) {
    this.port = options.port ?? Number(process.env.KB_CACHE_DAEMON_PORT || DEFAULT_PORT);
    this.token = options.token ?? process.env.KB_CACHE_DAEMON_TOKEN ?? '';
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.repoRoot = options.repoRoot ?? REPO_ROOT;
    this.daemonPath = options.daemonPath ?? path.join(this.repoRoot, 'scripts', 'mcp-memory-daemon.mjs');
    this.telemetryPath = options.telemetryPath ?? DEFAULT_TELEMETRY_PATH;
    this.now = options.now ?? (() => Date.now());
    this.spawnImpl = options.spawnImpl ?? spawnChild;
    this.probeImpl = options.probeImpl ?? probeHealth;
    this.portOccupiedImpl = options.portOccupiedImpl ?? isPortOccupied;
    this.writeTelemetryImpl = options.writeTelemetryImpl ?? writeHealthTelemetry;
    this.sleepImpl = options.sleepImpl ?? sleep;
    this.child = null;
    this.status = 'stopped';
    this.consecutiveFailures = 0;
    this.restartTimes = [];
    this.lastError = null;
    this.interval = null;
  }

  recentRestartTimes() {
    const cutoff = this.now() - RESTART_WINDOW_MS;
    this.restartTimes = this.restartTimes.filter((timestamp) => timestamp >= cutoff);
    return this.restartTimes;
  }

  writeTelemetry() {
    this.writeTelemetryImpl(this.telemetryPath, {
      status: this.status,
      checked_at: new Date(this.now()).toISOString(),
      port: this.port,
      consecutive_failures: this.consecutiveFailures,
      restart_count_15m: this.recentRestartTimes().length,
      last_error: this.lastError,
      ...(this.child?.pid ? { owner_pid: this.child.pid } : {}),
    });
  }

  async start() {
    if (!this.token) throw new Error('KB_CACHE_DAEMON_TOKEN must be set');
    if (await this.portOccupiedImpl(this.port)) {
      throw new Error(`refusing to start: port ${this.port} is already occupied`);
    }

    this.status = 'starting';
    this.writeTelemetry();
    this.child = this.spawnImpl(process.execPath, [this.daemonPath], {
      cwd: this.repoRoot,
      env: {
        ...process.env,
        KB_CACHE_DAEMON_PORT: String(this.port),
        KB_CACHE_DAEMON_TOKEN: this.token,
      },
      stdio: 'inherit',
    });
    this.child.once?.('exit', () => {
      if (this.status !== 'stopped' && this.status !== 'alert_only') this.child = null;
    });
    return this.child;
  }

  async stopOwnedChild() {
    const child = this.child;
    if (!child) return;
    await new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        child.kill?.('SIGKILL');
        finish();
      }, 5_000);
      child.once?.('exit', finish);
      if (child.exitCode != null || child.killed) finish();
      else child.kill?.('SIGTERM');
    });
    if (this.child === child) this.child = null;
  }

  async restartOwnedChild() {
    if (this.recentRestartTimes().length >= MAX_RESTARTS) {
      this.status = 'alert_only';
      this.lastError = 'restart limit exceeded';
      this.writeTelemetry();
      return false;
    }

    this.restartTimes.push(this.now());
    await this.stopOwnedChild();
    await this.sleepImpl(0);
    await this.start();
    this.consecutiveFailures = 0;
    return true;
  }

  async checkOnce() {
    if (this.status === 'alert_only' || this.status === 'stopped') return { ok: false, skipped: true };
    const result = await this.probeImpl({
      port: this.port,
      token: this.token,
      timeoutMs: this.timeoutMs,
    });
    if (result.ok) {
      this.status = 'healthy';
      this.consecutiveFailures = 0;
      this.lastError = null;
      this.writeTelemetry();
      return result;
    }

    this.consecutiveFailures += 1;
    this.status = 'degraded';
    this.lastError = sanitizeError(result.error, this.token);
    if (this.consecutiveFailures >= 2) await this.restartOwnedChild();
    this.writeTelemetry();
    return result;
  }

  async stop() {
    clearInterval(this.interval);
    this.interval = null;
    await this.stopOwnedChild();
    this.status = 'stopped';
    this.writeTelemetry();
  }

  async run() {
    await this.start();
    await this.checkOnce();
    this.interval = setInterval(() => {
      this.checkOnce().catch((error) => {
        this.status = 'degraded';
        this.lastError = sanitizeError(error, this.token);
        this.writeTelemetry();
      });
    }, this.intervalMs);
    await new Promise((resolve) => {
      const shutdown = () => this.stop().then(resolve, resolve);
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    });
  }
}

const entryUrl = pathToFileURL(path.resolve(process.argv[1] || '')).href;
if (entryUrl === import.meta.url) {
  const watchdog = new LoopbackWatchdog();
  watchdog.run().catch((error) => {
    process.stderr.write(`[loopback-watchdog] ${sanitizeError(error, watchdog.token)}\n`);
    process.exitCode = 1;
  });
}
