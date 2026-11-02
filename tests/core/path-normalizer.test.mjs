import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  toPosixPath,
  toWindowsPath,
  toWslPath,
  normalizeNativePath
} from '../../core/path-normalizer.mjs';

describe('toPosixPath', () => {
  test('returns empty string for falsy values', () => {
    assert.equal(toPosixPath(undefined), '');
    assert.equal(toPosixPath(null), '');
    assert.equal(toPosixPath(''), '');
  });

  test('converts backslashes to forward slashes', () => {
    assert.equal(toPosixPath('C:\\dev\\kb-sync'), 'C:/dev/kb-sync');
    assert.equal(toPosixPath('path\\to\\file.txt'), 'path/to/file.txt');
  });

  test('leaves forward slashes intact', () => {
    assert.equal(toPosixPath('C:/dev/kb-sync'), 'C:/dev/kb-sync');
    assert.equal(toPosixPath('path/to/file.txt'), 'path/to/file.txt');
  });

  test('handles mixed slashes', () => {
    assert.equal(toPosixPath('C:\\dev/kb-sync\\test'), 'C:/dev/kb-sync/test');
  });

  test('converts non-string inputs to string', () => {
    assert.equal(toPosixPath(123), '123');
  });
});

describe('toWindowsPath', () => {
  test('returns empty string for falsy values', () => {
    assert.equal(toWindowsPath(undefined), '');
    assert.equal(toWindowsPath(null), '');
    assert.equal(toWindowsPath(''), '');
  });

  test('converts /mnt/c/ paths to C:\\', () => {
    assert.equal(toWindowsPath('/mnt/c/dev/kb-sync'), 'c:\\dev\\kb-sync');
    assert.equal(toWindowsPath('/mnt/D/path/to/file'), 'D:\\path\\to\\file');
  });

  test('converts /c/ paths to C:\\', () => {
    assert.equal(toWindowsPath('/c/dev/kb-sync'), 'c:\\dev\\kb-sync');
    assert.equal(toWindowsPath('/D/path/to/file'), 'D:\\path\\to\\file');
  });

  test('converts forward slashes to backslashes', () => {
    assert.equal(toWindowsPath('C:/dev/kb-sync'), 'C:\\dev\\kb-sync');
    assert.equal(toWindowsPath('path/to/file'), 'path\\to\\file');
  });

  test('leaves backslashes intact', () => {
    assert.equal(toWindowsPath('C:\\dev\\kb-sync'), 'C:\\dev\\kb-sync');
  });

  test('converts non-string inputs to string', () => {
    assert.equal(toWindowsPath(123), '123');
  });
});

describe('toWslPath', () => {
  test('returns empty string for falsy values', () => {
    assert.equal(toWslPath(undefined), '');
    assert.equal(toWslPath(null), '');
    assert.equal(toWslPath(''), '');
  });

  test('converts C:\\ paths to /mnt/c/', () => {
    assert.equal(toWslPath('C:\\dev\\kb-sync'), '/mnt/c/dev/kb-sync');
    assert.equal(toWslPath('d:\\path\\to\\file'), '/mnt/d/path/to/file');
  });

  test('converts C:/ paths to /mnt/c/', () => {
    assert.equal(toWslPath('C:/dev/kb-sync'), '/mnt/c/dev/kb-sync');
    assert.equal(toWslPath('d:/path/to/file'), '/mnt/d/path/to/file');
  });

  test('leaves already wsl paths intact', () => {
    assert.equal(toWslPath('/mnt/c/dev/kb-sync'), '/mnt/c/dev/kb-sync');
  });
});

describe('normalizeNativePath', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  test('uses toWindowsPath when platform is win32', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    assert.equal(normalizeNativePath('/mnt/c/dev/kb-sync'), 'c:\\dev\\kb-sync');
    assert.equal(normalizeNativePath('C:/dev/kb-sync'), 'C:\\dev\\kb-sync');
  });

  test('uses toPosixPath when platform is not win32', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    assert.equal(normalizeNativePath('C:\\dev\\kb-sync'), 'C:/dev/kb-sync');
    assert.equal(normalizeNativePath('path\\to\\file'), 'path/to/file');
  });

  test('uses toPosixPath when platform is darwin', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    assert.equal(normalizeNativePath('C:\\dev\\kb-sync'), 'C:/dev/kb-sync');
  });
});
