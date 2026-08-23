import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const text = 'A grounded source passage for TRM citation testing.';
const sha256 = (str) => `sha256:${crypto.createHash('sha256').update(str, 'utf8').digest('hex')}`;
const revision = sha256(text);
const spanHash = sha256(text.slice(0, 10));

function createValidFixture() {
  const result = {
    schema: 'research.result.v1',
    task_id: 'TASK-RUNNER-001',
    run_id: 'RUN-RUNNER-001',
    status: 'completed',
    producer: {
      engine: 'torquequery',
      provider: 'fixture',
      model: 'fixture',
      prompt_version: 'v1',
    },
    requires_approval: true,
    payload: {
      target_claim_ids: ['claim-1'],
      findings: [
        {
          type: 'observation',
          source_id: 'SRC-1',
          source_revision: revision,
          source_span: {
            start: 0,
            end: 10,
            span_hash: spanHash,
          },
          confidence: 0.95,
          rationale: 'Direct grounded citation.',
        },
      ],
    },
  };

  const sources = {
    'SRC-1': {
      title: 'Ground Truth Source 1',
      url: 'https://example.test/source1',
      retrieved_at: '2026-08-22T12:00:00Z',
      text,
      revision,
    },
  };

  return { result, sources };
}

function createTempWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trm-cli-test-'));
  return {
    dir,
    writeJson(name, data) {
      const filePath = path.join(dir, name);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      return filePath;
    },
    cleanup() {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    },
  };
}

function parseReceiptIfPresent(stdout) {
  const lines = stdout.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (parsed && typeof parsed === 'object' && parsed.batch_id && parsed.validation) {
        return parsed;
      }
    } catch {}
  }
  return null;
}

test('CLI materializes approved result and emits JSON receipt via direct Node', () => {
  const ws = createTempWorkspace();
  try {
    const { result, sources } = createValidFixture();
    const resultFile = ws.writeJson('result.json', result);
    const sourcesFile = ws.writeJson('sources.json', sources);
    const stagingRoot = path.join(ws.dir, 'staging');

    const run = spawnSync(
      process.execPath,
      [
        'scripts/materialize-approved-result.mjs',
        '--result', resultFile,
        '--sources', sourcesFile,
        '--staging-root', stagingRoot,
        '--batch-id', 'batch-node-success',
        '--approved',
      ],
      { encoding: 'utf8', cwd: process.cwd() }
    );

    assert.equal(run.status, 0, `Process failed: ${run.stderr}`);
    const receipt = parseReceiptIfPresent(run.stdout);
    assert.ok(receipt, 'Receipt must be emitted as JSON on stdout');
    assert.equal(receipt.batch_id, 'batch-node-success');
    assert.equal(receipt.task_id, 'TASK-RUNNER-001');
    assert.equal(receipt.run_id, 'RUN-RUNNER-001');
    assert.equal(receipt.validation.valid, true);

    const batchDir = path.join(stagingRoot, 'trm', 'batch-node-success');
    assert.ok(fs.existsSync(path.join(batchDir, 'payload.json')));
    assert.ok(fs.existsSync(path.join(batchDir, 'sources.manifest.json')));
    assert.ok(fs.existsSync(path.join(batchDir, 'FILES.manifest.txt')));
    assert.ok(fs.existsSync(path.join(batchDir, 'sources', 'src-1.md')));
  } finally {
    ws.cleanup();
  }
});

