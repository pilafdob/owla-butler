// PdfDocumentCache lifecycle (round-1 deferred item 5.1, the pdf.ts side):
// LRU reuse keyed by path+size+mtime, lease refcounts, invalidation while a
// read is in flight, failed loads, and destroy-all for newChat/onClose/abort.
// Pure unit level: fake PDF.js documents, no live vault, no file handles.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PdfDocumentCache,type PdfDocumentKey,type PdfDocument,type PdfLoadingTask} from '../src/pdf';

function fakePdf(){
 const state={destroys:0};
 const doc:PdfDocument={
  numPages:1,
  getPage:async()=>({getTextContent:async()=>({items:[]}),getViewport:()=>({width:1,height:1}),render:()=>({promise:Promise.resolve(),cancel:()=>{}}),cleanup:()=>{}}),
  destroy:async()=>{state.destroys++;}
 };
 const loading:PdfLoadingTask={promise:Promise.resolve(doc),destroy:async()=>{state.destroys++;}};
 return {doc,loading,state};
}
const key=(path:string,size=10,mtime=100):PdfDocumentKey=>({path,size,mtime});
function deferred(){
 let resolve!:(value:{doc:PdfDocument;loading:PdfLoadingTask})=>void;
 const promise=new Promise<{doc:PdfDocument;loading:PdfLoadingTask}>(r=>{resolve=r;});
 return {promise,resolve};
}

test('continuation reads reuse one parse while the file is unchanged',async()=>{
 const cache=new PdfDocumentCache(2);let loads=0;
 const load=async()=>{loads++;return fakePdf();};
 const a=await cache.open(key('Book.pdf'),load);a.release();
 const b=await cache.open(key('Book.pdf'),load);b.release();
 assert.equal(loads,1);
 assert.equal(cache.size,1);
});

test('a changed size or mtime misses the cache',async()=>{
 const cache=new PdfDocumentCache(2);let loads=0;
 const load=async()=>{loads++;return fakePdf();};
 (await cache.open(key('Book.pdf',10,100),load)).release();
 (await cache.open(key('Book.pdf',11,100),load)).release();
 (await cache.open(key('Book.pdf',10,101),load)).release();
 assert.equal(loads,3);
 assert.equal(cache.size,2,'capacity bounds the cache');
});

test('the least recently used document is evicted at capacity',async()=>{
 const cache=new PdfDocumentCache(2);
 const made=new Map<string,ReturnType<typeof fakePdf>>();
 const load=(path:string)=>async()=>{const made0=fakePdf();made.set(path,made0);return made0;};
 (await cache.open(key('A.pdf'),load('A.pdf'))).release();
 (await cache.open(key('B.pdf'),load('B.pdf'))).release();
 (await cache.open(key('A.pdf'),load('A.pdf'))).release(); // touch A
 (await cache.open(key('C.pdf'),load('C.pdf'))).release();
 assert.equal(made.get('B.pdf')!.state.destroys,1,'B was least recently used');
 assert.equal(made.get('A.pdf')!.state.destroys,0);
 assert.equal(cache.size,2);
});

test('concurrent opens share one parse and both leases work',async()=>{
 const cache=new PdfDocumentCache(2);let loads=0;
 const gate=deferred();
 const load=()=>{loads++;return gate.promise;};
 const p1=cache.open(key('Book.pdf'),load);
 const p2=cache.open(key('Book.pdf'),load);
 const made=fakePdf();gate.resolve(made);
 const [a,b]=await Promise.all([p1,p2]);
 assert.equal(loads,1);
 assert.equal(a.doc,b.doc);
 a.release();b.release();
 assert.equal(made.state.destroys,0,'still cached after both leases return');
 assert.equal(cache.size,1);
});

test('invalidate destroys idle documents immediately and re-parses the next open',async()=>{
 const cache=new PdfDocumentCache(2);let loads=0;
 const made:ReturnType<typeof fakePdf>[]=[];
 const load=async()=>{loads++;const m=fakePdf();made.push(m);return m;};
 (await cache.open(key('A.pdf'),load)).release();
 cache.invalidate('A.pdf');
 assert.equal(made[0].state.destroys,1);
 assert.equal(cache.size,0);
 (await cache.open(key('A.pdf'),load)).release();
 assert.equal(loads,2);
});

