import {test} from 'node:test';import assert from 'node:assert/strict';
import {pdfPageText,pdfPageNumber,pdfSource,markdownSource,readPdfTextRange,searchPdfText,PdfDocument} from '../src/pdf';
test('PDF text preserves line boundaries and source page references',()=>{assert.equal(pdfPageText([{str:'Heading',transform:[1,0,0,1,0,100],hasEOL:true},{str:'A',transform:[1,0,0,1,0,80]},{str:'sentence.',transform:[1,0,0,1,20,80],hasEOL:true},{str:'Next',transform:[1,0,0,1,0,60]}]),'Heading\nA sentence.\nNext');assert.equal(pdfSource('study.pdf',2),'study.pdf, p. 2');});
test('invalid PDF pages rejected instead of reading a different page',()=>{assert.equal(pdfPageNumber('2',3),2);for(const p of ['0','4','-1','1.5','2x',''])assert.throws(()=>pdfPageNumber(p,3));});
test('PDF filenames retain identity while Markdown output is escaped',()=>{assert.equal(pdfSource('a[notes].pdf',1),'a[notes].pdf, p. 1');assert.equal(markdownSource(pdfSource('a[notes].pdf',1)),'a\\[notes\\].pdf, p. 1');assert.equal(pdfSource('a\n.pdf',1),'a .pdf, p. 1');});

test('long PDFs expose a continuation that preserves the rest of a dense page and later pages',async()=>{
 const pages=['A'.repeat(70000)+'END-OF-FIRST','LAST-PAGE-CODE'];
 const doc:PdfDocument={
  numPages:pages.length,
  getPage:async number=>({
   getTextContent:async()=>({items:[{str:pages[number-1]}]}),
   getViewport:()=>({width:1,height:1}),
   render:()=>({promise:Promise.resolve(),cancel:()=>{}}),
   cleanup:()=>{}
  }),
  destroy:async()=>{}
 };
 const initial=await readPdfTextRange(doc,'Large.pdf');
 const next=initial.match(/Continue with read_pdf (\{[^\n]+\})/);
 assert.ok(next);
 assert.match(initial,/2 pages in total/);
 assert.doesNotMatch(initial,/LAST-PAGE-CODE/);
 const remainder=await readPdfTextRange(doc,'Large.pdf',JSON.parse(next[1]));
 assert.match(remainder,/END-OF-FIRST/);
 assert.match(remainder,/LAST-PAGE-CODE/);
 assert.doesNotMatch(remainder,/Continue with read_pdf/);
});

test('PDF search reports scanned pages and continues until later text matches',async()=>{
 const doc:PdfDocument={
  numPages:65,
  getPage:async page=>({
   getTextContent:async()=>({items:page===1?[]:[{str:page===65?'Example phrase':'Background'}]}),
   getViewport:()=>({width:1,height:1}),
   render:()=>({promise:Promise.resolve(),cancel:()=>{}}),
   cleanup:()=>{}
  }),
  destroy:async()=>{}
 };
 const first=JSON.parse(await searchPdfText(doc,'Large.pdf','example phrase'));
 assert.deepEqual(first.matches,[]);
 assert.equal(first.scannedPages,1);
 assert.equal(first.continueWith.page,65);
 const next=JSON.parse(await searchPdfText(doc,'Large.pdf','example phrase',first.continueWith));
 assert.deepEqual(next.matches,[{page:65,excerpt:'Example phrase'}]);
 assert.equal(next.continueWith,undefined);
});
