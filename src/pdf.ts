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
// used by the page picker; no second PDF.js bundle is needed.
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
