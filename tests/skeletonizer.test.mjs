import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { skeletonizeFile } from '../modules/compactor/skeletonizer.mjs';

const repoRoot = path.resolve('.');

test('skeletonizeFile strips function bodies and replaces with throw statement', () => {
  const tmpFile = path.join(repoRoot, '.tmp-test-sample.ts');
  const code = `
    /**
     * Calculates sum of two numbers.
     * @param a first number
     * @param b second number
     */
    export function add(a: number, b: number): number {
      const sum = a + b;
      return sum;
    }
  `;
  fs.writeFileSync(tmpFile, code, 'utf8');

  try {
    const res = skeletonizeFile(tmpFile, '.tmp-test-sample.ts', 'hash123', 'unit test');
    assert.strictEqual(res.state, 'Skeleton');
    assert.ok(res.content.includes('add(a: number, b: number): number'));
    assert.ok(res.content.includes('Calculates sum of two numbers'));
    assert.ok(res.content.includes('throw new Error("[COMPACTED SKELETON: IMPLEMENTATION STRIPPED - DO NOT EXECUTE]")'));
    assert.strictEqual(res.content.includes('const sum = a + b'), false);
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('skeletonizeFile transforms FunctionExpressions and ArrowFunctions', () => {
  const tmpFile = path.join(repoRoot, '.tmp-test-fn.js');
  const code = `
    const multiply = function(x, y) { return x * y; };
    const divide = (x, y) => { return x / y; };
  `;
  fs.writeFileSync(tmpFile, code, 'utf8');

  try {
    const res = skeletonizeFile(tmpFile, '.tmp-test-fn.js', 'hash123', 'unit test');
    assert.strictEqual(res.state, 'Skeleton');
    assert.ok(res.content.includes('const multiply = function'));
    assert.ok(res.content.includes('const divide ='));
    assert.strictEqual(res.content.includes('return x * y'), false);
    assert.strictEqual(res.content.includes('return x / y'), false);
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('skeletonizeFile fails closed on malformed syntax and returns original text', () => {
  const tmpFile = path.join(repoRoot, '.tmp-test-bad.ts');
  const code = `function badSyntax( { return ;`;
  fs.writeFileSync(tmpFile, code, 'utf8');

  try {
    const res = skeletonizeFile(tmpFile, '.tmp-test-bad.ts', 'hash123', 'unit test');
    assert.strictEqual(res.state, 'Full');
    assert.strictEqual(res.content, code);
    assert.ok(typeof res.warning === 'string' && res.warning.length > 0, `Expected warning string, got: ${res.warning}`);
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});
