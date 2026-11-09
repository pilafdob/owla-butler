import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,readdirSync,readFileSync,rmSync,writeFileSync,statSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {backupEdit,rotateLog} from '../src/recovery';
test('edit recovery retains original contents with bounded private backups',()=>{const root=mkdtempSync(join(tmpdir(),'owla-recovery-'));try{for(let i=0;i<25;i++)backupEdit(root,{path:'A.md',before:'original '+i,after:'new',reason:'test'});const files=readdirSync(join(root,'edit-backups'));assert.equal(files.length,20);for(const f of files){const path=join(root,'edit-backups',f);assert.equal(JSON.parse(readFileSync(path,'utf8')).path,'A.md');if(process.platform!=='win32')assert.equal(statSync(path).mode&0o777,0o600);}}finally{rmSync(root,{recursive:true,force:true});}});
test('logs rotate before subsequent runtime starts',()=>{const root=mkdtempSync(join(tmpdir(),'owla-log-'));try{const file=join(root,'log');writeFileSync(file,'x'.repeat(1_000_001));rotateLog(file);assert.equal(statSync(file+'.previous').size,1_000_001);}finally{rmSync(root,{recursive:true,force:true});}});

test('pending edit decisions survive a new read and can be cleared independently', async () => {
 const {loadPendingEdits,savePendingEdits} = await import('../src/recovery');
 const root = mkdtempSync(join(tmpdir(),'owla-pending-'));
 const first = {edit:{path:'A.md',before:'old',after:'new',reason:'Replace'},reasons:['Replace']};
 const second = {edit:{path:'B.md',before:'start',after:'end',reason:'Update'},reasons:['Update']};
 try {
  assert.deepEqual(loadPendingEdits(root),[]);
  savePendingEdits(root,[first,second]);
  assert.deepEqual(loadPendingEdits(root),[first,second]);
  savePendingEdits(root,[second]);
  assert.deepEqual(loadPendingEdits(root),[second]);
  savePendingEdits(root,[]);
  assert.deepEqual(loadPendingEdits(root),[]);
 } finally {
  rmSync(root,{recursive:true,force:true});
 }
});

test('new-note drafts retain their creation action in the pending journal',async()=>{
 const {loadPendingEdits,savePendingEdits}=await import('../src/recovery');
 const root=mkdtempSync(join(tmpdir(),'owla-new-note-'));
 const draft={edit:{path:'New.md',before:'',after:'New note body',reason:'Create note',create:true as const},reasons:['Create note']};
 try{
  savePendingEdits(root,[draft]);
  assert.deepEqual(loadPendingEdits(root),[draft]);
 }finally{rmSync(root,{recursive:true,force:true});}
});
