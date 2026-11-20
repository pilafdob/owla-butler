// macOS review follow-up (3.7.0-RC): the untrusted-content wrapper escapes
// whitespace spellings of its closing tag, and the PDF document cache bounds
// how much parsed PDF stays resident between reads.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {untrustedToolText} from '../src/validation';
import {PdfDocumentCache,PDF_CACHE_MAX_BYTES,type PdfDocumentKey,type PdfDocument,type PdfLoadingTask} from '../src/pdf';

test('closing-tag spellings with whitespace cannot end the untrusted wrapper',()=>{
 for(const tag of ['</untrusted_content>','</UNTRUSTED_CONTENT>','</untrusted_content >','</ untrusted_content>','< / untrusted_content\t>','</untrusted_content\r\n>']){
  const wrapped=untrustedToolText('before '+tag+' after');
  const body=wrapped.slice('<untrusted_content>\n'.length,-'\n</untrusted_content>'.length);
  assert.doesNotMatch(body,/<\s*\/\s*untrusted_content\s*>/i,JSON.stringify(tag));
  assert.ok(body.includes('<\\/untrusted_content>'),JSON.stringify(tag));
 }
 // Ordinary text, and tags that only resemble the wrapper, pass through unchanged.
 for(const text of ['plain note','<untrusted_content_extra>','</untrusted_contents>'])assert.equal(untrustedToolText(text),'<untrusted_content>\n'+text+'\n</untrusted_content>');
});

function fakePdf(){
 const state={destroys:0};
 const doc:PdfDocument={numPages:1,
  getPage:async()=>({getTextContent:async()=>({items:[]}),getViewport:()=>({width:1,height:1}),render:()=>({promise:Promise.resolve(),cancel:()=>{}}),cleanup:()=>{}}),
  destroy:async()=>{state.destroys++;}};
 const loading:PdfLoadingTask={promise:Promise.resolve(doc),destroy:async()=>{state.destroys++;}};
 return {doc,loading,state};
}
const key=(path:string,size:number):PdfDocumentKey=>({path,size,mtime:1});
const MB=1024*1024;

test('the default byte budget keeps at most 64 MB of PDFs parsed between reads',()=>{
 assert.equal(PDF_CACHE_MAX_BYTES,64*MB);
});

test('a PDF larger than the byte budget is not kept resident once its read ends',async()=>{
 const cache=new PdfDocumentCache(2,10*MB);let loads=0;const pdf=fakePdf();
 const lease=await cache.open(key('Big.pdf',20*MB),async()=>{loads++;return pdf;});
 assert.equal(cache.size,1,'an in-flight read keeps its document');
 assert.equal(pdf.state.destroys,0,'a live read is never torn down');
 lease.release();
 assert.equal(cache.size,0);
 assert.equal(pdf.state.destroys,1);
 (await cache.open(key('Big.pdf',20*MB),async()=>{loads++;return fakePdf();})).release();
 assert.equal(loads,2,'the large file is parsed per read instead of cached');
});

test('small PDFs are still reused, and the total budget evicts the oldest idle one',async()=>{
 const cache=new PdfDocumentCache(3,10*MB);let loads=0;
 const a=fakePdf(),b=fakePdf();
 (await cache.open(key('A.pdf',6*MB),async()=>{loads++;return a;})).release();
 (await cache.open(key('A.pdf',6*MB),async()=>{loads++;return fakePdf();})).release();
 assert.equal(loads,1,'a small PDF under the budget is reused');
 (await cache.open(key('B.pdf',6*MB),async()=>{loads++;return b;})).release();
 assert.equal(cache.size,1,'6 MB + 6 MB exceeds the 10 MB budget');
 assert.equal(a.state.destroys,1,'the older idle document is evicted');
 assert.equal(b.state.destroys,0,'the newest stays cached');
});

test('documents in use are never evicted by the byte budget',async()=>{
 const cache=new PdfDocumentCache(2,10*MB);const a=fakePdf(),b=fakePdf();
 const first=await cache.open(key('A.pdf',8*MB),async()=>a);
 const second=await cache.open(key('B.pdf',8*MB),async()=>b);
 assert.equal(a.state.destroys+b.state.destroys,0,'both reads are live');
 first.release();
 assert.equal(a.state.destroys,1,'the idle document goes once it is returned');
 assert.equal(b.state.destroys,0);
 second.release();
 assert.equal(cache.size,1);
});
