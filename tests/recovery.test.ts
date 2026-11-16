import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,readdirSync,readFileSync,rmSync,writeFileSync,statSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {backupEdit,rotateLog} from '../src/recovery';
test('edit recovery retains original contents with bounded private backups',()=>{const root=mkdtempSync(join(tmpdir(),'owla-recovery-'));try{for(let i=0;i<25;i++)backupEdit(root,{path:'A.md',before:'original '+i,after:'new',reason:'test'});const files=readdirSync(join(root,'edit-backups'));assert.equal(files.length,20);for(const f of files){const path=join(root,'edit-backups',f);assert.equal(JSON.parse(readFileSync(path,'utf8')).path,'A.md');if(process.platform!=='win32')assert.equal(statSync(path).mode&0o777,0o600);}}finally{rmSync(root,{recursive:true,force:true});}});
test('logs rotate before subsequent runtime starts',()=>{const root=mkdtempSync(join(tmpdir(),'owla-log-'));try{const file=join(root,'log');writeFileSync(file,'x'.repeat(1_000_001));rotateLog(file);assert.equal(statSync(file+'.previous').size,1_000_001);}finally{rmSync(root,{recursive:true,force:true});}});

test('pending edit decisions survive a new read and can be cleared independently', async () => {
 const {loadPendingEdits,savePendingEdits} = await import('../src/recovery');
 const root = mkdtempSync(join(tmpdir(),'owla-pending-'));
 const first = {edit:{path:'A.md',before:'old',after:'new',reason:'Replace'},reasons:['Replace']};
 const second = {edit:{path:'B.md',before:'start',after:'end',reason:'Update'},reasons:['Update'],deferred:true as const};
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

test('a pending edit record cannot point into an excluded or invalid path',async()=>{
 const {loadPendingEdits,savePendingEdits}=await import('../src/recovery');
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const root=mkdtempSync(join(tmpdir(),'owla-pending-'));
 try{
  const entry=(path:string)=>({edit:{path,before:'a',after:'b',reason:'r'},reasons:['r']});
  savePendingEdits(root,[entry('Notes/A.md'),entry('Private/B.md')]);
  assert.equal(loadPendingEdits(root).length,2);
  assert.throws(()=>loadPendingEdits(root,'Private'),/no longer allowed: Private\/B\.md/);
  assert.throws(()=>loadPendingEdits(root,'private'),/no longer allowed/);
  savePendingEdits(root,[entry('../outside.md')]);
  assert.throws(()=>loadPendingEdits(root),/no longer allowed/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('clearing an unloadable record restores allowed applied edits and keeps failures',async()=>{
 const {loadMain}=await import('./helpers/load-main');
 const {Butler}=await loadMain();
 const {savePendingEdits,readPendingRecord}=await import('../src/recovery');
 const {mkdtempSync,rmSync,existsSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const root=mkdtempSync(join(tmpdir(),'owla-clear-'));
 try{
  const entry=(path:string,extra:Record<string,unknown>={})=>({edit:{path,before:'old',after:'new',reason:'r'},reasons:['r'],...extra});
  const make=(texts:Record<string,string>,failing=new Set<string>())=>{
   const butler=Object.create(Butler.prototype);
   const restored:unknown[]=[];
   Object.assign(butler,{prefs:{excludedFolders:'Private'},pending:[],pendingLoadError:'bad',applyingEdit:false,vaultStorage:()=>root,
    allowedNote:(path:string)=>!path.startsWith('Private/'),currentText:async(path:string)=>texts[path],
    restoreEdit:async(edit:{path:string}&Record<string,string>)=>{if(failing.has(edit.path))throw Error('stale');restored.push(edit);}});
   return {butler,restored};
  };
  savePendingEdits(root,[entry('Notes/A.md'),entry('Notes/Same.md'),entry('Private/B.md'),entry('Notes/D.md',{deferred:true}),{edit:{path:'Notes/N.md',before:'',after:'x',reason:'r',create:true},reasons:['r']}] as any);
  const ok=make({'Notes/A.md':'new','Notes/Same.md':'old'});
  assert.deepEqual(await ok.butler.clearPendingEdits(),{skipped:1});
  // before and after are passed unswapped: restoreEdit swaps them itself.
  assert.deepEqual(ok.restored,[{path:'Notes/A.md',before:'old',after:'new',reason:'Restore OWLA Butler edit'}]);
  assert.equal(existsSync(join(root,'pending-edits.json')),false);
  assert.equal(ok.butler.pendingLoadError,'');
  savePendingEdits(root,[entry('Notes/A.md'),entry('Notes/C.md'),entry('Notes/D.md',{deferred:true})] as any);
  const bad=make({'Notes/A.md':'new','Notes/C.md':'new'},new Set(['Notes/C.md']));
  await bad.butler.clearPendingEdits();
  assert.deepEqual(readPendingRecord(root).map((e:any)=>e.edit.path),['Notes/C.md','Notes/D.md']);
  assert.match(bad.butler.pendingLoadError,/kept/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
