import {record,list} from './validation';

/** Extract text while retaining PDF.js line boundaries. Geometry/columns still require visual review. */
export function pdfPageText(items:unknown[]):string{
 let text='',previousY:number|undefined;
 for(const value of items){const item=record(value);if(typeof item.str!=='string')continue;const y=list(item.transform)[5];
 if(previousY!==undefined&&typeof y==='number'&&Math.abs(y-previousY)>3&&!text.endsWith('\n'))text+='\n';
 text+=item.str+(item.hasEOL?'\n':' ');if(typeof y==='number')previousY=y;
 }return text.replace(/[ \t]+\n/g,'\n').trim();
}
export function pdfPageNumber(value:string,total:number):number{if(!/^\d+$/.test(value))throw Error('Enter a page number.');const page=Number(value);if(page<1||page>total)throw Error(`Choose a page from 1 to ${total}.`);return page;}
export function pdfSource(name:string,page:number):string{return name.replace(/\p{Cc}/gu,' ')+', p. '+page;}
/** Clipboard link for a PDF page: a wikilink to the vault path at that page, aliased as the file name without folders or extension (either path separator), then ',p.' and the page number. */
export function pdfPageReference(path:string,page:number):string{const target=path.replace(/\\/g,'/').replace(/\p{Cc}/gu,' '),name=(target.split('/').pop()||target).replace(/\.pdf$/i,'');return '[['+target+'#page='+page+'|'+name+',p.'+page+']]';}

