import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync,statSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {ChatStore} from '../src/chats';
test('saved chats retain bounded plain messages, never attachments or tool instructions',()=>{const root=mkdtempSync(join(tmpdir(),'owla-chat-'));try{const store=new ChatStore(root);const saved=store.save('My chat',[{role:'system',content:'secret context'},...Array.from({length:10},(_,i)=>({role:i%2?'assistant':'user',content:'message '+i}))]);assert.equal(saved.messages.length,6);assert.ok(saved.messages.every(m=>m.role!=='system' as any));assert.equal(store.list()[0].title,'My chat');if(process.platform!=='win32')assert.equal(statSync(join(root,'saved-chats',saved.id+'.json')).mode&0o777,0o600);assert.throws(()=>store.remove('../outside'));store.remove(saved.id);assert.equal(store.list().length,0);}finally{rmSync(root,{recursive:true,force:true});}});
test('chat limit refuses further saves without deleting previous conversations',()=>{const root=mkdtempSync(join(tmpdir(),'owla-chat-'));try{const store=new ChatStore(root);for(let i=0;i<20;i++)store.save('chat '+i,[{role:'user',content:'hi'}]);assert.throws(()=>store.save('overflow',[{role:'user',content:'hi'}]),/20 saved chats/);assert.equal(store.list().length,20);}finally{rmSync(root,{recursive:true,force:true});}});

test('invalid saved messages are skipped and unrecognized stored fields are ignored',async()=>{
 const {writeFileSync}=await import('node:fs');const root=mkdtempSync(join(tmpdir(),'owla-chat-validate-'));const store=new ChatStore(root);
 try{const good=store.save('Good',[{role:'user',content:'Original'}]),bad=store.save('Bad',[{role:'user',content:'Malformed fixture'}]);const file=(id:string)=>join(root,'saved-chats',id+'.json');
 writeFileSync(file(good.id),JSON.stringify({...good,unexpected:'ignore',messages:[{role:'user',content:'Original',images:['unused']}]}));writeFileSync(file(bad.id),JSON.stringify({...bad,messages:[null]}));
 assert.deepEqual(store.list(),[good]);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('reopened replies retain their source note path for relative links', () => {
 const root = mkdtempSync(join(tmpdir(), 'owla-chat-source-'));
 try {
  const store = new ChatStore(root);
  const sourcePath = 'Schoolwork/Source.md';
  store.save('Relative link', [
   {role:'user', content:'Find the related note'},
   {role:'assistant', content:'[[Sibling note#Section]]', sourcePath}
  ]);
  assert.deepEqual(store.list()[0].messages, [
   {role:'user', content:'Find the related note'},
   {role:'assistant', content:'[[Sibling note#Section]]', sourcePath}
  ]);
 } finally {
  rmSync(root, {recursive:true, force:true});
 }
});
