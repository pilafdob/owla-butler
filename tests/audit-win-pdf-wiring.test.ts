// Orchestrator wiring regressions (round 2): PdfDocumentCache wired into the
// read_pdf tool (win-attachments X-1), bounded Windows lock retries on binary
// reads (X-2). The cache itself has 13 lifecycle unit tests in
// audit-win-attachments-pdf-cache.test.ts; these prove the VIEW wiring:
// continuation reads reuse one parse, a changed mtime misses, stop() destroys,
// external File attachments cache by identity, failed loads are not cached,
// and EBUSY/EPERM/EACCES reads retry while other errors propagate at once.
import {test,before,after} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {loadMain} from './helpers/load-main';

/* eslint-disable @typescript-eslint/no-explicit-any */
let Butler:any,ButlerView:any,obsidian:any;
let scratch:string;
const state={parses:0,docDestroys:0,loadingDestroys:0,mode:'ok' as 'ok'|'password',readAttempts:0,readFail:'' as ''|'EBUSY'|'ENOENT'};

function fakeDoc(){
 return {numPages:3,
  getPage:async(n:number)=>({getTextContent:async()=>({items:[{str:'page '+n+' '+'word '.repeat(12),hasEOL:true,transform:[1,0,0,1,0,700]}]}),cleanup:()=>{}}),
  destroy:async()=>{state.docDestroys++;}};
}
function fakePdfJs(){
 return {getDocument:()=>{
  state.parses++;
  const loading:any={destroy:async()=>{state.loadingDestroys++;},onPassword:null,promise:null};
  if(state.mode==='password'){
   loading.promise=new Promise((_resolve,reject)=>{queueMicrotask(()=>{loading.onPassword?.();reject(Error('password required'));});});
  }else loading.promise=Promise.resolve(fakeDoc());
  return loading;
 }};
}

before(async()=>{
 ({Butler,ButlerView,obsidian}=await loadMain());
 obsidian.loadPdfJs=async()=>fakePdfJs();
 scratch=mkdtempSync(join(tmpdir(),'owla-win-pdf-wiring-'));
 // checkVaultFile asks the OS about the real file (realpath, hardlink count).
 writeFileSync(join(scratch,'Doc.pdf'),Buffer.from('%PDF-1.4 fake'));
 (globalThis as any).window??=new EventTarget();
});
after(()=>{if(scratch)rmSync(scratch,{recursive:true,force:true,maxRetries:5,retryDelay:50});});

function makeApp(){
 const file=new obsidian.TFile('Doc.pdf');file.stat={size:100,mtime:1000};
 return {
  vault:{adapter:new obsidian.FileSystemAdapter(scratch),getName:()=>'Vault',
   getAbstractFileByPath:(p:string)=>p==='Doc.pdf'?file:null,
   readBinary:async()=>{state.readAttempts++;
    if(state.readFail==='EBUSY'&&state.readAttempts<=2){const e:any=Error('resource busy');e.code='EBUSY';throw e;}
    if(state.readFail==='ENOENT'){const e:any=Error('missing');e.code='ENOENT';throw e;}
    return new ArrayBuffer(8);}},
  workspace:{getLeavesOfType:()=>[],getActiveViewOfType:()=>null,getActiveFile:()=>null},
  metadataCache:{resolvedLinks:{},unresolvedLinks:{},getFileCache:()=>null,getFirstLinkpathDest:()=>null},
  _file:file,
 };
}
function makeView(){
 const app=makeApp();
 const butler=new Butler(app,{id:'owla-butler',version:'t'});
 butler.app=app;
 Object.assign(butler.prefs,{storageRoot:join(scratch,'storage')});
 const view=new ButlerView({app},butler);
 view.offeredToolNames=new Set(['read_pdf']);
 return {view,app};
}
const log={createDiv:()=>({})};
const read=(view:any,args:any)=>view.tool('read_pdf',args,log,new Map());

