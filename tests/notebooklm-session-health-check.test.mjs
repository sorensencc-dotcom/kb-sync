import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { checkSessionHealth } from '../modules/notebooklm/session-health-check.mjs';

test('checkSessionHealth', async (t) => {
  let tempDir;

  t.beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-check-test-'));
  });

  t.afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  await t.test('returns warning when .env file is missing', () => {
    const result = checkSessionHealth(tempDir);
    assert.deepEqual(result, {
      valid: false,
      tokenPresent: false,
      expired: false,
      warning: 'No .env file found in repository root.'
    });
  });

  await t.test('returns warning when NOTEBOOKLM_MASTER_TOKEN is missing in .env', () => {
    const envPath = path.join(tempDir, '.env');
    fs.writeFileSync(envPath, 'OTHER_VAR=value\n');

    const result = checkSessionHealth(tempDir);
    assert.deepEqual(result, {
      valid: false,
      tokenPresent: false,
      expired: false,
      warning: 'NOTEBOOKLM_MASTER_TOKEN key missing or empty in .env'
    });
  });

  await t.test('returns warning when NOTEBOOKLM_MASTER_TOKEN is empty', () => {
    const envPath = path.join(tempDir, '.env');
    fs.writeFileSync(envPath, 'NOTEBOOKLM_MASTER_TOKEN=\n');

    const result = checkSessionHealth(tempDir);
    assert.deepEqual(result, {
      valid: false,
      tokenPresent: false,
      expired: false,
      warning: 'NOTEBOOKLM_MASTER_TOKEN key missing or empty in .env'
    });
  });

  await t.test('returns warning when token is truncated or malformed (length < 20)', () => {
    const envPath = path.join(tempDir, '.env');
    fs.writeFileSync(envPath, 'NOTEBOOKLM_MASTER_TOKEN=shorttoken123\n');

    const result = checkSessionHealth(tempDir);
    assert.deepEqual(result, {
      valid: false,
      tokenPresent: true,
      expired: false,
      warning: 'NOTEBOOKLM_MASTER_TOKEN appears truncated or malformed.'
    });
  });

  await t.test('returns valid result for properly formatted token without quotes', () => {
    const envPath = path.join(tempDir, '.env');
    fs.writeFileSync(envPath, 'NOTEBOOKLM_MASTER_TOKEN=this_is_a_very_long_valid_token_string_here\n');

    const result = checkSessionHealth(tempDir);
    assert.deepEqual(result, {
      valid: true,
      tokenPresent: true,
      expired: false,
      warning: null
    });
  });

  await t.test('returns valid result for properly formatted token with single quotes', () => {
    const envPath = path.join(tempDir, '.env');
    fs.writeFileSync(envPath, "NOTEBOOKLM_MASTER_TOKEN='this_is_a_very_long_valid_token_string_here'\n");

    const result = checkSessionHealth(tempDir);
    assert.deepEqual(result, {
      valid: true,
      tokenPresent: true,
      expired: false,
      warning: null
    });
  });

  await t.test('returns valid result for properly formatted token with double quotes', () => {
    const envPath = path.join(tempDir, '.env');
    fs.writeFileSync(envPath, 'NOTEBOOKLM_MASTER_TOKEN="this_is_a_very_long_valid_token_string_here"\n');

    const result = checkSessionHealth(tempDir);
    assert.deepEqual(result, {
      valid: true,
      tokenPresent: true,
      expired: false,
      warning: null
    });
  });

  await t.test('returns valid result when there are spaces around the equals sign', () => {
    const envPath = path.join(tempDir, '.env');
    fs.writeFileSync(envPath, 'NOTEBOOKLM_MASTER_TOKEN = "this_is_a_very_long_valid_token_string_here"\n');

    const result = checkSessionHealth(tempDir);
    assert.deepEqual(result, {
      valid: true,
      tokenPresent: true,
      expired: false,
      warning: null
    });
  });
});