test('a document in use survives invalidate until its last lease is released',async()=>{
 const cache=new PdfDocumentCache(2);
 const made=fakePdf();
 const lease=await cache.open(key('A.pdf'),async()=>made);
 cache.invalidate('A.pdf');
 assert.equal(made.state.destroys,0,'an in-flight read is never torn down');
 assert.equal(lease.doc.numPages,1);
 assert.equal(cache.size,0);
 lease.release();
 assert.equal(made.state.destroys,1);
});

test('invalidate during a pending load defers destruction to release',async()=>{
 const cache=new PdfDocumentCache(2);
 const gate=deferred();
 const pending=cache.open(key('A.pdf'),()=>gate.promise);
 cache.invalidate('A.pdf');
 assert.equal(cache.size,0);
 const made=fakePdf();gate.resolve(made);
 const lease=await pending;
 assert.equal(made.state.destroys,0);
 lease.release();
 assert.equal(made.state.destroys,1);
});

test('destroyAll clears everything (newChat/onClose/abort wiring)',async()=>{
 const cache=new PdfDocumentCache(2);
 const a=fakePdf(),b=fakePdf();
 (await cache.open(key('A.pdf'),async()=>a)).release();
 (await cache.open(key('B.pdf'),async()=>b)).release();
 cache.destroyAll();
 assert.equal(a.state.destroys,1);
 assert.equal(b.state.destroys,1);
 assert.equal(cache.size,0);
});

test('a failed load is not cached and the next open retries',async()=>{
 const cache=new PdfDocumentCache(2);let loads=0;
 const load=async()=>{loads++;if(loads===1)throw Error('Invalid PDF structure.');return fakePdf();};
 await assert.rejects(cache.open(key('A.pdf'),load),/Invalid PDF structure/);
 assert.equal(cache.size,0);
 const lease=await cache.open(key('A.pdf'),load);
 lease.release();
 assert.equal(loads,2);
});

test('an in-use document is never evicted; releasing a lease shrinks an overflow',async()=>{
 const cache=new PdfDocumentCache(1);
 const a=fakePdf(),b=fakePdf(),c=fakePdf();
 const held=await cache.open(key('A.pdf'),async()=>a);
 (await cache.open(key('B.pdf'),async()=>b)).release();
 // The overflow existed only while both were leased; returning B's lease evicts
 // the now-idle B immediately instead of waiting for another open().
 assert.equal(cache.size,1,'releasing a lease restores the capacity bound');
 assert.equal(a.state.destroys,0,'the still-held document was never touched');
 assert.equal(b.state.destroys,1,'the released idle document was destroyed');
 held.release();
 (await cache.open(key('C.pdf'),async()=>c)).release();
 assert.equal(a.state.destroys,1);
 assert.equal(c.state.destroys,0,'the document still cached at capacity is kept');
 assert.equal(cache.size,1);
});

test('concurrent leases over capacity shrink back on release without another open',async()=>{
 const cache=new PdfDocumentCache(1);
 const a=fakePdf(),b=fakePdf();
 const la=await cache.open(key('A.pdf'),async()=>a);
 const lb=await cache.open(key('B.pdf'),async()=>b);
 assert.equal(cache.size,2,'two live leases temporarily exceed capacity');
 assert.equal(a.state.destroys+b.state.destroys,0,'no live document is ever evicted');
 la.release();
 assert.equal(cache.size,1,'releasing one lease shrinks the cache back to capacity');
 assert.equal(a.state.destroys,1,'the returned idle document was destroyed');
 lb.release();
 assert.equal(cache.size,1,'the remaining cached document is kept at capacity');
});

test('release is idempotent per lease',async()=>{
 const cache=new PdfDocumentCache(2);
 const made=fakePdf();
 const lease=await cache.open(key('A.pdf'),async()=>made);
 cache.invalidate('A.pdf');
 lease.release();lease.release();
 assert.equal(made.state.destroys,1);
});

test('invalidate only matches the named file',async()=>{
 const cache=new PdfDocumentCache(2);
 const a=fakePdf(),b=fakePdf();
 (await cache.open(key('A.pdf'),async()=>a)).release();
 (await cache.open(key('B.pdf'),async()=>b)).release();
 cache.invalidate('A.pdf');
 assert.equal(a.state.destroys,1);
 assert.equal(b.state.destroys,0);
 assert.equal(cache.size,1);
});

test('a path with separators cannot collide with another key',async()=>{
 const cache=new PdfDocumentCache(2);let loads=0;
 const load=async()=>{loads++;return fakePdf();};
 (await cache.open(key('Bio/Book.pdf'),load)).release();
 (await cache.open(key('Bio\\Book.pdf'),load)).release();
 assert.equal(loads,2,'distinct paths stay distinct');
});