test('continuation reads of one PDF reuse a single parse',async()=>{
 const {view}=makeView();
 const first=await read(view,{path:'Doc.pdf',page:1});
 assert.equal(state.parses,1);
 assert.match(String(first),/page 1/);
 const second=await read(view,{path:'Doc.pdf',page:2});
 assert.equal(state.parses,1,'the second continuation must hit the cache');
 assert.match(String(second),/page 2/);
 assert.equal(view.pdfCache.size,1);
});

test('a changed mtime misses the cache and re-parses',async()=>{
 const {view,app}=makeView();
 await read(view,{path:'Doc.pdf',page:1});
 const before=state.parses;
 app._file.stat.mtime=2000;
 await read(view,{path:'Doc.pdf',page:1});
 assert.equal(state.parses,before+1);
});

test('stop() destroys the cached documents',async()=>{
 const {view}=makeView();
 await read(view,{path:'Doc.pdf',page:1});
 assert.equal(view.pdfCache.size,1);
 const destroys=state.docDestroys;
 view.stop();
 assert.equal(view.pdfCache.size,0);
 assert.ok(state.docDestroys>destroys,'the idle document must be destroyed on stop');
});

test('an external File attachment caches by identity and reuses the parse',async()=>{
 const {view}=makeView();
 view.pdfAttachments.set('ext.pdf',new File([new Uint8Array(8)],'ext.pdf',{type:'application/pdf'}));
 const before=state.parses;
 await read(view,{path:'ext.pdf',page:1});
 await read(view,{path:'ext.pdf',page:2});
 assert.equal(state.parses,before+1,'both reads of one external File share a parse');
});

test('a password-protected PDF fails actionably and is not cached',async()=>{
 const {view}=makeView();
 state.mode='password';
 try{
  await assert.rejects(()=>read(view,{path:'Doc.pdf',page:1}),/password-protected/);
  assert.equal(view.pdfCache.size,0,'a failed load must not stay cached');
  state.mode='ok';
  const before=state.parses;
  await read(view,{path:'Doc.pdf',page:1});
  assert.equal(state.parses,before+1,'the next call retries the parse');
 }finally{state.mode='ok';}
});

test('binary reads ride out transient Windows locks (EBUSY) with a bounded retry',async()=>{
 const {view}=makeView();
 state.readFail='EBUSY';state.readAttempts=0;
 try{
  const output=await read(view,{path:'Doc.pdf',page:1});
  assert.match(String(output),/page 1/);
  assert.equal(state.readAttempts,3,'two transient failures, then success');
 }finally{state.readFail='';state.readAttempts=0;}
});

test('a non-lock read error propagates immediately, without retrying',async()=>{
 const {view}=makeView();
 state.readFail='ENOENT';state.readAttempts=0;
 try{
  await assert.rejects(()=>read(view,{path:'Doc.pdf',page:1}),/missing/);
  assert.equal(state.readAttempts,1);
 }finally{state.readFail='';state.readAttempts=0;}
});

test('distinct external Files with identical name/size/time get separate parses',async()=>{
 const {view}=makeView();
 const stamp=Date.now();
 // Same metadata, different objects: a filename/size/mtime key would collide
 // and hand the first document to the second attachment. File.lastModified is
 // read-only, so pin it with defineProperty.
 const a=new File([new Uint8Array(8)],'same.pdf',{type:'application/pdf'});
 const b=new File([new Uint8Array(8)],'same.pdf',{type:'application/pdf'});
 Object.defineProperty(a,'lastModified',{value:stamp});
 Object.defineProperty(b,'lastModified',{value:stamp});
 view.pdfAttachments.set('same.pdf',a);
 view.pdfAttachments.set('same (2).pdf',b);
 const before=state.parses;
 await read(view,{path:'same.pdf',page:1});
 await read(view,{path:'same (2).pdf',page:1});
 assert.equal(state.parses,before+2,'each File object must have its own cache entry');
 assert.equal(view.pdfCache.size,2);
});