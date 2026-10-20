import test from 'node:test';
import assert from 'node:assert/strict';
import { auditRepair, findCollisions, parseDiagnostics } from './repair-audit-gate.ts';

test('parses TypeScript and ESLint diagnostics into a collision', () => {
  const compiler = parseDiagnostics('src/a.ts(4,7): error TS2322: Type string is not assignable to type number.', 'compiler');
  const linter = parseDiagnostics('src/a.ts:4:7: error no-use-before-define Variable used before definition', 'linter');
  const collisions = findCollisions([...compiler, ...linter]);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].diagnostics.length, 2);
});

test('findCollisions returns empty array for empty diagnostics', () => {
  const collisions = findCollisions([]);
  assert.equal(collisions.length, 0);
});

test('findCollisions ignores groups with only one diagnostic kind', () => {
  const compiler1 = parseDiagnostics('src/a.ts(4,7): error TS2322: Type string is not assignable to type number.', 'compiler');
  const compiler2 = parseDiagnostics('src/a.ts(4,10): error TS2323: Another error.', 'compiler');
  const collisions = findCollisions([...compiler1, ...compiler2]);
  assert.equal(collisions.length, 0);
});

test('findCollisions groups diagnostics correctly across different files and lines', () => {
  const compiler1 = parseDiagnostics('src/a.ts(4,7): error TS2322: Type string is not assignable to type number.', 'compiler');
  const linter1 = parseDiagnostics('src/a.ts:4:7: error no-use-before-define Variable used before definition', 'linter');

  const compiler2 = parseDiagnostics('src/b.ts(10,5): error TS1234: Some error.', 'compiler');
  const linter2 = parseDiagnostics('src/b.ts:10:5: error some-rule Some rule violation', 'linter');

  const collisions = findCollisions([...compiler1, ...linter1, ...compiler2, ...linter2]);
  assert.equal(collisions.length, 2);

  assert.equal(collisions[0].file, 'src/a.ts');
  assert.equal(collisions[0].line, 4);
  assert.equal(collisions[0].diagnostics.length, 2);

  assert.equal(collisions[1].file, 'src/b.ts');
  assert.equal(collisions[1].line, 10);
  assert.equal(collisions[1].diagnostics.length, 2);
});

test('findCollisions correctly handles file names with colons in them', () => {
  // Creating a diagnostic with a colon in the filename manually since parser might not support it natively
  const diagnostics = [
    { kind: 'compiler', file: 'C:/project/src/a.ts', line: 15, message: 'err1', raw: '' },
    { kind: 'linter', file: 'C:/project/src/a.ts', line: 15, message: 'err2', raw: '' }
  ] as any;
  const collisions = findCollisions(diagnostics);

  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].file, 'C:/project/src/a.ts');
  assert.equal(collisions[0].line, 15);
  assert.equal(collisions[0].diagnostics.length, 2);
});

test('emits a bounded compiler-first remediation recipe', () => {
  const result = auditRepair({
    compilerOutput: 'src/a.ts(4,7): error TS2322: Type string is not assignable to type number.',
    linterOutput: 'src/a.ts:4:7: error no-use-before-define Variable used before definition',
    declaredScope: ['src/a.ts']
  });
  assert.equal(result.status, 'FLAG');
  assert.match(result.recipe.join('\n'), /compiler and linter/);
  assert.match(result.recipe.join('\n'), /final diff remains within declared scope/);
});

test('does not invent diagnostics from unrelated output', () => {
  const result = auditRepair({ compilerOutput: 'build started', linterOutput: '0 problems' });
  assert.equal(result.status, 'PASS');
  assert.equal(result.diagnostics.length, 0);
  assert.match(result.recipe.join('\n'), /No parseable/);
});
