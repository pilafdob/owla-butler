// Windows-focused ChatStore regressions (3.7.0-RC round 2, win-stream;
// audits/3.7.0-rc/windows-stream-leaks.md). Transient Defender/OneDrive/indexer
// locks (EBUSY/EPERM/EACCES) get a bounded retry on rename/unlink; other errors
// propagate at once; CRLF content, read-only attributes, spaced paths and NTFS
// case-folding behave. The fs patch goes through the same CJS module object the
// store calls, so the retry path is exercised deterministically on every host.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readdirSync,chmodSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ChatStore} from '../src/chats';
const req=createRequire(import.meta.url);
const fs=req('node:fs');
const locked=(code:string)=>Object.assign(Error('resource busy or locked'),{code});

test('save rides out transient Windows locks (EBUSY/EPERM/EACCES) with a bounded retry',()=>{
 const real=fs.renameSync;
 for(const code of ['EBUSY','EPERM','EACCES']){
  const root=mkdtempSync(join(tmpdir(),'owla-win-chats-'));let calls=0;
  fs.renameSync=(...args:any[])=>{calls++;if(calls<3)throw locked(code);return real(...args);};
  try{
   const store=new ChatStore(root);
   const saved=store.save('chat',[{role:'user',content:'hi'}]);
   assert.equal(calls,3,'two transient refusals, then success');
   assert.deepEqual(store.list().map(chat=>chat.id),[saved.id]);
  }finally{fs.renameSync=real;rmSync(root,{recursive:true,force:true});}
 }
});

test('remove rides out a transient EPERM lock on the chat file',()=>{
 const root=mkdtempSync(join(tmpdir(),'owla-win-chats-'));
 const store=new ChatStore(root);
 const saved=store.save('chat',[{role:'user',content:'hi'}]);
 const real=fs.unlinkSync;let calls=0;
 fs.unlinkSync=(...args:any[])=>{calls++;if(calls===1)throw locked('EPERM');return real(...args);};
 try{
  store.remove(saved.id);
  assert.equal(calls,2);
  assert.equal(store.list().length,0);
 }finally{fs.unlinkSync=real;rmSync(root,{recursive:true,force:true});}
});

test('a permanent lock fails the save after exactly three attempts and leaves no temp file',()=>{
 const root=mkdtempSync(join(tmpdir(),'owla-win-chats-'));
 const real=fs.renameSync;let calls=0;
 fs.renameSync=(...args:any[])=>{calls++;throw locked('EBUSY');};
 try{
  const store=new ChatStore(root);
  assert.throws(()=>store.save('chat',[{role:'user',content:'hi'}]),/busy or locked/);
  assert.equal(calls,3,'the retry stays bounded');
  assert.deepEqual(readdirSync(join(root,'saved-chats')).filter(f=>f.endsWith('.tmp')),[],'the temp file is cleaned up');
 }finally{fs.renameSync=real;rmSync(root,{recursive:true,force:true});}
});

test('a non-transient fs error propagates without retrying',()=>{
 const root=mkdtempSync(join(tmpdir(),'owla-win-chats-'));
 const real=fs.renameSync;let calls=0;
 fs.renameSync=(...args:any[])=>{calls++;throw Object.assign(Error('no space left on device'),{code:'ENOSPC'});};
 try{
  const store=new ChatStore(root);
  assert.throws(()=>store.save('chat',[{role:'user',content:'hi'}]),/no space/);
  assert.equal(calls,1);
 }finally{fs.renameSync=real;rmSync(root,{recursive:true,force:true});}
});

test('a read-only saved chat can still be deleted (Windows read-only attribute)',()=>{
 const root=mkdtempSync(join(tmpdir(),'owla-win-chats-'));
 try{
  const store=new ChatStore(root);
  const saved=store.save('chat',[{role:'user',content:'hi'}]);
  // On Windows a mode without write bits sets FILE_ATTRIBUTE_READONLY, the
  // state synced/protected chat files can end up in; delete must still work.
  chmodSync(join(root,'saved-chats',saved.id+'.json'),0o400);
  store.remove(saved.id);
  assert.equal(store.list().length,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('CRLF content round-trips intact and control characters never reach a title',()=>{
 const root=mkdtempSync(join(tmpdir(),'owla-win-chats-'));
 try{
  const store=new ChatStore(root);
  store.save('a\r\nb\tc',[{role:'user',content:'line1\r\nline2'},{role:'assistant',content:'reply',sourcePath:'Note.md'}]);
  const [chat]=store.list();
  assert.equal(chat.title,'a  b c');
  assert.equal(chat.messages[0].content,'line1\r\nline2');
  assert.equal(chat.messages[1].sourcePath,'Note.md');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('a root path with spaces and native separators saves, lists and removes',()=>{
 const root=mkdtempSync(join(tmpdir(),'owla win stream test-'));
 try{
  const store=new ChatStore(root);
  const saved=store.save('spaced path',[{role:'user',content:'hi'}]);
  assert.deepEqual(store.list().map(chat=>chat.id),[saved.id]);
  store.remove(saved.id);
  assert.equal(store.list().length,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('NTFS case-folding cannot duplicate a saved chat',{skip:process.platform==='win32'?false:'NTFS case-fold semantics'},()=>{
 const root=mkdtempSync(join(tmpdir(),'owla-win-chats-'));
 try{
  const store=new ChatStore(root);
  const saved=store.save('chat',[{role:'user',content:'hi'}]);
  const lower=join(root,'saved-chats',saved.id+'.json'),upper=join(root,'saved-chats',saved.id.toUpperCase()+'.JSON');
  // The uppercase name addresses the SAME file on NTFS; it cannot create a
  // case-fold duplicate that would list the chat twice.
  writeFileSync(upper,JSON.stringify({...saved,title:'Renamed'}));
  assert.equal(statSync(lower).ino,statSync(upper).ino);
  const listed=store.list();
  assert.equal(listed.length,1);
  assert.equal(listed[0].title,'Renamed');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('uppercase-named files the store never wrote are ignored by list',()=>{
 const root=mkdtempSync(join(tmpdir(),'owla-win-chats-'));
 try{
  const store=new ChatStore(root);
  const id=randomUUID();
  mkdirSync(join(root,'saved-chats'),{recursive:true});
  writeFileSync(join(root,'saved-chats',id.toUpperCase()+'.json'),JSON.stringify({id,title:'Foreign',created:new Date().toISOString(),messages:[{role:'user',content:'hi'}]}));
  assert.deepEqual(store.list(),[]);
 }finally{rmSync(root,{recursive:true,force:true});}
});