test('CLI materializes approved result via npm run trm:materialize-approved', () => {
  const ws = createTempWorkspace();
  try {
    const { result, sources } = createValidFixture();
    const resultFile = ws.writeJson('result.json', result);
    const sourcesFile = ws.writeJson('sources.json', sources);
    const stagingRoot = path.join(ws.dir, 'staging-npm');

    const npmArgs = [
      'run',
      'trm:materialize-approved',
      '--',
      '--result', resultFile,
      '--sources', sourcesFile,
      '--staging-root', stagingRoot,
      '--batch-id', 'batch-npm-success',
      '--approved',
    ];

    const run =
      process.platform === 'win32'
        ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm', ...npmArgs], { encoding: 'utf8', cwd: process.cwd() })
        : spawnSync('npm', npmArgs, { encoding: 'utf8', cwd: process.cwd() });

    assert.equal(run.status, 0, `npm run failed: ${run.stderr}`);
    const receipt = parseReceiptIfPresent(run.stdout);
    assert.ok(receipt, 'Valid receipt must be present in npm command output');
    assert.equal(receipt.batch_id, 'batch-npm-success');
    assert.equal(receipt.validation.valid, true);

    const batchDir = path.join(stagingRoot, 'trm', 'batch-npm-success');
    assert.ok(fs.existsSync(path.join(batchDir, 'payload.json')));
    assert.ok(fs.existsSync(path.join(batchDir, 'sources', 'src-1.md')));
  } finally {
    ws.cleanup();
  }
});

test('CLI rejects result without --approved and emits no receipt', () => {
  const ws = createTempWorkspace();
  try {
    const { result, sources } = createValidFixture();
    const resultFile = ws.writeJson('result.json', result);
    const sourcesFile = ws.writeJson('sources.json', sources);
    const stagingRoot = path.join(ws.dir, 'staging-unapproved');

    const run = spawnSync(
      process.execPath,
      [
        'scripts/materialize-approved-result.mjs',
        '--result', resultFile,
        '--sources', sourcesFile,
        '--staging-root', stagingRoot,
        '--batch-id', 'batch-unapproved',
      ],
      { encoding: 'utf8', cwd: process.cwd() }
    );

    assert.notEqual(run.status, 0, 'CLI must exit with non-zero status when unapproved');
    assert.match(run.stderr, /--approved|explicitly approved/);
    const receipt = parseReceiptIfPresent(run.stdout);
    assert.equal(receipt, null, 'No valid receipt may be emitted on unapproved execution');
    assert.equal(fs.existsSync(path.join(stagingRoot, 'trm', 'batch-unapproved')), false);
  } finally {
    ws.cleanup();
  }
});

test('CLI rejects source revision mismatch and emits no receipt', () => {
  const ws = createTempWorkspace();
  try {
    const { result, sources } = createValidFixture();
    result.payload.findings[0].source_revision = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
    const resultFile = ws.writeJson('corrupt-rev-result.json', result);
    const sourcesFile = ws.writeJson('sources.json', sources);
    const stagingRoot = path.join(ws.dir, 'staging-corrupt-rev');

    const run = spawnSync(
      process.execPath,
      [
        'scripts/materialize-approved-result.mjs',
        '--result', resultFile,
        '--sources', sourcesFile,
        '--staging-root', stagingRoot,
        '--batch-id', 'batch-corrupt-rev',
        '--approved',
      ],
      { encoding: 'utf8', cwd: process.cwd() }
    );

    assert.notEqual(run.status, 0, 'Must exit with non-zero status on revision mismatch');
    assert.match(run.stderr, /source revision mismatch/);
    const receipt = parseReceiptIfPresent(run.stdout);
    assert.equal(receipt, null, 'No receipt emitted on revision mismatch');
  } finally {
    ws.cleanup();
  }
});

test('CLI rejects span-hash mismatch and emits no receipt', () => {
  const ws = createTempWorkspace();
  try {
    const { result, sources } = createValidFixture();
    result.payload.findings[0].source_span.span_hash = 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    const resultFile = ws.writeJson('corrupt-span-result.json', result);
    const sourcesFile = ws.writeJson('sources.json', sources);
    const stagingRoot = path.join(ws.dir, 'staging-corrupt-span');

    const run = spawnSync(
      process.execPath,
      [
        'scripts/materialize-approved-result.mjs',
        '--result', resultFile,
        '--sources', sourcesFile,
        '--staging-root', stagingRoot,
        '--batch-id', 'batch-corrupt-span',
        '--approved',
      ],
      { encoding: 'utf8', cwd: process.cwd() }
    );

    assert.notEqual(run.status, 0, 'Must exit with non-zero status on span hash mismatch');
    assert.match(run.stderr, /source span hash mismatch/);
    const receipt = parseReceiptIfPresent(run.stdout);
    assert.equal(receipt, null, 'No receipt emitted on span hash mismatch');
  } finally {
    ws.cleanup();
  }
});

