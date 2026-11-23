// 3.8.0 PDF export wiring: export_pdf is offered on desktop, reports the
// estimated layout and only stages a card (no write); propose_page_breaks
// stages markers through the normal diff and reverts byte-exactly; a
// confirmed export runs Obsidian's own exporter (route B), falls back to the
// dialog (route A), never overwrites, refuses excluded paths, and reads the
// PDF back into findings for the next message. Also covers the PDF-selection
// wiring in main.ts (image only for vision models, excluded PDFs refused,
// failed page renders dropped without blocking).
import {test,before,after} from 'node:test';import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {loadMain} from './helpers/load-main';
import {OWLA_PAGE_BREAK} from '../src/pdf-export';
import {pdfSelectionAttempt,PDF_SELECTION_IMAGE_CACHE_MAX,pdfSelectionCacheKey} from '../src/pdf-selection';
import {prefixToolNames,toolName,PROVIDER_IDS} from '../src/provider';

/* eslint-disable @typescript-eslint/no-explicit-any */
let Butler:any,ButlerView:any,obsidian:any;
let scratch:string,vault:string;
// 25 short paragraphs put "## Stranded" at the bottom of an A4 page with minimal margins (estimate).
const filler=Array.from({length:25},(_,i)=>'Paragraph '+i+' '+'word '.repeat(3)).join('\n\n');
const initial:Record<string,string>={
 'Notes/Report.md':'# Report\r\n\r\nIntro text.\r\n\r\n## Method\r\n\r\nSteps.\r\n\r\n## Results\r\n\r\nNumbers.\r\n',
 'Notes/Long.md':'# Long\n\n'+filler+'\n\n## Stranded\n\nTail text.\n',
 'Notes/Report.pdf':'existing',
 'Private/Secret.md':'# Secret\n',
 'Notes/Guide.pdf':'%PDF',
 'Private/Hidden.pdf':'%PDF',
};
const raw:Record<string,string>={};
const reset=()=>{for(const key of Object.keys(raw))delete raw[key];Object.assign(raw,initial);for(const [path,text] of Object.entries(initial))writeFileSync(join(vault,path),text);for(const extra of ['Notes/Report 1.pdf','Notes/Long.pdf','Notes/Elsewhere.pdf'])rmSync(join(vault,extra),{force:true});};

before(async()=>{
 ({Butler,ButlerView,obsidian}=await loadMain());
 scratch=mkdtempSync(join(tmpdir(),'owla-pdf-export-wiring-'));
 vault=join(scratch,'Vault');
 for(const folder of ['Notes','Private'])mkdirSync(join(vault,folder),{recursive:true});
 reset();
 (globalThis as any).window??=new EventTarget();
 // runPdfExport times the exporter with window timers, as in Obsidian.
 Object.assign((globalThis as any).window,{setTimeout,clearTimeout});
});
after(()=>{if(scratch)rmSync(scratch,{recursive:true,force:true,maxRetries:5,retryDelay:50});});

/** A chat element with the few DOM calls the export card uses. */
function el(text=''):any{
 const node:any={text,children:[] as any[],removed:false,disabled:false,onclick:null,
  createDiv(opts?:any){const child=el(typeof opts==='object'?opts.text??'':'');node.children.push(child);return child;},
  createEl(_tag:string,opts?:any){const child=el(opts?.text??'');node.children.push(child);return child;},
  setText(value:string){node.text=value;},remove(){node.removed=true;},closest:()=>null,querySelector:()=>null,
  find(label:string):any{for(const child of node.children){if(child.text===label)return child;const deep=child.find(label);if(deep)return deep;}return null;},
  all():string{return [node.text,...node.children.map((child:any)=>child.all())].join('\n');}};
 return node;
}

