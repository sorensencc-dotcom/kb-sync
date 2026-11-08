#!/usr/bin/env node
/**
 * One-command TLC runner for PackReplaceGate.
 * Uses C:\\Users\\soren\\.tla\\jdk + tla2tools.jar (TLC 1.7.4), overridable via JAVA / TLA2TOOLS.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultJava = 'C:\\Users\\soren\\.tla\\jdk\\bin\\java.exe';
const defaultJar = 'C:\\Users\\soren\\.tla\\tla2tools.jar';
const java = process.env.JAVA || (fs.existsSync(defaultJava) ? defaultJava : 'java');
const jar = process.env.TLA2TOOLS || defaultJar;

if (!fs.existsSync(jar)) {
  console.error(`tla2tools.jar missing at ${jar}. Set TLA2TOOLS. Pinned: tlaplus v1.7.4.`);
  process.exit(2);
}

function tlc(cfg) {
  const meta = path.join(here, `.tlc-meta-${path.basename(cfg, '.cfg')}`);
  fs.rmSync(meta, { recursive: true, force: true });
  const r = spawnSync(
    java,
    [
      '-XX:+UseParallelGC',
      '-cp', jar,
      'tlc2.TLC',
      '-workers', '1',
      '-fp', '0',
      '-lncheck', 'final',
      '-config', cfg,
      '-metadir', meta,
      'PackReplaceGate.tla',
    ],
    { cwd: here, encoding: 'utf8' },
  );
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const violated = out.match(/Invariant (\S+) is violated/)?.[1] || null;
  const states = out.match(/(\d+) distinct states found/)?.[1] || '?';
  return { status: r.status, out, violated, states };
}

function expectPass(name, cfg) {
  const r = tlc(cfg);
  if (r.status !== 0 || r.violated) {
    console.error(`FAIL ${name}: expected pass, TLC exit ${r.status}, violated ${r.violated}`);
    console.error(r.out.slice(-2000));
    return false;
  }
  console.log(`PASS ${name}: ${r.states} distinct states. Notebook never empty; success means one ACTIVE copy; old is not deleted until the new copy is ACTIVE.`);
  return true;
}

function expectInvariant(name, cfg, invariant, plain) {
  const r = tlc(cfg);
  if (r.violated !== invariant) {
    console.error(`FAIL ${name}: expected ${invariant} violated, got ${r.violated || 'pass'} (exit ${r.status})`);
    console.error(r.out.slice(-2000));
    return false;
  }
  console.log(`FINDING ${name}: ${plain}`);
  const trace = r.out.split('\n').filter((l) => /^State \d+:/.test(l) || /\/\\ (pc|outcome|status)/.test(l));
  if (trace.length) console.log(trace.slice(0, 40).join('\n'));
  return true;
}

let ok = true;
ok = expectPass('current cutover', 'PackReplaceGate.cfg') && ok;
ok = expectInvariant(
  'settled at most one copy',
  'PackReplaceGateSettled.cfg',
  'SettledAtMostOne',
  'A finished failed run can leave two copies (PARTIAL_CUTOVER, or orphan rollback delete failed). Next successful run deletes the leftover. Do not weaken this.',
) && ok;
ok = expectInvariant(
  'delete-before-poll bug',
  'PackReplaceGateBug.cfg',
  'NoDeleteUntilNewActive',
  'If delete_old runs before pollFamilyUntilActive, the new copy is still inflight. A later poll fail + rollback empties the notebook.',
) && ok;

fs.rmSync(path.join(here, '.tlc-meta-PackReplaceGate'), { recursive: true, force: true });
fs.rmSync(path.join(here, '.tlc-meta-PackReplaceGateSettled'), { recursive: true, force: true });
fs.rmSync(path.join(here, '.tlc-meta-PackReplaceGateBug'), { recursive: true, force: true });

process.exit(ok ? 0 : 1);
