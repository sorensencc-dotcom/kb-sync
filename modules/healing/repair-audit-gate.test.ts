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
