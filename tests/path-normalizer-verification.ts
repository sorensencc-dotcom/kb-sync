import { toPosixPath, toWindowsPath, toWslPath } from '../core/path-normalizer.mjs';

console.log('================================================================================');
console.log('Path Normalizer Verification Tests');
console.log('================================================================================');

// Test 1: toPosixPath
const posixResult = toPosixPath('C:\\dev\\kb-sync\\modules\\notebooklm');
console.log(`[TEST 1] toPosixPath: ${posixResult}`);
if (posixResult !== 'C:/dev/kb-sync/modules/notebooklm') {
  console.error('FAIL: toPosixPath failed');
  process.exit(1);
}
console.log('  ✓ toPosixPath passed');

// Test 2: toWindowsPath from /mnt/c/
const winResultMnt = toWindowsPath('/mnt/c/dev/kb-sync/repo_knowledge_pack.txt');
console.log(`[TEST 2] toWindowsPath (/mnt/c/): ${winResultMnt}`);
if (winResultMnt !== 'c:\\dev\\kb-sync\\repo_knowledge_pack.txt') {
  console.error('FAIL: toWindowsPath (/mnt/c/) failed');
  process.exit(1);
}
console.log('  ✓ toWindowsPath (/mnt/c/) passed');

// Test 3: toWslPath from C:\
const wslResult = toWslPath('C:\\dev\\kb-sync\\configs\\global.yaml');
console.log(`[TEST 3] toWslPath: ${wslResult}`);
if (wslResult !== '/mnt/c/dev/kb-sync/configs/global.yaml') {
  console.error('FAIL: toWslPath failed');
  process.exit(1);
}
console.log('  ✓ toWslPath passed');

console.log('================================================================================');
console.log('SUCCESS: All path normalizer tests passed!');
console.log('================================================================================');