test('CLI rejects invalid span bounds and emits no receipt', () => {
  const ws = createTempWorkspace();
  try {
    const { result, sources } = createValidFixture();
    result.payload.findings[0].source_span = {
      start: 50,
      end: 10,
      span_hash: spanHash,
    };
    const resultFile = ws.writeJson('invalid-bounds-result.json', result);
    const sourcesFile = ws.writeJson('sources.json', sources);
    const stagingRoot = path.join(ws.dir, 'staging-invalid-bounds');

    const run = spawnSync(
      process.execPath,
      [
        'scripts/materialize-approved-result.mjs',
        '--result', resultFile,
        '--sources', sourcesFile,
        '--staging-root', stagingRoot,
        '--batch-id', 'batch-invalid-bounds',
        '--approved',
      ],
      { encoding: 'utf8', cwd: process.cwd() }
    );

    assert.notEqual(run.status, 0, 'Must exit with non-zero status on invalid span bounds');
    assert.match(run.stderr, /source span is invalid/);
    const receipt = parseReceiptIfPresent(run.stdout);
    assert.equal(receipt, null, 'No receipt emitted on invalid span bounds');
  } finally {
    ws.cleanup();
  }
});

test('CLI rejects missing source resolution and emits no receipt', () => {
  const ws = createTempWorkspace();
  try {
    const { result, sources } = createValidFixture();
    result.payload.findings[0].source_id = 'UNKNOWN-SOURCE-404';
    const resultFile = ws.writeJson('missing-source-result.json', result);
    const sourcesFile = ws.writeJson('sources.json', sources);
    const stagingRoot = path.join(ws.dir, 'staging-missing-src');

    const run = spawnSync(
      process.execPath,
      [
        'scripts/materialize-approved-result.mjs',
        '--result', resultFile,
        '--sources', sourcesFile,
        '--staging-root', stagingRoot,
        '--batch-id', 'batch-missing-src',
        '--approved',
      ],
      { encoding: 'utf8', cwd: process.cwd() }
    );

    assert.notEqual(run.status, 0, 'Must exit with non-zero status when source content is missing');
    assert.match(run.stderr, /source content is required/);
    const receipt = parseReceiptIfPresent(run.stdout);
    assert.equal(receipt, null, 'No receipt emitted on missing source');
  } finally {
    ws.cleanup();
  }
});

test('CLI rejects unsafe batch-id and emits no receipt', () => {
  const ws = createTempWorkspace();
  try {
    const { result, sources } = createValidFixture();
    const resultFile = ws.writeJson('result.json', result);
    const sourcesFile = ws.writeJson('sources.json', sources);
    const stagingRoot = path.join(ws.dir, 'staging-unsafe-id');

    const run = spawnSync(
      process.execPath,
      [
        'scripts/materialize-approved-result.mjs',
        '--result', resultFile,
        '--sources', sourcesFile,
        '--staging-root', stagingRoot,
        '--batch-id', '../unsafe_traversal',
        '--approved',
      ],
      { encoding: 'utf8', cwd: process.cwd() }
    );

    assert.notEqual(run.status, 0, 'Must exit non-zero for unsafe batch ID');
    assert.match(run.stderr, /--batch-id contains unsafe characters/);
    const receipt = parseReceiptIfPresent(run.stdout);
    assert.equal(receipt, null, 'No receipt emitted for unsafe batch ID');
  } finally {
    ws.cleanup();
  }
});

test('CLI rejects missing required parameters', () => {
  const run = spawnSync(
    process.execPath,
    ['scripts/materialize-approved-result.mjs', '--approved'],
    { encoding: 'utf8', cwd: process.cwd() }
  );

  assert.notEqual(run.status, 0, 'Must exit non-zero when required arguments are omitted');
  assert.match(run.stderr, /is required/);
  const receipt = parseReceiptIfPresent(run.stdout);
  assert.equal(receipt, null, 'No receipt emitted for missing arguments');
});
