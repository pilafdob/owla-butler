// Windows: the organization and pending-edit journals ride out a transient
// Defender/OneDrive/indexer lock on the atomic rename, like saved chats and
// routing history already did. Without the retry a single EBUSY between two
// moves aborted a whole organization batch and rolled it back.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stubObsidian} from './helpers/load-main';
import {retryLocked} from '../src/fs-retry';
import {savePendingEdits} from '../src/recovery';

stubObsidian();
const fs=createRequire(import.meta.url)('node:fs');
const locked=(code:string)=>Object.assign(Error('target locked'),{code});

test('retryLocked retries only transient lock codes, at most three attempts, without Atomics.wait',()=>{
 const realWait=Atomics.wait;
 Atomics.wait=()=>{throw new TypeError('Atomics.wait cannot be called in this context');};
 try{
  for(const code of ['EBUSY','EPERM','EACCES']){
   let calls=0;
   assert.equal(retryLocked(()=>{if(++calls<3)throw locked(code);return 'ok';}),'ok');
   assert.equal(calls,3);
   calls=0;
   assert.throws(()=>retryLocked(()=>{calls++;throw locked(code);}),/target locked/);
   assert.equal(calls,3,'bounded');
  }
  let calls=0;
  assert.throws(()=>retryLocked(()=>{calls++;throw locked('ENOSPC');}),/target locked/);
  assert.equal(calls,1,'other errors propagate at once');
 }finally{Atomics.wait=realWait;}
});

for(const code of ['EBUSY','EPERM','EACCES']){
 test(`pending-edit journal: a transient ${code} on the rename still publishes atomically`,()=>{
  const root=mkdtempSync(join(tmpdir(),'owla-pending-lock-'));
  const file=join(root,'pending-edits.json');
  writeFileSync(file,'[]');
  const realRename=fs.renameSync;
  let attempts=0;
  fs.renameSync=(...args:any[])=>{
   attempts++;
   assert.equal(readFileSync(file,'utf8'),'[]','the old journal stays intact until publication');
   if(attempts<3)throw locked(code);
   return realRename(...args);
  };
  try{
   savePendingEdits(root,[]);
   assert.equal(attempts,3);
   assert.deepEqual(readdirSync(root),['pending-edits.json'],'no temporary file is left behind');
  }finally{fs.renameSync=realRename;rmSync(root,{recursive:true,force:true});}
 });

 test(`organization journal: a transient ${code} on the rename does not fail the save`,async()=>{
  const {Organization}=await import('../src/organization');
  const storage=mkdtempSync(join(tmpdir(),'owla-org-lock-'));
  const org=new Organization({} as never,()=>storage,()=>null,()=>true,()=>'',()=>true,()=>true,async()=>'',async()=>{});
  const realRename=fs.renameSync;
  let attempts=0;
  fs.renameSync=(...args:any[])=>{attempts++;if(attempts<3)throw locked(code);return realRename(...args);};
  try{
   const review={moves:[],folders:[],reason:'r',fingerprint:'f'};
   (org as any).save({review});
   assert.equal(attempts,3);
   assert.deepEqual(org.review,review);
   assert.deepEqual(JSON.parse(readFileSync(join(storage,'pending-organization.json'),'utf8')),{review});
   assert.deepEqual(readdirSync(storage),['pending-organization.json']);
  }finally{fs.renameSync=realRename;rmSync(storage,{recursive:true,force:true});}
 });
}
