import test from 'node:test';
import assert from 'node:assert/strict';
import { auditRepair, buildRecipe, findCollisions, parseDiagnostics, type Diagnostic, type Collision } from './repair-audit-gate.ts';

test('parseDiagnostics parses various compiler diagnostic formats', () => {
  const output = `
src/a.ts(4,7): error TS2322: Type string is not assignable to type number.
src/b.ts:10:15 - warning TS6133: 'x' is declared but its value is never read.
invalid line that should be ignored
  `;
  const result = parseDiagnostics(output, 'compiler');
  assert.equal(result.length, 2);

  assert.deepEqual(result[0], {
    kind: 'compiler',
    file: 'src/a.ts',
    line: 4,
    column: 7,
    code: 'TS2322',
    message: 'Type string is not assignable to type number.',
    raw: 'src/a.ts(4,7): error TS2322: Type string is not assignable to type number.'
  });

  assert.deepEqual(result[1], {
    kind: 'compiler',
    file: 'src/b.ts',
    line: 10,
    column: 15,
    code: 'TS6133',
    message: "'x' is declared but its value is never read.",
    raw: "src/b.ts:10:15 - warning TS6133: 'x' is declared but its value is never read."
  });
});

test('parseDiagnostics parses linter diagnostics', () => {
  const output = `
src/a.ts:4:7: error no-use-before-define Variable used before definition
src/c.ts:12:1: warning Extra semicolon semi
  `;
  const result = parseDiagnostics(output, 'linter');
  assert.equal(result.length, 2);

  assert.deepEqual(result[0], {
    kind: 'linter',
    file: 'src/a.ts',
    line: 4,
    column: 7,
    code: 'definition',
    message: 'no-use-before-define Variable used before',
    raw: 'src/a.ts:4:7: error no-use-before-define Variable used before definition'
  });

  assert.deepEqual(result[1], {
    kind: 'linter',
    file: 'src/c.ts',
    line: 12,
    column: 1,
    code: 'semi',
    message: 'Extra semicolon',
    raw: 'src/c.ts:12:1: warning Extra semicolon semi'
  });
});

test('parseDiagnostics handles empty lines and invalid output gracefully', () => {
  const result = parseDiagnostics('\\n\\n   \\n\\n', 'compiler');
  assert.equal(result.length, 0);
});

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
