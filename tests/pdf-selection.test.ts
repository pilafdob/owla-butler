import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 PDF_SELECTION_IMAGE_NOTE,
 PDF_SELECTION_MAX_PAGES,
 pdfSelectionCacheKey,
 pdfSelectionChipLabel,
 pdfSelectionRenderPages,
 pdfSelectionSpanNote,
 pdfSelectionTextOnlyContext,
 selectionContextBlock,
 type SelectionItem,
} from '../src/pdf-selection';
import {pdfPageReference,pdfSource} from '../src/pdf';

const item=(path:string,text:string,over?:Partial<SelectionItem>):SelectionItem=>({path,text,...over});
const pdf=(page:number,pages?:number[])=>({page,pages});

test('chip label: Name.pdf · p. 4 · "first words…"',()=>{
 assert.equal(pdfSelectionChipLabel('Books/Guide.pdf',4,'first words and more'),'Guide.pdf · p. 4 · "first words and more"');
});

test('chip label falls back to the whole path when it carries no slash',()=>{
 assert.equal(pdfSelectionChipLabel('/tmp/nope.pdf',2,'hi'),'nope.pdf · p. 2 · "hi"');
});

test('chip label quotes the excerpt capped at 60 chars',()=>{
 const long='word '+'.'.repeat(100);
 assert.equal(pdfSelectionChipLabel('A.pdf',1,long),'A.pdf · p. 1 · "word '+'.'.repeat(55)+'…"');
});

test('chip label with no text is just the page citation',()=>{
 assert.equal(pdfSelectionChipLabel('T.pdf',7,''),'T.pdf · p. 7');
});

test('selectionContextBlock keeps the legacy shape for plain selections',()=>{
 assert.equal(selectionContextBlock(item('a.md','hello')),'\nSELECTED TEXT from a.md\nhello');
});

test('selectionContextBlock cites the page and does not break on brackets in the path',()=>{
 const actual=selectionContextBlock(item('A[B].pdf','scan the table',{pdf:{page:2}}));
 assert.ok(actual.startsWith('\nSELECTED TEXT from '+pdfSource('A[B].pdf',2)+' · '+pdfPageReference('A[B].pdf',2)+'\n'));
 assert.ok(!actual.includes('[[A[B].pdf#page=2'));
});

test('selectionContextBlock cites pdfSource and the clickable page reference',()=>{
 const actual=selectionContextBlock(item('Books/Guide.pdf','first words',{pdf:{page:4}}));
 assert.ok(actual.startsWith('\nSELECTED TEXT from '+pdfSource('Books/Guide.pdf',4)+' · '));
 assert.match(actual,/\[\[Books\/Guide\.pdf#page=4\|Guide,p\.4\]\]/);
 assert.ok(actual.includes('first words'));
});

test('selectionContextBlock includes the verbatim text on its own lines',()=>{
 const actual=selectionContextBlock(item('B.pdf','alpha\n\nbravo',{pdf:{page:9}}));
 assert.ok(actual.includes('\nalpha\n\nbravo'));
});

test('selectionContextBlock says so when the selection spans pages',()=>{
 const actual=selectionContextBlock(item('P.pdf','t',{pdf:{page:3,pages:[3,4,5]}}));
 assert.match(actual,/The selection spans PDF pages 3 to 5/);
 assert.match(actual,/at most the first 2/);
});

test('selectionContextBlock with an explicit single page has no span note',()=>{
 assert.equal(selectionContextBlock(item('P.pdf','t',{pdf:{page:3}})).includes('spans PDF pages'),false);
});

test('span note for a single page reads naturally',()=>{
 assert.equal(pdfSelectionSpanNote([5]),'The selection spans PDF pages 5 to 5. Page images for at most the first 2 of them are attached as background context for models that read images.');
});

test('render pages cap at 2 per selection and dedupe the same page across selections',()=>{
 const actual=pdfSelectionRenderPages([
  item('A.pdf','',{pdf:pdf(1,[1,2,3])}),   // spans 3 pages -> pages 1,2
  item('A.pdf','',{pdf:pdf(2,[2,3])}),     // page 2 already covered; page 3 comes next
  item('B.pdf','',{pdf:pdf(4)}),
 ]);
 assert.deepEqual(actual,[
  {path:'A.pdf',page:1},
  {path:'A.pdf',page:2},
  {path:'A.pdf',page:3},
  {path:'B.pdf',page:4},
 ]);
});

test('render pages fall back to the cited page when the span was not recorded',()=>{
 assert.deepEqual(pdfSelectionRenderPages([item('A.pdf','',{pdf:pdf(3)})]),[{path:'A.pdf',page:3}]);
});

test('cache key is stable for the same file and page, and changes with mtime or size',()=>{
 const key=(file:{path:string;size:number;mtime:number},page:number)=>pdfSelectionCacheKey(file,page);
 assert.equal(key({path:'A.pdf',size:100,mtime:100},4),key({path:'A.pdf',size:100,mtime:100},4));
 assert.notEqual(key({path:'A.pdf',size:100,mtime:100},4),key({path:'A.pdf',size:100,mtime:200},4));
 assert.notEqual(key({path:'A.pdf',size:100,mtime:100},4),key({path:'A.pdf',size:101,mtime:100},4));
});

test('text-only context swaps the image wording, and is a no-op without it',()=>{
 const withNote='...'+PDF_SELECTION_IMAGE_NOTE+'...';
 assert.notEqual(pdfSelectionTextOnlyContext(withNote),withNote);
 assert.equal(pdfSelectionTextOnlyContext('plain context'),'plain context');
});
