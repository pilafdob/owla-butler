import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadRoutingHistory,saveRoutingHistory,type RoutingHistoryData} from '../src/routing-history';

const fs=createRequire(import.meta.url)('node:fs');
const previous='{"codex":{"old":{"lookup":{"success":3,"fail":0,"latencyMs":[10]}}}}\r\n';
const next:RoutingHistoryData={claude:{haiku:{lookup:{success:2,fail:0,latencyMs:[120]}}}};
for(const code of ['EPERM','EBUSY','EACCES']){
 test(`transient ${code} rename succeeds atomically without renderer Atomics.wait`,()=>{
  const root=mkdtempSync(join(tmpdir(),'owla-history-retry-'));
  const file=join(root,'routing-history.json');
  writeFileSync(file,previous);
  const realRename=fs.renameSync,realWait=Atomics.wait;
  let attempts=0;
  fs.renameSync=(...args:any[])=>{
   attempts++;
   assert.equal(readFileSync(file,'utf8'),previous,'the old file stays intact until publication');
   assert.equal(readFileSync(args[0],'utf8'),JSON.stringify(next),'the complete new history is staged');
   if(attempts<3)throw locked(code);
   return realRename(...args);
  };
  Atomics.wait=()=>{throw new TypeError('Atomics.wait cannot be called in this context');};
  try{
   saveRoutingHistory(root,next);
   assert.equal(attempts,3);
   assert.deepEqual(loadRoutingHistory(root),next);
   assert.deepEqual(readdirSync(root),['routing-history.json']);
  }finally{
   fs.renameSync=realRename;Atomics.wait=realWait;
   rmSync(root,{recursive:true,force:true});
  }
 });
}

const locked=(code:string)=>Object.assign(Error('history target locked'),{code});

test('failed atomic rename never falls back to a truncating write, even when disk space runs out',()=>{
 const root=mkdtempSync(join(tmpdir(),'owla-history-atomic-'));
 const file=join(root,'routing-history.json');
 writeFileSync(file,previous);
 const realRename=fs.renameSync,realWrite=fs.writeFileSync;
 const failure=locked('EPERM');
 let directWrites=0;
 fs.renameSync=()=>{throw failure;};
 fs.writeFileSync=(...args:any[])=>{
  if(args[0]===file){
   directWrites++;
   realWrite(file,'{"claude":');
   throw Object.assign(Error('disk full during unsafe fallback'),{code:'ENOSPC'});
  }
  return realWrite(...args);
 };
 try{
  let thrown:unknown;
  try{saveRoutingHistory(root,next);}catch(error){thrown=error;}
  assert.equal(readFileSync(file,'utf8'),previous,'all old personalization bytes survive');
  assert.equal(directWrites,0,'the published history is never opened for writing');
  assert.equal(thrown,failure,'the original rename failure reaches the caller');
  assert.deepEqual(readdirSync(root),['routing-history.json'],'the failed save removes its temp');
  assert.equal(loadRoutingHistory(root).codex?.old.lookup?.success,3);
 }finally{
  fs.renameSync=realRename;fs.writeFileSync=realWrite;
  rmSync(root,{recursive:true,force:true});
 }
});
