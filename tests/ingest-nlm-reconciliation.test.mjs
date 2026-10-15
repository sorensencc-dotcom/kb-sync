import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findActiveUploadedSource } from '../scripts/notebooklm/sandbox-contract.mjs';

const runner = fileURLToPath(new URL('../scripts/notebooklm/ingest-nlm-runner.mjs', import.meta.url));
const notebook = 'offline-receipt-regression';
test('shared ACTIVE contract rejects READY and missing IDs',()=>{
  assert.equal(findActiveUploadedSource([{id:'ready',status:'READY'}],'ready'),undefined);
  assert.equal(findActiveUploadedSource([{status:'ACTIVE'}],undefined),undefined);
  for(const status of [2,'2','ACTIVE','active']) assert.equal(findActiveUploadedSource([{id:'active',status}],'active').id,'active');
});
const mockCode = `import fs from 'node:fs'; import path from 'node:path';
if(process.env.NLM_LIVE_SANDBOX !== '0') throw Error('OFFLINE_ONLY');
const file=process.env.RECEIPT_STATE; const s=JSON.parse(fs.readFileSync(file,'utf8')); const a=process.argv.slice(2);
s.calls.push(a); let out={ok:true}; let status=0;
if(a[0]==='login') { if(s.authFail) status=1; }
else if(a[1]==='list') {
 if(s.listFail || (s.postListFail && s.sequence>0)) status=1;
 else if (s.ambiguous) out=[...s.sources, {id:s.sources[0]?.id || 'old-1', title:'conflicting-copy', status:'FAILED'}];
 else out=s.badList ? {unexpected:true} : s.sources;
} else if(a[1]==='add') {
 if(s.replacementLock) fs.writeFileSync(path.join(path.dirname(a[a.indexOf('--file')+1]),'.nlm-sync.lock'),JSON.stringify(s.replacementLock));
 const title=path.basename(a[a.indexOf('--file')+1]);
 const source={id:'new-'+(++s.sequence),title,status:s.addStatus||'ACTIVE'};
 if(s.addFail) status=1;
 else {s.sources.push(source);out=s.missingId ? {ok:true} : {source_id:s.returnOldId?'old-1':source.id};}
} else throw Error('Unexpected operation '+a);
fs.writeFileSync(file,JSON.stringify(s));console.log(s.badJson && a[1]==='list'?'not json':JSON.stringify(out));process.exit(status);`;

function fixture(t, count = 1, healthy = 0, receipts = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nlm-receipt-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const staging = path.join(dir, 'staging'); fs.mkdirSync(staging);
  const mock = path.join(dir, 'mock.mjs'); fs.writeFileSync(mock,mockCode);
  const statePath = path.join(dir, 'state.json');
  const sources=[]; const stored={receipts:{}};
  for(let i=1;i<=count;i++) {
    const name=`part-${i}.txt`; const content=`generation one part ${i}`;
    fs.writeFileSync(path.join(staging,name),content);
    const hash=crypto.createHash('sha256').update(content).digest('hex');
    stored.receipts[`${notebook}::${name}::${hash}`]={fileName:name,hash,sourceId:`old-${i}`};
    if(i<=healthy) sources.push({id:`old-${i}`,title:name,status:'ACTIVE'});
  }
  if(receipts) fs.writeFileSync(path.join(staging,'.nlm-sync-receipt.json'),JSON.stringify(stored));
  const read=()=>JSON.parse(fs.readFileSync(statePath,'utf8'));
  const write=s=>fs.writeFileSync(statePath,JSON.stringify(s));
  write({sequence:0,calls:[],sources});
  return {staging,read,write,receipts:()=>JSON.parse(fs.readFileSync(path.join(staging,'.nlm-sync-receipt.json'),'utf8')).receipts,
    run:(flags=[])=>{
      const p=spawnSync(process.execPath,[runner,notebook,'--staging-dir',staging,...flags],{encoding:'utf8',timeout:count === 15 ? 30000 : 10000,
        env:{...process.env,NLM_CLI:`node "${mock}"`,NLM_LIVE_SANDBOX:'0',RECEIPT_STATE:statePath}});
      assert.equal(p.error,undefined,p.error?.message);
      const output=p.stdout || p.stderr.slice(p.stderr.indexOf('{'));
      return {status:p.status,report:JSON.parse(output),stderr:p.stderr};
    }};
}