let printed:any[]=[];
function makeApp(options:{exporter?:boolean}={}){
 const exporter=options.exporter??true;
 const files=Object.keys(initial).map(path=>{const f=new obsidian.TFile(path);f.stat={size:initial[path].length,mtime:1};return f;});
 const fileMap=new Map<string,any>(files.map(f=>[f.path,f]));
 const adapter=new obsidian.FileSystemAdapter(vault);
 Object.assign(adapter,{
  exists:async(p:string)=>existsSync(join(vault,p)),getFullPath:(p:string)=>join(vault,p),
  readBinary:async(p:string)=>{const b=readFileSync(join(vault,p));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);},
 });
 const app:any={
  vault:{adapter,getName:()=>'Vault',getMarkdownFiles:()=>files.filter(f=>f.extension==='md'),getFiles:()=>files,getAllFolders:()=>[],
   getFileByPath:(p:string)=>fileMap.get(p)??null,getAbstractFileByPath:(p:string)=>fileMap.get(p)??null,
   getFolderByPath:(p:string)=>['Notes','Private'].includes(p)?new obsidian.TFolder(p):null,
   cachedRead:async(f:any)=>raw[f.path],read:async(f:any)=>raw[f.path],
   process:async(f:any,fn:(text:string)=>string)=>{raw[f.path]=fn(raw[f.path]);return raw[f.path];},
   getConfig:(key:string)=>key==='pdfExportSettings'?{pageSize:'A4',margin:'2',downscalePercent:100,includeName:false}:undefined,
   on:()=>({}),offref:()=>{}},
  metadataCache:{resolvedLinks:{},unresolvedLinks:{},getFileCache:()=>null,getFirstLinkpathDest:()=>null},
  commands:{findCommand:(id:string)=>id==='workspace:export-pdf'?{id}:null,executeCommandById:(id:string)=>{app.dialogOpened=id;return true;}},
 };
 // Obsidian's print modal: its printToPdf writes the PDF the main process would write.
 class PrintModal extends obsidian.Modal{file:any;constructor(a:any,file:any){super(a);this.file=file;}async printToPdf(opts:any){printed.push(opts);writeFileSync(opts.filepath,'%PDF-fake');}}
 const leaves:any[]=[];
 const viewFor=(file:any)=>{
  const leaf:any={detached:false,detach(){leaf.detached=true;},async openFile(f:any){leaf.view=viewFor(f).view;}};
  const view=new obsidian.MarkdownView(leaf);
  Object.assign(view,{file,editor:{getValue:()=>raw[file.path].replace(/\r\n/g,'\n')}});
  if(exporter)view.printToPdf=()=>{new PrintModal(app,file).open();};
  leaf.view=view;return leaf;
 };
 app.workspace={
  getLeavesOfType:(type:string)=>type==='markdown'?leaves:[],getActiveViewOfType:()=>null,getActiveFile:()=>null,
  getLeaf:()=>{const leaf:any={detached:false,detach(){leaf.detached=true;},async openFile(f:any){Object.assign(leaf,{view:viewFor(f).view});}};app.tempLeaf=leaf;return leaf;},
  setActiveLeaf:(leaf:any)=>{app.activeLeaf=leaf;},
 };
 return app;
}
function makeButler(app=makeApp()){
 const butler=new Butler(app,{id:'owla-butler',version:'t'});
 butler.app=app;
 Object.assign(butler.prefs,{storageRoot:join(scratch,'storage'),excludedFolders:'Private'});
 butler.organization={blocked:false,review:undefined,progress:undefined,busy:false,loadError:''};
 butler.inlineTitle=()=>false;
 return butler;
}
function makeView(butler:any){
 const view=new ButlerView({app:butler.app},butler);
 view.offeredToolNames=new Set(['read_note','export_pdf','propose_page_breaks']);
 return view;
}
/** A PDF.js stand-in serving the given page texts. */
function fakePdfJs(pages:string[]){
 const doc={numPages:pages.length,getPage:async(n:number)=>({getTextContent:async()=>({items:pages[n-1].split('\n').map(str=>({str,hasEOL:true}))}),cleanup(){}}),destroy:async()=>{}};
 return async()=>({getDocument:()=>({promise:Promise.resolve(doc),destroy:async()=>{},onPassword:null})});
}

test('export_pdf and propose_page_breaks are offered on desktop with strict schemas, under every provider name',()=>{
 const {specs}=makeButler().buildToolSpecs();
 const exportSpec=specs.find((spec:any)=>spec.name==='export_pdf');
 const breaks=specs.find((spec:any)=>spec.name==='propose_page_breaks');
 assert.ok(exportSpec&&breaks);
 assert.deepEqual(exportSpec.inputSchema.required,['path','reason']);
 assert.equal(exportSpec.inputSchema.additionalProperties,false);
 assert.deepEqual(exportSpec.inputSchema.properties.pageSize.enum,['A3','A4','A5','Legal','Letter','Tabloid']);
 assert.equal(breaks.inputSchema.additionalProperties,false);
 for(const id of PROVIDER_IDS)for(const name of ['export_pdf','propose_page_breaks'])assert.ok(prefixToolNames('use '+name,id).includes(toolName(id,name)));
 obsidian.Platform.isDesktopApp=false;
 try{assert.ok(!makeButler().buildToolSpecs().specs.some((spec:any)=>spec.name==='export_pdf'),'hidden on mobile');}
 finally{obsidian.Platform.isDesktopApp=true;}
});

