import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { toPosixPath, toWindowsPath, toWslPath, normalizeNativePath } from '../../core/path-normalizer.mjs';

describe('path-normalizer', () => {

  describe('toPosixPath', () => {
    test('returns empty string for falsy input', () => {
      assert.equal(toPosixPath(), '');
      assert.equal(toPosixPath(null), '');
      assert.equal(toPosixPath(''), '');
    });

    test('converts Windows backslashes to forward slashes', () => {
      assert.equal(toPosixPath('C:\\dev\\kb-sync'), 'C:/dev/kb-sync');
      assert.equal(toPosixPath('\\\\server\\share\\path'), '//server/share/path');
    });

    test('leaves POSIX paths unchanged', () => {
      assert.equal(toPosixPath('/usr/local/bin'), '/usr/local/bin');
      assert.equal(toPosixPath('C:/dev/kb-sync'), 'C:/dev/kb-sync');
    });

    test('handles mixed slashes', () => {
      assert.equal(toPosixPath('C:\\dev/kb-sync\\modules'), 'C:/dev/kb-sync/modules');
    });
  });

  describe('toWindowsPath', () => {
    test('returns empty string for falsy input', () => {
      assert.equal(toWindowsPath(), '');
      assert.equal(toWindowsPath(null), '');
      assert.equal(toWindowsPath(''), '');
    });

    test('converts /mnt/c/... style WSL paths to Windows paths', () => {
      assert.equal(toWindowsPath('/mnt/c/dev/kb-sync'), 'c:\\dev\\kb-sync');
      assert.equal(toWindowsPath('/mnt/D/games'), 'D:\\games');
    });

    test('converts /c/... style Git Bash paths to Windows paths', () => {
      assert.equal(toWindowsPath('/c/dev/kb-sync'), 'c:\\dev\\kb-sync');
      assert.equal(toWindowsPath('/Z/backup'), 'Z:\\backup');
    });

    test('converts forward slashes to backslashes', () => {
      assert.equal(toWindowsPath('C:/dev/kb-sync'), 'C:\\dev\\kb-sync');
      assert.equal(toWindowsPath('/var/log/syslog'), '\\var\\log\\syslog');
    });

    test('handles mixed slashes', () => {
      assert.equal(toWindowsPath('C:/dev\\kb-sync/modules'), 'C:\\dev\\kb-sync\\modules');
    });
  });

  describe('toWslPath', () => {
    test('returns empty string for falsy input', () => {
      assert.equal(toWslPath(), '');
      assert.equal(toWslPath(null), '');
      assert.equal(toWslPath(''), '');
    });

    test('converts Windows paths (with backslashes) to WSL paths', () => {
      assert.equal(toWslPath('C:\\dev\\kb-sync'), '/mnt/c/dev/kb-sync');
      assert.equal(toWslPath('D:\\games\\doom'), '/mnt/d/games/doom');
    });

    test('converts Windows paths (with forward slashes) to WSL paths', () => {
      assert.equal(toWslPath('C:/dev/kb-sync'), '/mnt/c/dev/kb-sync');
      assert.equal(toWslPath('E:/music/mp3'), '/mnt/e/music/mp3');
    });

    test('leaves existing WSL paths unchanged', () => {
      assert.equal(toWslPath('/mnt/c/dev/kb-sync'), '/mnt/c/dev/kb-sync');
    });

    test('leaves non-drive absolute paths unchanged', () => {
      assert.equal(toWslPath('/usr/local/bin'), '/usr/local/bin');
    });
  });

  describe('normalizeNativePath', () => {
    const originalPlatform = process.platform;

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    test('returns Windows path when platform is win32', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      assert.equal(normalizeNativePath('/mnt/c/dev/kb-sync'), 'c:\\dev\\kb-sync');
      assert.equal(normalizeNativePath('C:/dev/kb-sync'), 'C:\\dev\\kb-sync');
    });

    test('returns POSIX path when platform is linux', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      assert.equal(normalizeNativePath('C:\\dev\\kb-sync'), 'C:/dev/kb-sync');
      assert.equal(normalizeNativePath('/usr/local/bin'), '/usr/local/bin');
    });

    test('returns POSIX path when platform is darwin', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      assert.equal(normalizeNativePath('C:\\dev\\kb-sync'), 'C:/dev/kb-sync');
      assert.equal(normalizeNativePath('/Users/jules'), '/Users/jules');
    });
  });
});
