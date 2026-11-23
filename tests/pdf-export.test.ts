import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 OWLA_PAGE_BREAK,PDF_FIX_ROUNDS,
 pdfExportOptions,obsidianPrintOptions,pdfOutputPath,
 markdownBlocks,pageGeometry,estimateLayout,detectLayoutIssues,
 insertPageBreaks,removePageBreaks,applyLayoutFixes,
 headingPlainText,pdfLayoutIssues,issuesFromPdf,layoutReport,
 type PdfExportOptions,
} from '../src/pdf-export';

const base:PdfExportOptions={pageSize:'A4',landscape:false,margin:'default',downscalePercent:100,includeName:false,open:false};
const per=pageGeometry(base).linesPerPage;
const filler=(n:number)=>Array.from({length:n},(_,i)=>'Line '+i+' of filler text.').join('\n');

test('options: defaults, saved Obsidian settings, validation',()=>{
 assert.deepEqual(pdfExportOptions(),{pageSize:'Letter',margin:'default',downscalePercent:100,landscape:false,includeName:false,open:false});
 const saved=pdfExportOptions({},{pageSize:'A4',landscape:true,margin:'2',downscalePercent:80,includeName:true});
 assert.equal(saved.pageSize,'A4');assert.equal(saved.margin,'minimal');assert.equal(saved.downscalePercent,80);assert.equal(saved.landscape,true);assert.equal(saved.includeName,true);
 assert.equal(pdfExportOptions({pageSize:'a5'}).pageSize,'A5');
 assert.throws(()=>pdfExportOptions({pageSize:'B5'}),/pageSize/);
 assert.throws(()=>pdfExportOptions({margin:'wide'}),/margin/);
 assert.throws(()=>pdfExportOptions({downscalePercent:5}),/downscalePercent/);
 assert.throws(()=>pdfExportOptions({downscalePercent:50.5}),/downscalePercent/);
 assert.throws(()=>pdfExportOptions({landscape:'yes'}),/landscape/);
});

test('obsidianPrintOptions mirrors Obsidian\'s dialog output',()=>{
 assert.deepEqual(obsidianPrintOptions(base,'/v/N.pdf'),{includeName:false,pageSize:'A4',landscape:false,marginsType:0,scaleFactor:100,scale:1,open:false,filepath:'/v/N.pdf'});
 const none=obsidianPrintOptions({...base,margin:'none',downscalePercent:50},'x.pdf');
 assert.equal(none.marginsType,1);assert.deepEqual(none.margins,{top:0,left:0,bottom:0,right:0});assert.equal(none.scale,.5);
 assert.equal(obsidianPrintOptions({...base,margin:'minimal'},'x.pdf').marginsType,2);
});

test('output path: next to note, collision suffix, no traversal',()=>{
 const taken=new Set(['Docs/Plan.pdf','Docs/Plan 1.pdf']);
 assert.equal(pdfOutputPath('Docs/Plan.md',()=>false),'Docs/Plan.pdf');
 assert.equal(pdfOutputPath('Docs/Plan.md',p=>taken.has(p)),'Docs/Plan 2.pdf');
 assert.equal(pdfOutputPath('Plan.md',()=>false),'Plan.pdf');
 assert.equal(pdfOutputPath('Docs/Plan.md',()=>false,'Out\\Final.pdf'),'Out/Final.pdf');
 assert.equal(pdfOutputPath('Docs/Plan.md',()=>false,'Out/Final'),'Out/Final.pdf');
 assert.throws(()=>pdfOutputPath('Docs/Plan.md',()=>false,'../x.pdf'),/vault-relative/);
 assert.throws(()=>pdfOutputPath('Docs/Plan.md',()=>false,'Out/'),/vault-relative/);
 assert.throws(()=>pdfOutputPath('a.md',()=>true),/Too many/);
});

test('blocks: frontmatter, headings, fences opaque, tables, images, breaks',()=>{
 const text=['---','title: x','---','# Title','','Para one','continues','','```','# not a heading','```','','| a | b |','|---|---|','| 1 | 2 |','','![[pic.png|300]]','',OWLA_PAGE_BREAK,'','- item','- item','','$$','x^2','$$'].join('\n');
 const kinds=markdownBlocks(text).map(b=>b.kind);
 assert.deepEqual(kinds,['frontmatter','heading','paragraph','code','table','image','break','list','math']);
 assert.equal(markdownBlocks(text).filter(b=>b.kind==='heading').length,1);
 assert.deepEqual(markdownBlocks(text.replace(/\n/g,'\r\n')).map(b=>b.kind),kinds);
});

test('geometry: landscape and downscale fit more',()=>{
 const portrait=pageGeometry(base),land=pageGeometry({...base,landscape:true}),small=pageGeometry({...base,downscalePercent:50});
 assert.ok(land.charsPerLine>portrait.charsPerLine&&land.linesPerPage<portrait.linesPerPage);
 assert.ok(small.linesPerPage>=portrait.linesPerPage*2-1);
});

test('estimate: images move whole, breaks start a page',()=>{
 const text=filler(per-3)+'\n\n![[big.png|600x600]]';
 const placed=estimateLayout(text,base);
 assert.equal(placed.at(-1)?.kind,'image');assert.equal(placed.at(-1)?.page,2);assert.equal(placed.at(-1)?.top,0);
 const broken=estimateLayout('Intro\n\n'+OWLA_PAGE_BREAK+'\n\n# Next',base);
 assert.equal(broken.at(-1)?.page,2);
});

