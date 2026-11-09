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
 onScan?:(page:PdfPage,number:number)=>Promise<void>,signal?:AbortSignal
):Promise<string>{
 const start=pdfPageNumber(String(range.page??1),doc.numPages);
 const end=pdfPageNumber(String(range.endPage??(range.page===undefined?doc.numPages:start)),doc.numPages);
 const offset=range.offset??0;
 if(end<start||!Number.isSafeInteger(offset)||offset<0)throw Error('Use an ascending PDF page range and a nonnegative text offset.');
 const budget=64_000;
 let text=source+' · '+doc.numPages+' pages in total.\n';
 for(let number=start;number<=end;number++){
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
   if(!extracted){
    if(body.length>remaining)return text+continuation(source,number,end,0);
    await onScan?.(page,number);
   }
   text+=label+body.slice(begin,begin+remaining);
   if(begin+remaining<body.length)return text+continuation(source,number,end,begin+remaining);
  }finally{page.cleanup();}
 }
 return text;
}

function continuation(path:string,page:number,endPage:number,offset:number):string{
 return '\n[More PDF text is available. Continue with read_pdf '+JSON.stringify({path,page,endPage,...(offset?{offset}:{})})+']';
}
