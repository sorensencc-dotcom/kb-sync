import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toPosixPath,
  toWindowsPath,
  toWslPath,
  normalizeNativePath
} from '../../core/path-normalizer.mjs';

test('toPosixPath', (t) => {
  assert.equal(toPosixPath(''), '');
  assert.equal(toPosixPath(undefined), '');
  assert.equal(toPosixPath(null), '');
  assert.equal(toPosixPath('C:\\dev\\kb-sync\\modules\\notebooklm'), 'C:/dev/kb-sync/modules/notebooklm');
  assert.equal(toPosixPath('C:/already/posix/path'), 'C:/already/posix/path');
  assert.equal(toPosixPath('/unix/style/path'), '/unix/style/path');
});

test('toWindowsPath', (t) => {
  assert.equal(toWindowsPath(''), '');
  assert.equal(toWindowsPath(undefined), '');
  assert.equal(toWindowsPath(null), '');
  assert.equal(toWindowsPath('/mnt/c/dev/kb-sync/repo_knowledge_pack.txt'), 'c:\\dev\\kb-sync\\repo_knowledge_pack.txt');
  assert.equal(toWindowsPath('/mnt/D/dev/kb-sync'), 'D:\\dev\\kb-sync');
  assert.equal(toWindowsPath('/c/dev/kb-sync'), 'c:\\dev\\kb-sync');
  assert.equal(toWindowsPath('/E/dev/kb-sync'), 'E:\\dev\\kb-sync');
  assert.equal(toWindowsPath('C:/already/windows/path'), 'C:\\already\\windows\\path');
});

test('toWslPath', (t) => {
  assert.equal(toWslPath(''), '');
  assert.equal(toWslPath(undefined), '');
  assert.equal(toWslPath(null), '');
  assert.equal(toWslPath('C:\\dev\\kb-sync\\configs\\global.yaml'), '/mnt/c/dev/kb-sync/configs/global.yaml');
  assert.equal(toWslPath('D:\\dev\\kb-sync'), '/mnt/d/dev/kb-sync');
  assert.equal(toWslPath('E:/dev/kb-sync'), '/mnt/e/dev/kb-sync');
  assert.equal(toWslPath('/mnt/c/already/wsl'), '/mnt/c/already/wsl');
  assert.equal(toWslPath('/home/user/path'), '/home/user/path');
});

test('normalizeNativePath', (t) => {
  const originalPlatform = process.platform;

  // Test win32
  Object.defineProperty(process, 'platform', { value: 'win32' });
  assert.equal(normalizeNativePath('/mnt/c/dev/kb-sync/repo_knowledge_pack.txt'), 'c:\\dev\\kb-sync\\repo_knowledge_pack.txt');
  assert.equal(normalizeNativePath('C:\\dev\\kb-sync'), 'C:\\dev\\kb-sync');
  assert.equal(normalizeNativePath('C:/dev/kb-sync'), 'C:\\dev\\kb-sync');

  // Test linux
  Object.defineProperty(process, 'platform', { value: 'linux' });
  assert.equal(normalizeNativePath('C:\\dev\\kb-sync\\modules\\notebooklm'), 'C:/dev/kb-sync/modules/notebooklm');
  assert.equal(normalizeNativePath('/mnt/c/dev/kb-sync/repo_knowledge_pack.txt'), '/mnt/c/dev/kb-sync/repo_knowledge_pack.txt');
  assert.equal(normalizeNativePath('C:/dev/kb-sync'), 'C:/dev/kb-sync');

  // Test darwin (should act like posix)
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  assert.equal(normalizeNativePath('C:\\dev\\kb-sync\\modules\\notebooklm'), 'C:/dev/kb-sync/modules/notebooklm');

  Object.defineProperty(process, 'platform', { value: originalPlatform });
});
