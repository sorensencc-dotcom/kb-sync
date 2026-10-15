import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const posix = value => value.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
const old = ['aa', 'ah', 'ai', 'aj', 'al', 'am', 'an', 'ao'].map(suffix => ({
  id: `old-${suffix}`, title: `repo_knowledge_pack_part_${suffix}.txt`, status: 'ACTIVE',
}));
const other = { id: 'unrelated', title: 'user-notes.md', status: 'ACTIVE' };

function run(t, options = {}) {
  const cache = path.join(repo, 'node_modules', '.cache');
  fs.mkdirSync(cache, { recursive: true });
  const dir = fs.mkdtempSync(path.join(cache, 'multipart-regression-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const file of ['flatten.sh', 'config-loader.mjs', 'validate.sh', 'chunk.sh', 'rollback.sh']) {
    fs.mkdirSync(path.join(dir, 'core'), { recursive: true });
    fs.copyFileSync(path.join(repo, 'core', file), path.join(dir, 'core', file));
  }
  fs.cpSync(path.join(repo, 'modules', 'notebooklm'), path.join(dir, 'modules', 'notebooklm'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'configs'));
  fs.writeFileSync(path.join(dir, 'configs', 'notebooklm.yaml'), 'output_dir: "./.nlm_pack"\npack_filename: "repo_knowledge_pack"\ntimeout_ms: 10000\nretry_attempts: 1\nbackoff_ms: 100\n');
  // Scaled fixture exercises actual splitting without a production-size payload.
  fs.writeFileSync(path.join(dir, 'configs', 'global.yaml'), 'warning_bytes: 512\nhard_bytes: 1024\nchunk_size: 1K\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), '*\n!payload.md\n');
  fs.writeFileSync(path.join(dir, 'payload.md'), `${'x'.repeat(1023)}\n`.repeat((options.parts || 3) - 2));
  const statePath = path.join(dir, 'state.json');
  const initial = [...old, other];
  fs.writeFileSync(statePath, JSON.stringify({ sources: initial, calls: [], sequence: 0 }));
  fs.writeFileSync(path.join(dir, 'mock-cli'), '#!/usr/bin/env bash\nnode "$(dirname "$0")/mock.mjs" "$@"\n');
  fs.writeFileSync(path.join(dir, 'mock.mjs'), `
import fs from 'node:fs'; import path from 'node:path';
const a=process.argv.slice(2), file=process.env.FIXTURE_STATE;
const state=JSON.parse(fs.readFileSync(file,'utf8'));
const save=()=>fs.writeFileSync(file,JSON.stringify(state));
state.calls.push({args:a, sources:structuredClone(state.sources)});save();
if(a[0]==='auth'&&['check','refresh'].includes(a[1]))process.exit(0);
if(a[0]==='source'&&a[1]==='add'&&a[2]==='--help'){console.log(process.env.NO_JSON==='1'?'legacy help':'--json');process.exit(0);}
if(a[0]!=='source'||a[2]!=='--notebook'||a[3]!=='fixture-only')process.exit(99);
if(a[1]==='list') { if(a[4]!=='--json')process.exit(98); console.log(JSON.stringify(state.sources));process.exit(0); }
if(a[1]==='add') {
  if(a[5]!=='--json')process.exit(95);
  if(process.env.FAIL_AT===String(state.sequence+1))process.exit(1);
  const id=process.env.RETURN_OLD==='1'?'old-aa':'new-'+(++state.sequence);
  if(process.env.RETURN_OLD!=='1')state.sources.push({id,title:path.basename(a[4]),status:process.env.NEW_STATUS==='missing'?undefined:process.env.NEW_STATUS||'ACTIVE'});
  save();console.log(JSON.stringify(process.env.NO_ID==='1'?{}:{source_id:id}));process.exit(0);
}
if(a[1]==='delete') { if(a[5]!=='-y')process.exit(97); if(process.env.FAIL_DELETE===a[4])process.exit(1);state.sources=state.sources.filter(s=>s.id!==a[4]);save();process.exit(0); }
process.exit(96);
`);
  const env = { ...process.env, NOTEBOOK_ID: 'fixture-only', NOTEBOOKLM_COOKIE: 'fake', NLM_CLI: posix(path.join(dir, 'mock-cli')), FIXTURE_STATE: statePath, COMPACTION_ENABLED: 'false', ENABLE_PYRAGIFY: 'false', ...options.env };
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('GIT_')) delete env[key];
  if (process.platform === 'win32') {
    const pathValue = env.PATH || env.Path || '';
    for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
    env.PATH = `${pathValue};C:\\Program Files\\Git\\bin;C:\\Program Files\\Git\\usr\\bin`;
  }
  function command(executable, args) {
    const result = spawnSync(executable, args, { cwd: dir, env, encoding: 'utf8', timeout: 55000 });
    assert.ifError(result.error);
    return result;
  }
  assert.equal(command('git', ['init', '--quiet']).status, 0);
  assert.equal(command(bash, ['-c', 'chmod +x core/*.sh modules/notebooklm/*.sh mock-cli']).status, 0);
  const result = command(bash, ['modules/notebooklm/ingest-notebooklm.sh', ...(options.audit ? ['--repair-drift'] : [])]);
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const telemetry = options.audit ? null : JSON.parse(fs.readFileSync(path.join(dir, '.sync-status.json'), 'utf8'));
  return { result, state, telemetry, initial };
}

test('audit preserves eight distinct ACTIVE chunks without uploads or deletes', { timeout: 60000 }, t => {
  const { result, state, initial } = run(t, { audit: true });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(state.sources, initial);
  assert.ok(state.calls.every(call => !['add', 'delete'].includes(call.args[1])));
});

test('CLI without structured upload support fails before any upload or deletion', { timeout: 60000 }, t => {
  const { result, state, telemetry, initial } = run(t, { env: { NO_JSON: '1' } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /lacks verified --json support/);
  assert.deepEqual(state.sources, initial);
  assert.equal(state.sequence, 0);
  assert.ok(state.calls.every(call => call.args[1] !== 'delete' && !(call.args[1] === 'add' && call.args[2] !== '--help')));
  assert.equal(telemetry.status, 'FAILED');
});

test('ambiguous successful upload never triggers a second plaintext upload or old-source deletion', { timeout: 60000 }, t => {
  const { result, state, telemetry, initial } = run(t, { env: { NO_ID: '1' } });
  assert.equal(result.status, 1);
  const adds = state.calls.filter(call => call.args[1] === 'add' && call.args[2] !== '--help');
  assert.equal(adds.length, 1);
  assert.ok(adds[0].args.includes('--json'));
  assert.ok(initial.every(source => state.sources.some(current => current.id === source.id)));
  assert.ok(state.calls.every(call => call.args[1] !== 'delete'));
  assert.equal(telemetry.status, 'FAILED');
});

test('all fifteen replacement IDs become ACTIVE before deleting any old chunk', { timeout: 60000 }, t => {
  const { result, state, telemetry } = run(t, { parts: 15 });
  assert.equal(result.status, 0, result.stderr);
  const adds = state.calls.filter(call => call.args[1] === 'add' && call.args[2] !== '--help');
  assert.equal(adds.length, 15);
  const deletes = state.calls.filter(call => call.args[1] === 'delete');
  assert.deepEqual(deletes.map(call => call.args[4]), old.map(source => source.id));
  for (const call of deletes) assert.equal(call.sources.filter(source => source.id.startsWith('new-') && source.status === 'ACTIVE').length, 15);
  assert.equal(state.sources.length, 16);
  assert.ok(state.sources.some(source => source.id === other.id));
  assert.equal(telemetry.purged_sources, deletes.length);
});

for (const failAt of ['1', '3']) test(`upload failure at part ${failAt} preserves every old chunk and cleans owned uploads`, { timeout: 60000 }, t => {
  const { result, state, telemetry, initial } = run(t, { env: { FAIL_AT: failAt } });
  assert.equal(result.status, 1);
  assert.deepEqual(state.sources, initial);
  const deletes = state.calls.filter(call => call.args[1] === 'delete');
  assert.ok(deletes.every(call => call.args[4].startsWith('new-')));
  assert.equal(deletes.length, Number(failAt) - 1, JSON.stringify({calls:state.calls,stderr:result.stderr}));
  assert.equal(telemetry.purged_sources, deletes.length);
  assert.equal(telemetry.status, 'FAILED');
});

for (const status of ['ERROR', 'missing', 'READY']) test(`unverified ${status} replacement preserves all old chunks`, { timeout: 60000 }, t => {
  const { result, state, telemetry, initial } = run(t, { env: { NEW_STATUS: status } });
  assert.equal(result.status, 1);
  assert.deepEqual(state.sources, initial);
  assert.equal(telemetry.purged_sources, 3);
});

test('ACTIVE numeric status 2 verifies exact returned IDs', { timeout: 60000 }, t => {
  const { result, telemetry } = run(t, { env: { NEW_STATUS: '2' } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(telemetry.uploaded_chunks, 3);
});

test('upload returning old ID cannot authorize deleting old sources', { timeout: 60000 }, t => {
  const { result, state, initial } = run(t, { env: { RETURN_OLD: '1' } });
  assert.equal(result.status, 1);
  assert.deepEqual(state.sources, initial);
  assert.ok(state.calls.every(call => call.args[1] !== 'delete'));
});

test('old-source delete failure reports actual successful deletes', { timeout: 60000 }, t => {
  const { result, state, telemetry } = run(t, { env: { FAIL_DELETE: 'old-ah' } });
  assert.equal(result.status, 1);
  assert.equal(telemetry.status, 'PARTIAL_SUCCESS');
  assert.equal(telemetry.purged_sources, 7);
  assert.ok(state.sources.some(source => source.id === 'old-ah'));
  assert.equal(state.sources.filter(source => source.id.startsWith('new-')).length, 3);
});
