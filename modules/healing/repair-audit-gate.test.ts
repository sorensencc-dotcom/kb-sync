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

test('parseDiagnostics parses multi-line compiler output', () => {
  const output = `
src/a.ts(4,7): error TS2322: Type string is not assignable to type number.
src/b.ts:10:15 - warning TS6133: 'x' is declared but its value is never read.
unrelated line
  `;
  const diagnostics = parseDiagnostics(output, 'compiler');
  assert.equal(diagnostics.length, 2);

  assert.equal(diagnostics[0].kind, 'compiler');
  assert.equal(diagnostics[0].file, 'src/a.ts');
  assert.equal(diagnostics[0].line, 4);
  assert.equal(diagnostics[0].column, 7);
  assert.equal(diagnostics[0].code, 'TS2322');
  assert.equal(diagnostics[0].message, 'Type string is not assignable to type number.');

  assert.equal(diagnostics[1].kind, 'compiler');
  assert.equal(diagnostics[1].file, 'src/b.ts');
  assert.equal(diagnostics[1].line, 10);
  assert.equal(diagnostics[1].column, 15);
  assert.equal(diagnostics[1].code, 'TS6133');
  assert.equal(diagnostics[1].message, '\'x\' is declared but its value is never read.');
});

test('parseDiagnostics parses multi-line linter output', () => {
  const output = `
src/a.ts:4:7: error Variable used before definition no-use-before-define
src/c.ts:2:1: warning Unexpected console statement no-console
malformed output line here
  `;
  const diagnostics = parseDiagnostics(output, 'linter');
  assert.equal(diagnostics.length, 2);

  assert.equal(diagnostics[0].kind, 'linter');
  assert.equal(diagnostics[0].file, 'src/a.ts');
  assert.equal(diagnostics[0].line, 4);
  assert.equal(diagnostics[0].column, 7);
  assert.equal(diagnostics[0].code, 'no-use-before-define');
  assert.equal(diagnostics[0].message, 'Variable used before definition');

  assert.equal(diagnostics[1].kind, 'linter');
  assert.equal(diagnostics[1].file, 'src/c.ts');
  assert.equal(diagnostics[1].line, 2);
  assert.equal(diagnostics[1].column, 1);
  assert.equal(diagnostics[1].code, 'no-console');
  assert.equal(diagnostics[1].message, 'Unexpected console statement');
});

test('parseDiagnostics handles empty and malformed outputs', () => {
  const emptyOutput = parseDiagnostics('', 'compiler');
  assert.equal(emptyOutput.length, 0);

  const whitespaceOutput = parseDiagnostics('   \n  \t  ', 'linter');
  assert.equal(whitespaceOutput.length, 0);

  const malformedOutput = parseDiagnostics('Something went wrong during compilation\nLine 2', 'compiler');
  assert.equal(malformedOutput.length, 0);
});
