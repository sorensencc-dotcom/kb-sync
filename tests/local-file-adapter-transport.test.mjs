import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LocalFileAdapterTransport } from '../modules/adapters/LocalFileAdapterTransport.mjs';

test('LocalFileAdapterTransport', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-file-adapter-test-'));

  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test('throws when file does not exist', async () => {
    const transport = new LocalFileAdapterTransport({
      filePath: path.join(tmpDir, 'does-not-exist.json'),
    });

    await assert.rejects(
      async () => transport.fetch(),
      { message: /File not found at transport path:/ }
    );
  });

  await t.test('reads and parses JSON using default parser', async () => {
    const filePath = path.join(tmpDir, 'valid.json');
    const mockData = { id: 'test-id', value: 42 };
    fs.writeFileSync(filePath, JSON.stringify(mockData));

    const transport = new LocalFileAdapterTransport({ filePath });
    const result = await transport.fetch();

    assert.deepEqual(result, mockData);
  });

  await t.test('uses custom parse function', async () => {
    const filePath = path.join(tmpDir, 'custom.txt');
    const mockData = 'line1\nline2';
    fs.writeFileSync(filePath, mockData);

    const transport = new LocalFileAdapterTransport({
      filePath,
      parse: (raw) => raw.split('\n'),
    });
    const result = await transport.fetch();

    assert.deepEqual(result, ['line1', 'line2']);
  });
});
