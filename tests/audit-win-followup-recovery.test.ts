import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs,{mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readPendingRecord} from '../src/recovery';
import {loadMain} from './helpers/load-main';

// stat() can succeed while the following read is denied by a Windows sharing
// lock. Fault injection keeps this regression deterministic on every host.
test('recovery refuses to clear a journal whose stat succeeds but read fails',async t=>{
 const {Butler}=await loadMain();
 const root=mkdtempSync(join(tmpdir(),'owla-journal-read-'));
 const file=join(root,'pending-edits.json');
 const original=JSON.stringify([{edit:{path:'Note.md',before:'before',after:'after',reason:'review'},reasons:['review']}]);
 writeFileSync(file,original);
 const plugin=Object.create(Butler.prototype);
 Object.assign(plugin,{vaultStorage:()=>root,applyingEdit:false,pending:[{sentinel:true}],pendingLoadError:'Preserve this error'});
 try{
  for(const code of ['EBUSY','EPERM','EACCES']){
   const read=t.mock.method(fs,'readFileSync',((...args:Parameters<typeof readFileSync>)=>{
    if(String(args[0])===file)throw Object.assign(Error('sharing lock '+code),{code});
    return Reflect.apply(readFileSync,fs,args);
   }) as typeof readFileSync);
   syncBuiltinESMExports();
   try{
    assert.throws(()=>readPendingRecord(root),/could not be read.*sharing lock/);
    await assert.rejects(()=>plugin.clearPendingEdits(),/could not be read.*sharing lock/);
    assert.equal(plugin.applyingEdit,false,'the edit lock is released even on failure');
    assert.deepEqual(plugin.pending,[{sentinel:true}]);
    assert.equal(plugin.pendingLoadError,'Preserve this error');
   }finally{read.mock.restore();syncBuiltinESMExports();}
   assert.equal(readFileSync(file,'utf8'),original,'the unread journal must survive byte-identically');
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});
