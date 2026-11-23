import test from 'node:test';
import assert from 'node:assert/strict';
import { lintSourceFile } from '../scripts/lint-invariants.mjs';

test('lintSourceFile: catches shell: true in execFile and spawn calls', () => {
  const badSource = `
    import { execFile, spawn } from 'node:child_process';
    execFile('cmd.exe', ['/c'], { shell: true, timeout: 5000 });
    spawn('node', ['index.js'], { shell: true });
  `;
  const violations = lintSourceFile('bad-process.js', badSource);
  assert.equal(violations.length, 2);
  assert.equal(violations[0].rule, 'no-shell-true');
  assert.match(violations[0].message, /Avoid 'shell: true'/);
  assert.match(violations[0].message, /DEP0190/);
  assert.equal(violations[1].rule, 'no-shell-true');
});

test('lintSourceFile: permits shell: false or omitted shell', () => {
  const goodSource = `
    import { spawnSync, execFileSync } from 'node:child_process';
    spawnSync('cmd.exe', ['/c', 'dir'], { shell: false, windowsHide: true });
    execFileSync('git', ['status'], { windowsHide: true });
  `;
  const violations = lintSourceFile('good-process.js', goodSource);
  assert.equal(violations.length, 0);
});

test('lintSourceFile: catches raw writes to protected state files', () => {
  const badStateSource = `
    import fs from 'node:fs';
    fs.writeFileSync('.sync-status.json', JSON.stringify({ status: 'ok' }));
    fs.promises.writeFile('.nlm-quarantine.json', data);
  `;
  const violations = lintSourceFile('modules/bad-state.js', badStateSource);
  assert.equal(violations.length, 2);
  assert.equal(violations[0].rule, 'no-unlocked-state-rmw');
  assert.match(violations[0].message, /Raw write to state file '\.sync-status\.json'/);
  assert.match(violations[0].message, /updateJsonLocked/);
  assert.equal(violations[1].rule, 'no-unlocked-state-rmw');
  assert.match(violations[1].message, /Raw write to state file '\.nlm-quarantine\.json'/);
});

test('lintSourceFile: exempts test files from raw state write rule', () => {
  const testStateSource = `
    import fs from 'node:fs';
    fs.writeFileSync('.sync-status.json', JSON.stringify({ mock: true }));
  `;
  const violations = lintSourceFile('tests/sync-status.test.mjs', testStateSource);
  assert.equal(violations.length, 0);
});

test('lintSourceFile: exempts dedicated lock managers from raw state write rule', () => {
  const lockManagerSource = `
    import fs from 'node:fs';
    fs.writeFileSync('.nlm-sync.lock', String(process.pid));
  `;
  const violations = lintSourceFile('core/pid-lock.mjs', lockManagerSource);
  assert.equal(violations.length, 0);
});