test('export_pdf reports the estimate and stages a card without writing anything',async()=>{
 reset();printed=[];
 const view=makeView(makeButler()),log=el();
 const result=await view.tool('export_pdf',{path:'Notes/Long.md',reason:'print'},log,new Map());
 assert.match(result,/ready for the user to confirm in chat/);
 assert.match(result,/Output: Notes\/Long\.pdf \(A4, margin minimal, 100%\)/,'defaults come from the saved export settings');
 assert.match(result,/Heading "Stranded" is at the bottom of page/);
 assert.match(result,/Fix: page break before heading "Stranded"/);
 assert.ok(log.find('Export PDF…'),'the card offers the export');
 assert.equal(printed.length,0,'nothing was exported');
 assert.ok(!existsSync(join(vault,'Notes/Long.pdf')));
});

test('export_pdf refuses excluded notes and excluded or hidden output paths, and never overwrites',async()=>{
 reset();
 const view=makeView(makeButler()),log=el();
 await assert.rejects(view.tool('export_pdf',{path:'Private/Secret.md',reason:'r'},log,new Map()),/allowed Markdown note/);
 await assert.rejects(view.tool('export_pdf',{path:'Notes/Report.md',output:'Private/Out.pdf',reason:'r'},log,new Map()),/allowed vault folder/);
 await assert.rejects(view.tool('export_pdf',{path:'Notes/Report.md',output:'.hidden/Out.pdf',reason:'r'},log,new Map()),/allowed vault folder/);
 await assert.rejects(view.tool('export_pdf',{path:'Notes/Report.md',output:'../Out.pdf',reason:'r'},log,new Map()),/vault-relative/);
 await assert.rejects(view.tool('export_pdf',{path:'Notes/Report.md',pageSize:'B5',reason:'r'},log,new Map()),/pageSize must be one of/);
 const collision=await view.tool('export_pdf',{path:'Notes/Report.md',reason:'r'},log,new Map());
 assert.match(collision,/Output: Notes\/Report 1\.pdf/,'an existing PDF gets a numbered name');
});

test('propose_page_breaks stages only markers, keeps CRLF and reverts byte-exactly',async()=>{
 reset();
 const butler=makeButler(),view=makeView(butler),batches=new Map(),log=el();
 await view.tool('read_note',{path:'Notes/Report.md'},log,batches);
 await assert.rejects(view.tool('propose_page_breaks',{path:'Notes/Report.md',before:['Nope'],reason:'r'},log,batches),/No heading "Nope"/);
 await assert.rejects(view.tool('propose_page_breaks',{path:'Notes/Report.md',reason:'r'},log,batches),/Name the headings/);
 const result=await view.tool('propose_page_breaks',{path:'Notes/Report.md',before:['Results'],reason:'keep results together'},log,batches);
 assert.match(result,/added 1 page break/);
 const edit=batches.get('Notes/Report.md').edit;
 assert.equal(edit.after,edit.before.replace('## Results\n',OWLA_PAGE_BREAK+'\n\n## Results\n'));
 await butler.apply(edit);
 assert.equal(raw['Notes/Report.md'],initial['Notes/Report.md'].replace('## Results\r\n',OWLA_PAGE_BREAK+'\r\n\r\n## Results\r\n'),'written in CRLF');
 await butler.restoreEdit(edit);
 assert.equal(raw['Notes/Report.md'],initial['Notes/Report.md'],'revert restores the exact bytes');
 const again=await view.tool('propose_page_breaks',{path:'Notes/Report.md',before:['Results'],remove:true,reason:'r'},log,batches);
 assert.match(again,/cancel out|Nothing was staged|removed 1/);
});