for(const remoteStatus of ['missing','FAILED','PROCESSING','READY',null]) {
  test(`reconcile exact receipt ID when remote status is ${remoteStatus}`,t=>{
    const f=fixture(t,1,1,true);const s=f.read();
    if(remoteStatus==='missing') s.sources=[];else s.sources[0].status=remoteStatus; f.write(s);
    const r=f.run(); assert.equal(r.status,0,r.stderr);assert.equal(r.report.ingested,1);assert.equal(r.report.skippedAlreadySynced,0);
    assert.equal(Object.values(f.receipts())[0].sourceId,'new-1');
  });
}
test('15 receipts reconcile 8 ACTIVE and 7 missing without duplicating healthy sources',{timeout:35000},t=>{
  const f=fixture(t,15,8,true);const r=f.run();
  assert.equal(r.status,0,r.stderr);assert.equal(r.report.ingested,7);assert.equal(r.report.skippedAlreadySynced,8);assert.equal(f.read().sources.length,15);
});
test('unchanged ACTIVE receipt skips; changed hash uploads and retains original source',t=>{
  const f=fixture(t,2,2,true);fs.writeFileSync(path.join(f.staging,'part-1.txt'),'generation two');const r=f.run();
  assert.equal(r.status,0,r.stderr);assert.equal(r.report.ingested,1);assert.equal(r.report.skippedAlreadySynced,1);assert.equal(f.read().sources.length,3);
});
test('fresh staging never adopts same-title source; receipt binds returned new ID',t=>{
  const f=fixture(t,1,1);const r=f.run();assert.equal(r.status,0,r.stderr);assert.equal(r.report.ingested,1);
  assert.equal(Object.values(f.receipts())[0].sourceId,'new-1');assert.equal(f.read().sources.length,2);
});
for(const mode of ['listFail','badList','badJson']) {
  test(`remote ${mode} fails closed before uploads or receipt skips`,t=>{
    const f=fixture(t,2,1,true);const s=f.read();s[mode]=true;f.write(s);const before=JSON.stringify(f.receipts());const r=f.run();
    assert.notEqual(r.status,0);assert.equal(f.read().sequence,0);assert.equal(JSON.stringify(f.receipts()),before);
  });
}
test('conflicting duplicate source IDs fail closed before receipt skips or uploads', t => {
  const f = fixture(t, 1, 1, true);
  const s = f.read(); s.ambiguous = true; f.write(s);
  const before = JSON.stringify(f.receipts());
  const r = f.run();
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /SOURCE_LIST_INVALID: duplicate source ID/);
  assert.equal(f.read().sequence, 0);
  assert.equal(JSON.stringify(f.receipts()), before);
});
for(const mode of ['postListFail','missingId','returnOldId','failedUploadStatus']) {
  test(`${mode} withholds successful receipt`,t=>{
    const f=fixture(t,1,1);const s=f.read();if(mode==='failedUploadStatus')s.addStatus='FAILED';else s[mode]=true;f.write(s);
    const r=f.run();assert.equal(r.status,1,r.stderr);assert.equal(r.report.ingested,0);assert.equal(r.report.failed.length,1);
    assert.equal(fs.existsSync(path.join(f.staging,'.nlm-sync-receipt.json')),false);
  });
}
for(const stored of [null,{}, {receipts:null}, {receipts:[]}, {receipts:'invalid'}]) {
  test(`invalid receipt shape ${JSON.stringify(stored)} retries safely`,t=>{
    const f=fixture(t);fs.writeFileSync(path.join(f.staging,'.nlm-sync-receipt.json'),JSON.stringify(stored));
    const r=f.run();assert.equal(r.status,0,r.stderr);assert.equal(r.report.ingested,1);assert.equal(Object.values(f.receipts())[0].sourceId,'new-1');
  });
}
test('receipt for another notebook cannot suppress upload',t=>{
  const f=fixture(t,1,1,true);const stored=f.receipts();const key=Object.keys(stored)[0];stored[key.replace(notebook,'different-notebook')]=stored[key];delete stored[key];
  fs.writeFileSync(path.join(f.staging,'.nlm-sync-receipt.json'),JSON.stringify({receipts:stored}));
  const r=f.run();assert.equal(r.status,0,r.stderr);assert.equal(r.report.ingested,1);assert.equal(r.report.skippedAlreadySynced,0);
});

for (const [mode, expectedStatus] of [['upload', 0], ['skip', 0], ['partial', 1], ['auth-failure', 2], ['list-failure', 1], ['dry-run', 0], ['empty', 0]]) {
  test(`ingestion releases owned lock after ${mode}`, context => {
    const current = fixture(context, mode === 'empty' ? 0 : 1, mode === 'skip' ? 1 : 0, mode === 'skip');
    const state = current.read();
    state.addFail = mode === 'partial';
    state.authFail = mode === 'auth-failure';
    state.listFail = mode === 'list-failure';
    current.write(state);
    const result = current.run(mode === 'dry-run' ? ['--dry-run'] : []);
    assert.equal(result.status, expectedStatus, result.stderr);
    assert.equal(fs.existsSync(path.join(current.staging, '.nlm-sync.lock')), false, 'Exited runner must release owned lock');
  });
}

test('ingestion releases owned lock when no CLI runtime is available', context => {
  const current = fixture(context);
  const preload = path.join(path.dirname(current.staging), 'no-runtime.mjs');
  fs.writeFileSync(preload, `import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
childProcess.spawnSync = () => ({ status: 1, stdout: '', stderr: 'Runtime unavailable' });
syncBuiltinESMExports();`);
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, runner, notebook, '--staging-dir', current.staging], {
    encoding: 'utf8', timeout: 10000, env: { ...process.env, NLM_CLI: '', NLM_LIVE_SANDBOX: '0' },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 3, result.stderr);
  assert.match(JSON.parse(result.stderr).error, /NLM_RUNTIME_NOT_FOUND/);
  assert.equal(fs.existsSync(path.join(current.staging, '.nlm-sync.lock')), false);
});

test('ingestion preserves live lock owned by another process', context => {
  const current = fixture(context);
  const lockPath = path.join(current.staging, '.nlm-sync.lock');
  const lock = { pid: process.pid, createdAt: new Date().toISOString() };
  fs.writeFileSync(lockPath, JSON.stringify(lock));
  const result = current.run();
  assert.equal(result.status, 3, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(lockPath, 'utf8')), lock);
  assert.equal(current.read().calls.length, 0);
});

test('ingestion cleanup preserves lock replaced by another owner', context => {
  const current = fixture(context);
  const state = current.read();
  state.replacementLock = { pid: process.pid, createdAt: new Date().toISOString() };
  current.write(state);
  const result = current.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(current.staging, '.nlm-sync.lock'), 'utf8')), state.replacementLock);
});
