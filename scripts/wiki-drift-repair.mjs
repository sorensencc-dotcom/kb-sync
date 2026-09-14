#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseReport(stdout) { try { return JSON.parse(stdout); } catch { return null; } }

async function runCommand(command, stagingPath, timeoutMs = 60000) {
  const name = typeof command === 'string' ? command : command.name;
  const commands = {
    detect: ['node', ['modules/wiki/detect-drift.js']],
    stage: ['npm.cmd', ['run', 'kb:sync:obsidian:incremental']],
    synthesize: ['npx.cmd', ['tsx', 'modules/obsidian/synthesize-wiki.ts', '--provider', 'offline-template', '--staging-path', stagingPath]],
    publish: ['npm.cmd', ['run', 'wiki:publish']]
  };
  const [file, args] = commands[name];
  try {
    const result = await execFileAsync(file, args, { cwd: repoRoot, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 });
    const stdout = name === 'detect' ? await fs.readFile(path.join(repoRoot, '.drift-report.json'), 'utf8') : `${result.stdout || ''}${result.stderr || ''}`;
    return { code: 0, stdout };
  } catch (error) { return { code: error.code ?? 1, stdout: `${error.stdout || ''}${error.stderr || ''}`, error }; }
}

function stagingPathFromOutput(stdout) {
  const match = stdout.match(/(?:Staging directory|STAGING_DIR)\s*:\s*(.+)/i);
  if (!match) throw new Error('staging completed without reporting a staging directory');
  return match[1].trim();
}

async function detect(run) {
  const result = await run('detect');
  if (result.code !== 0) throw new Error(`drift detection failed (exit ${result.code})`);
  const report = parseReport(result.stdout);
  if (!report?.status) throw new Error('drift detection returned no parseable report');
  return report;
}

export async function runRepair({ mode = 'check', run = runCommand } = {}) {
  if (!['check', 'repair', 'publish'].includes(mode)) throw new Error(`unknown mode: ${mode}`);
  if (mode === 'publish') throw new Error('publish requires repair mode');
  let report = await detect(run);
  if (mode === 'check' || report.status === 'NO_DRIFT') return report;
  const staged = await run('stage');
  if (staged.code !== 0) throw new Error(`staging failed (exit ${staged.code})`);
  const synthesized = await run('synthesize', stagingPathFromOutput(staged.stdout));
  if (synthesized.code !== 0) throw new Error(`synthesis failed (exit ${synthesized.code})`);
  report = await detect(run);
  if (report.status !== 'NO_DRIFT') throw new Error(`repair completed but drift remains (${report.summary?.stale_pages_count ?? 'unknown'} stale pages)`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runRepair({ mode: process.argv.includes('--repair') ? 'repair' : 'check' })
    .then(report => { process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); if (report.status !== 'NO_DRIFT') process.exitCode = 2; })
    .catch(error => { console.error(`wiki-drift-repair: ${error.message}`); process.exitCode = 1; });
}