// Regression tests for the 3.7.0-RC stream-leak audit (audits/3.7.0-rc/stream-leaks.md).
// ChatStore.list must bound how many files it reads into memory when the
// saved-chats folder holds far more candidates than the 20 chats OWLA keeps.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ChatStore} from '../src/chats';

test('list reads at most maxReads candidate files',()=>{
 const root=mkdtempSync(join(tmpdir(),'owla-audit-chats-'));
 try{
  const store=new ChatStore(root,1);
  const ids=[0,1,2].map(i=>store.save('chat '+i,[{role:'user',content:'hi'}]).id);
  const listed=store.list();
  assert.equal(listed.length,1);
  assert.ok(ids.includes(listed[0].id));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('oversized junk files never spend the read budget or hide a saved chat',()=>{
 const root=mkdtempSync(join(tmpdir(),'owla-audit-chats-'));
 try{
  const store=new ChatStore(root);
  const saved=store.save('Real chat',[{role:'user',content:'hi'}]);
  const folder=join(root,'saved-chats');
  // More junk files than the read budget, each over the 100 KB size cap:
  // they are skipped by stat, so the real chat is still found in any order.
  for(let i=0;i<150;i++)writeFileSync(join(folder,randomUUID()+'.json'),'x'.repeat(101000));
  const listed=store.list();
  assert.deepEqual(listed.map(chat=>chat.id),[saved.id]);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('the default budget still lists every chat a full store can hold',()=>{
 const root=mkdtempSync(join(tmpdir(),'owla-audit-chats-'));
 try{
  const store=new ChatStore(root);
  for(let i=0;i<20;i++)store.save('chat '+i,[{role:'user',content:'hi'}]);
  assert.equal(store.list().length,20);
 }finally{rmSync(root,{recursive:true,force:true});}
});