test('detect: orphan heading at page bottom gets a fix before the heading run',()=>{
 const lines=filler(per-4).split('\n');
 const text=[...lines,'','## Section','### Sub','',filler(10)].join('\n');
 const issues=detectLayoutIssues(text,base);
 const orphan=issues.find(i=>i.kind==='orphan-heading');
 assert.ok(orphan,layoutReport(issues));
 assert.equal(orphan.fixLine,lines.length+1,'break goes before "## Section", not "### Sub"');
});

test('detect: proposal example — title on page 1, text on page 2',()=>{
 const text=[filler(per-4),'','# Chapter 2','',filler(20)].join('\n');
 const issue=detectLayoutIssues(text,base).find(i=>i.heading==='Chapter 2');
 assert.ok(issue&&issue.fixLine!==undefined);
});

test('detect: no issue when heading has room; first heading is unfixable title-alone',()=>{
 assert.deepEqual(detectLayoutIssues('# A\n\n'+filler(5)+'\n\n## B\n\n'+filler(5),base),[]);
 const lone=detectLayoutIssues('# Title\n\n![[huge.png|800x5000]]\n',base);
 assert.ok(lone.every(i=>i.fixLine===undefined));
 const named=detectLayoutIssues(filler(0)+'![[pic.png|500x990]]',{...base,includeName:true,title:'Note'});
 assert.equal(named[0]?.kind,'title-alone');assert.equal(named[0]?.fixLine,undefined);
});

test('detect: table that fits on one page but splits',()=>{
 const table=['| a | b |','|---|---|',...Array.from({length:8},(_,i)=>'| '+i+' | x |')].join('\n');
 const text=filler(per-5)+'\n\n'+table;
 const issue=detectLayoutIssues(text,base).find(i=>i.kind==='split-table');
 assert.ok(issue&&issue.fixLine===per-5+1);
});

test('insert/remove: idempotent, round-trip, CRLF-safe, fences untouched',()=>{
 const text=['# A','','text','','## B','','```','## C','```','','## D'].join('\n');
 const once=insertPageBreaks(text,[4,7,10,0]);
 assert.deepEqual(once.inserted,[4,10],'line 0 and fenced line skipped');
 assert.ok(once.text.includes(OWLA_PAGE_BREAK+'\n\n## B'));
 assert.ok(once.text.includes('```\n## C\n```'));
 assert.equal(insertPageBreaks(once.text,[6,15]).text,once.text,'already preceded by a break');
 assert.equal(removePageBreaks(once.text).text,text);
 assert.equal(removePageBreaks(once.text).removed,2);
 const crlf=text.replace(/\n/g,'\r\n'),c=insertPageBreaks(crlf,[4]);
 assert.ok(!/[^\r]\n/.test(c.text),'only CRLF line endings');
 assert.equal(removePageBreaks(c.text).text,crlf);
});

test('remove: keeps hand-written breaks and markers inside code',()=>{
 const hand='<div style="page-break-after: always;"></div>';
 const text=['a','',hand,'','```',OWLA_PAGE_BREAK,'```','',OWLA_PAGE_BREAK,'','b'].join('\n');
 const out=removePageBreaks(text);
 assert.equal(out.removed,1);assert.ok(out.text.includes(hand));assert.ok(out.text.includes('```\n'+OWLA_PAGE_BREAK+'\n```'));
 assert.deepEqual(insertPageBreaks(['a','',hand,'','# H'].join('\n'),[4]).inserted,[],'hand-written break counts');
});

test('insert never touches the line after frontmatter',()=>{
 const text='---\na: 1\n---\n# Title\n\nx';
 assert.deepEqual(insertPageBreaks(text,[3]).inserted,[]);
});

test('applyLayoutFixes splits fixable and unfixable, prose unchanged',()=>{
 const text=[filler(per-4),'','# Chapter 2','',filler(20)].join('\n');
 const fixed=applyLayoutFixes(text,detectLayoutIssues(text,base));
 assert.equal(fixed.inserted.length,1);
 assert.equal(removePageBreaks(fixed.text).text,text);
 assert.deepEqual(detectLayoutIssues(fixed.text,base).filter(i=>i.heading==='Chapter 2'),[]);
});

test('PDF read-back: stranded heading, title alone, last page ignored',()=>{
 const pages=['Intro text\nmore text\nChapter 2','Body of chapter 2\nTail\ncontent','Last\nTail'];
 assert.deepEqual(pdfLayoutIssues(pages,['Intro','Chapter 2','Tail']),[{kind:'orphan-heading',page:1,heading:'Chapter 2'}]);
 assert.deepEqual(pdfLayoutIssues(['My Note','body'],['Other'],'My Note'),[{kind:'title-alone',page:1,heading:'My Note'}]);
 assert.deepEqual(pdfLayoutIssues(['a\nChapter 2'],['Chapter 2']),[]);
 assert.equal(headingPlainText('See [[Folder/Note#Part|the part]] and **bold** [x](y)'),'See the part and bold x');
});

test('issuesFromPdf maps back to note lines; title line from export is unfixable',()=>{
 const text=['# Intro','','text','','## **Chapter** 2','','more'].join('\n');
 const mapped=issuesFromPdf(text,[{kind:'orphan-heading',page:1,heading:'Chapter 2'},{kind:'title-alone',page:1,heading:'File Name'}]);
 assert.equal(mapped[0].fixLine,4);
 assert.equal(mapped[1].fixLine,undefined);
 assert.equal(PDF_FIX_ROUNDS,2);
});
