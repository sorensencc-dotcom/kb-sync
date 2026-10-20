import test from 'node:test';
import assert from 'node:assert/strict';
import { auditRepair, buildRecipe, findCollisions, parseDiagnostics, type Diagnostic, type Collision } from './repair-audit-gate.ts';

test('parses TypeScript and ESLint diagnostics into a collision', () => {
  const compiler = parseDiagnostics('src/a.ts(4,7): error TS2322: Type string is not assignable to type number.', 'compiler');
  const linter = parseDiagnostics('src/a.ts:4:7: error no-use-before-define Variable used before definition', 'linter');
  const collisions = findCollisions([...compiler, ...linter]);
  assert.equal(collisions.length, 1);
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

test('buildRecipe: handles empty diagnostics and collisions', () => {
  const recipe = buildRecipe([], []);
  assert.equal(recipe.length, 3);
  assert.equal(recipe[0], 'Freeze the current working tree; do not apply edits while this audit is active.');
  assert.equal(recipe[1], 'No parseable compiler or linter diagnostics were found; rerun the failed gate with raw tool output attached.');
  assert.equal(recipe[2], 'Do not mark the repair complete until both gates pass and the final diff remains within declared scope.');
});

test('buildRecipe: handles diagnostics but no collisions', () => {
  const diagnostics: Diagnostic[] = [
    { kind: 'compiler', file: 'src/b.ts', line: 10, message: 'some error', raw: '' }
  ];
  const recipe = buildRecipe([], diagnostics);
  assert.equal(recipe.length, 3);
  assert.equal(recipe[1], 'Resolve diagnostics in compiler-first order, rerun the compiler, then rerun the linter to detect remaining findings.');
});

test('buildRecipe: handles collisions without scope violations', () => {
  const diagnostics: Diagnostic[] = [
    { kind: 'compiler', file: 'src/c.ts', line: 5, message: 'compiler error', code: 'TS123', raw: '' },
    { kind: 'linter', file: 'src/c.ts', line: 5, message: 'linter error', code: 'rule', raw: '' }
  ];
  const collisions: Collision[] = [
    { file: 'src/c.ts', line: 5, diagnostics }
  ];
  const recipe = buildRecipe(collisions, diagnostics);
  assert.equal(recipe.length, 3);
  assert.equal(recipe[1], 'Resolve src/c.ts:5 as one change set, then rerun the compiler and linter; compiler TS123: compiler error; linter rule: linter error.');
});

test('buildRecipe: handles out of scope diagnostics', () => {
  const diagnostics: Diagnostic[] = [
    { kind: 'compiler', file: 'src/out-of-scope.ts', line: 1, message: 'error', raw: '' }
  ];
  const recipe = buildRecipe([], diagnostics, ['src/in-scope.ts']);
  assert.equal(recipe.length, 4);
  assert.equal(recipe[1], 'Restrict remediation to declared scope; 1 diagnostic(s) reference out-of-scope files.');
  assert.equal(recipe[2], 'Resolve diagnostics in compiler-first order, rerun the compiler, then rerun the linter to detect remaining findings.');
});
