#!/usr/bin/env node
/**
 * One-command TLC runner for TrmIngestDrive.
 * Uses ~/.tla/tla2tools.jar, overridable via JAVA / TLA2TOOLS.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const homeJar = path.join(os.homedir(), '.tla', 'tla2tools.jar');
const defaultJavaWin = 'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.13.9-hotspot\\bin\\java.exe';
const defaultJar = fs.existsSync(homeJar) ? homeJar : 'C:\\Users\\soren\\.tla\\tla2tools.jar';
const java = process.env.JAVA || (process.platform === 'win32' && fs.existsSync(defaultJavaWin) ? defaultJavaWin : 'java');
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
      'TrmIngestDrive.tla',
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
  console.log(`PASS ${name}: ${r.states} distinct states. Normalization precedes validation; lock held only during writes; zero spurious quarantine.`);
  return true;
}

let ok = true;
ok = expectPass('current 10-state TRM Ingest Drive model', 'TrmIngestDrive.cfg') && ok;

fs.rmSync(path.join(here, '.tlc-meta-TrmIngestDrive'), { recursive: true, force: true });
process.exit(ok ? 0 : 1);