test('a confirmed export uses Obsidian\'s exporter, reads the PDF back and queues the findings',async()=>{
 reset();printed=[];
 const app=makeApp(),view=makeView(makeButler(app));
 const previous=obsidian.loadPdfJs;
 obsidian.loadPdfJs=fakePdfJs(['Long\nParagraph 0\nStranded','Tail text.']);
 try{
  const options={pageSize:'A4',landscape:false,margin:'default',downscalePercent:100,includeName:false,open:false};
  const file=app.vault.getFileByPath('Notes/Long.md');
  const status=await view.exportPdf(file,'Notes/Long.pdf',options);
  assert.equal(printed.length,1,'Obsidian\'s own printToPdf ran once');
  assert.equal(printed[0].filepath,join(vault,'Notes/Long.pdf'));
  assert.equal(printed[0].pageSize,'A4');
  assert.ok(app.tempLeaf.detached,'the temporary tab is closed');
  assert.equal(obsidian.Modal.prototype.open.toString().includes('captured'),false,'Modal.prototype.open is restored');
  assert.match(status,/Saved Notes\/Long\.pdf\. 1 layout problem found/);
  const finding=view.pdfExportFindings.get('Notes/Long.md');
  assert.match(finding,/"Stranded" ends page 1/);
  assert.match(finding,/Fix round 1 of 2: stage page breaks with propose_page_breaks \(headings: "Stranded"\)/);
 }finally{obsidian.loadPdfJs=previous;}
});

test('without the internal exporter the export falls back to Obsidian\'s dialog',async()=>{
 reset();printed=[];
 const app=makeApp({exporter:false}),view=makeView(makeButler(app));
 const options={pageSize:'A4',landscape:false,margin:'default',downscalePercent:100,includeName:false,open:false};
 const status=await view.exportPdf(app.vault.getFileByPath('Notes/Report.md'),'Notes/Report 1.pdf',options);
 assert.equal(app.dialogOpened,'workspace:export-pdf');
 assert.equal(app.activeLeaf,app.tempLeaf,'the note is shown for the dialog');
 assert.equal(app.tempLeaf.detached,false,'the tab stays open while the dialog is up');
 assert.match(status,/Opened Obsidian’s Export to PDF dialog/);
 assert.equal(printed.length,0);
});

test('PDF selection: page images go only to models that read images',()=>{
 const pages=['data:page'],user=['data:user'];
 assert.deepEqual(pdfSelectionAttempt({inputModalities:['text','image']},user,pages,'IMG','TXT'),{images:['data:user','data:page'],context:'IMG'});
 assert.deepEqual(pdfSelectionAttempt({inputModalities:['text']},user,pages,'IMG','TXT'),{images:['data:user'],context:'TXT'});
 assert.deepEqual(pdfSelectionAttempt(undefined,[],pages,'IMG','TXT'),{images:['data:page'],context:'IMG'},'unknown modalities keep the image');
 assert.deepEqual(pdfSelectionAttempt({inputModalities:['text']},user,[],'CTX','CTX'),{images:['data:user'],context:'CTX'});
});

test('PDF selection: excluded PDFs are refused; failed renders are dropped and cached pages reused',async()=>{
 reset();
 const view=makeView(makeButler());
 assert.throws(()=>view.addPdfSelection({path:'Private/Hidden.pdf',text:'x',pdf:{page:1}}),/unavailable or excluded/);
 view.addPdfSelection({path:'Notes/Guide.pdf',text:'quoted',pdf:{page:2}});
 assert.equal(view.selections.length,1);
 // A vanished file: the page image is dropped, the send is not blocked.
 assert.deepEqual(await view.renderPdfSelectionImages([{path:'Notes/Gone.pdf',page:1}]),[]);
 // A cached page is served without rendering, and the cache stays bounded.
 const file=view.app.vault.getFileByPath('Notes/Guide.pdf');
 const key=pdfSelectionCacheKey({path:file.path,size:file.stat.size,mtime:file.stat.mtime},2);
 for(let i=0;i<PDF_SELECTION_IMAGE_CACHE_MAX;i++)view.pdfSelectionImageCache.set('other'+i,'x');
 view.pdfSelectionImageCache.set(key,'data:cached');
 assert.deepEqual(await view.renderPdfSelectionImages([{path:'Notes/Guide.pdf',page:2}]),[{path:'Notes/Guide.pdf',page:2,url:'data:cached'}]);
 assert.equal([...view.pdfSelectionImageCache.keys()].at(-1),key,'a hit becomes most recent');
});