export function markdownSource(value:string):string{return value.replace(/([\\`*_[\]<>])/g,'\\$1');}

// Obsidian exposes PDF.js as an untyped host module. These are the API parts
// used by the attachment reader; no second PDF.js bundle is needed.
export interface PdfViewport{width:number;height:number;}
export interface PdfRenderTask{promise:Promise<void>;cancel():void;}
export interface PdfPage{
 getViewport(options:{scale:number}):PdfViewport;
 getTextContent():Promise<{items:unknown[]}>;
 render(options:{canvasContext:CanvasRenderingContext2D;viewport:PdfViewport;background:string;intent:'print'}):PdfRenderTask;
 cleanup():void;
}
export interface PdfDocument{numPages:number;getPage(page:number):Promise<PdfPage>;destroy():Promise<void>;}
export interface PdfLoadingTask{promise:Promise<PdfDocument>;onPassword?:()=>void;destroy():Promise<void>;}
export interface PdfJs{getDocument(options:{data:Uint8Array;isEvalSupported:boolean;useSystemFonts:boolean}):PdfLoadingTask;}

interface PdfRange {page?:number;endPage?:number;offset?:number;}

export async function readPdfTextRange(
 doc:PdfDocument,source:string,range:PdfRange={},
 signal?:AbortSignal,onPage?:(page:number)=>void
):Promise<string>{
 const start=pdfPageNumber(String(range.page??1),doc.numPages);
 const end=pdfPageNumber(String(range.endPage??(range.page===undefined?doc.numPages:start)),doc.numPages);
 const offset=range.offset??0;
 if(end<start||!Number.isSafeInteger(offset)||offset<0)throw Error('Use an ascending PDF page range and a nonnegative text offset.');
 const budget=64_000;
 let text=source+' · '+doc.numPages+' pages in total.\n';
 const last=Math.min(end,start+31);
 for(let number=start;number<=last;number++){
  signal?.throwIfAborted();
  const page=await doc.getPage(number);
  try{
   const extracted=pdfPageText((await page.getTextContent()).items);
   const begin=number===start?offset:0;
   if(begin>extracted.length)throw Error('The text offset exceeds this page.');
   const label='\n['+pdfSource(source,number)+']\n';
   const remaining=budget-text.length-label.length;
   if(remaining<=0)return text+continuation(source,number,end,begin);
   const body=extracted||'[Scanned page. Use read_pdf with page='+number+' and visual=true to read it.]';
   if(!extracted&&body.length>remaining)return text+continuation(source,number,end,0);
   text+=label+body.slice(begin,begin+remaining);
   if(extracted)onPage?.(number);
   if(begin+remaining<body.length)return text+continuation(source,number,end,begin+remaining);
  }finally{page.cleanup();}
 }
 return last<end?text+continuation(source,last+1,end,0):text;
}

function continuation(path:string,page:number,endPage:number,offset:number):string{
 return '\n[More PDF text is available. Continue with read_pdf '+JSON.stringify({path,page,endPage,...(offset?{offset}:{})})+']';
}

export async function searchPdfText(
 doc:PdfDocument,source:string,query:string,range:PdfRange={},signal?:AbortSignal,onMatch?:(page:number)=>void
):Promise<string>{
 const start=pdfPageNumber(String(range.page??1),doc.numPages);
 const end=pdfPageNumber(String(range.endPage??doc.numPages),doc.numPages);
 const needle=query.trim().replace(/\s+/g,' ').toLowerCase();
 if(!needle||needle.length>200||end<start||range.offset!==undefined){
  throw Error('Use a search phrase of up to 200 characters and an ascending PDF page range.');
 }
 const matches:{page:number;excerpt:string}[]=[];
 let scannedPages=0,number=start;
 for(;number<=Math.min(end,start+63)&&matches.length<8;number++){
  signal?.throwIfAborted();
  const page=await doc.getPage(number);
  try{
   const text=pdfPageText((await page.getTextContent()).items).replace(/\s+/g,' ');
   if(!text){scannedPages++;continue;}
   const match=text.toLowerCase().indexOf(needle);
   if(match>=0){
    matches.push({page:number,excerpt:text.slice(Math.max(0,match-100),match+needle.length+160)});
    onMatch?.(number);
   }
  }finally{page.cleanup();}
 }
 return JSON.stringify({
  path:source,totalPages:doc.numPages,searchedPages:[start,number-1],matches,
  ...(scannedPages?{scannedPages,note:'Pages without searchable text may require a visual read.'}:{}),
  ...(number<=end?{continueWith:{path:source,query,page:number,endPage:end}}:{})
 });
}

/** Identity and last observed state of a PDF file; a changed size or mtime
 * misses the cache. Windows mtime has millisecond granularity, so the wiring
 * also invalidates on vault modify events. */
export interface PdfDocumentKey{path:string;size:number;mtime:number;}
/** A borrowed document; release() returns it (idempotent per lease). */
export interface PdfDocumentLease{doc:PdfDocument;release():void;}
interface PdfCacheEntry{promise:Promise<PdfDocument>;doc:PdfDocument|null;loading:PdfLoadingTask|null;refs:number;dead:boolean;bytes:number;}
/**
 * A small LRU of parsed PDF documents, so continuation reads of one file do
 * not re-parse it (round-1 deferred item 5.1). Every open takes a lease;
 * invalidate()/destroyAll() mark entries dead and destroy them once the last
 * lease is returned, so an in-flight read is never torn down mid-page. Failed
 * loads are not cached. The bytes are read before parsing and no file handle
 * is kept, so the cache cannot hold a Windows file lock (EBUSY/OneDrive).
 * Idle documents are also bounded by their total file size (maxBytes): a
 * large PDF is parsed for each read rather than kept resident between reads.
 */
/** Total file size of the PDFs the cache may keep parsed between reads. */
export const PDF_CACHE_MAX_BYTES=64*1024*1024;
export class PdfDocumentCache{
 private entries=new Map<string,PdfCacheEntry>();
 constructor(private capacity=2,private maxBytes=PDF_CACHE_MAX_BYTES){}
 get size():number{return this.entries.size;}
 /** Opens (or reuses) the document for the key; concurrent opens share one parse. */
 open(key:PdfDocumentKey,load:()=>Promise<{doc:PdfDocument;loading:PdfLoadingTask}>):Promise<PdfDocumentLease>{
  const id=key.path+'\u0000'+key.size+'\u0000'+key.mtime;
  let entry=this.entries.get(id);
  if(entry&&!entry.dead){this.entries.delete(id);this.entries.set(id,entry);}
  else{
   let fresh:PdfCacheEntry;
   const promise=Promise.resolve().then(async()=>{const loaded=await load();fresh.doc=loaded.doc;fresh.loading=loaded.loading;return loaded.doc;});
   fresh={promise,doc:null,loading:null,refs:0,dead:false,bytes:Number.isFinite(key.size)&&key.size>0?key.size:0};
   promise.catch(()=>{if(this.entries.get(id)===fresh)this.entries.delete(id);});
   entry=fresh;this.entries.set(id,entry);
  }
  const held=entry;
  held.refs++;
  // Evict only after the new lease is counted, so a fresh document is never
  // mistaken for an idle one.
  this.evict();
  return held.promise.then(doc=>{
   let released=false;
   return {doc,release:()=>{if(released)return;released=true;held.refs--;if(held.refs<=0&&held.dead)this.destroyEntry(held);else this.evict();}};
  },error=>{held.refs--;if(held.refs<=0&&held.dead)this.destroyEntry(held);else this.evict();throw error;});
 }
 /** Drops one file (or all files without a path). A document with live leases
  * is destroyed when the last one is returned. */
 invalidate(path?:string):void{
  for(const [id,entry] of [...this.entries]){
   if(path!==undefined&&!id.startsWith(path+'\u0000'))continue;
   entry.dead=true;this.entries.delete(id);
   if(entry.refs<=0)this.destroyEntry(entry);
  }
 }
 destroyAll():void{this.invalidate();}
 private evict():void{
  const total=()=>{let sum=0;for(const item of this.entries.values())sum+=item.bytes;return sum;};
  while(this.entries.size>this.capacity||total()>this.maxBytes){
   const idle=[...this.entries].find(([,item])=>item.refs<=0);
   if(!idle)return; // every document is in use; a live read is never evicted
   const [id,entry]=idle;
   entry.dead=true;this.entries.delete(id);this.destroyEntry(entry);
  }
 }
 private destroyEntry(entry:PdfCacheEntry):void{
  entry.dead=true;
  const target=entry.doc??entry.loading;
  entry.doc=null;entry.loading=null;
  if(target)void target.destroy().catch(()=>{/* already destroyed */});
 }
}
