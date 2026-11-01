import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDaemonAuth, createHealthResponse } from '../scripts/mcp-memory-daemon.mjs';

const database = (journalMode) => ({
  prepare() {
    return { get: () => ({ journal_mode: journalMode }) };
  },
});
const startedWith = (journalMode) => ({
  memory: { daemonDatabase: () => database(journalMode) },
});

async function responseJson(response) {
  return response.json();
}

test('health reports 503 before daemon readiness', async () => {
  const response = createHealthResponse(null, 8765);

  assert.equal(response.status, 503);
  assert.deepEqual(await responseJson(response), { status: 'starting' });
});

test('health reports configured port and WAL readiness', async () => {
  const response = createHealthResponse(startedWith('wal'), 9876);

  assert.equal(response.status, 200);
  assert.deepEqual(await responseJson(response), {
    status: 'ok',
    port: 9876,
    db_mode: 'wal',
  });
});

test('health reports degraded database mode', async () => {
  const response = createHealthResponse(startedWith('delete'), 8765);

  assert.equal(response.status, 503);
  assert.deepEqual(await responseJson(response), {
    status: 'degraded',
    port: 8765,
    db_mode: 'delete',
  });
});

test('health authentication rejects a missing token', () => {
  const previous = process.env.KB_CACHE_DAEMON_TOKEN;
  process.env.KB_CACHE_DAEMON_TOKEN = 'health-test-token';
  try {
    const response = assertDaemonAuth(new Request('http://127.0.0.1:8765/health'));
    assert.equal(response.status, 401);
  } finally {
    if (previous === undefined) delete process.env.KB_CACHE_DAEMON_TOKEN;
    else process.env.KB_CACHE_DAEMON_TOKEN = previous;
  }
});
test('health authentication rejects an invalid token', () => {
  const previous = process.env.KB_CACHE_DAEMON_TOKEN;
  process.env.KB_CACHE_DAEMON_TOKEN = 'health-test-token';
  try {
    const response = assertDaemonAuth(new Request('http://127.0.0.1:8765/health', {
      headers: { authorization: 'Bearer wrong-token' },
    }));
    assert.equal(response.status, 401);
  } finally {
    if (previous === undefined) delete process.env.KB_CACHE_DAEMON_TOKEN;
    else process.env.KB_CACHE_DAEMON_TOKEN = previous;
  }
});
