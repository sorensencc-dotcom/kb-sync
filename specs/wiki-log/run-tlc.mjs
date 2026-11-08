#!/usr/bin/env node
/** TLC runner for WikiLog. JAVA / TLA2TOOLS override C:\\Users\\soren\\.tla defaults (tlaplus v1.7.4). */
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
      'WikiLog.tla',
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
  console.log(`PASS ${name}: ${r.states} distinct states. Live Log.md is never replaced; first-run may seed a header.`);
  return true;
}

function expectInvariant(name, cfg, invariant, plain) {
  const r = tlc(cfg);
  if (r.violated !== invariant) {
    console.error(`FAIL ${name}: expected ${invariant} violated, got ${r.violated || 'pass'} (exit ${r.status})`);
    console.error(r.out.slice(-2000));
    return false;
  }
  console.log(`BUG-VARIANT ${name}: ${plain}`);
  const trace = r.out.split('\n').filter((l) => /^State \d+:/.test(l) || /\/\\ (phase|chose|liveLog|transactLog)/.test(l));
  if (trace.length) console.log(trace.slice(0, 40).join('\n'));
  return true;
}

let ok = true;
ok = expectPass('current Log.md guards', 'WikiLog.cfg') && ok;
ok = expectInvariant(
  'old allowlist + overwrite',
  'WikiLogBug.cfg',
  'LogHistoryKept',
  'If Log.md is an accepted proposal and copyTransactToWiki replaces live Log.md, history is wiped and only the session stanza remains.',
) && ok;

for (const cfg of ['WikiLog', 'WikiLogBug']) {
  fs.rmSync(path.join(here, `.tlc-meta-${cfg}`), { recursive: true, force: true });
}

process.exit(ok ? 0 : 1);
