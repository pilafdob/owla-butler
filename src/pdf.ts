/** Extract text while retaining PDF.js line boundaries. Geometry/columns still require visual review. */
export function pdfPageText(items:any[]):string{
 let text='',previousY:number|undefined;
 for(const item of items){if(typeof item.str!=='string')continue;const y=item.transform?.[5];
 if(previousY!==undefined&&typeof y==='number'&&Math.abs(y-previousY)>3&&!text.endsWith('\n'))text+='\n';
 text+=item.str+(item.hasEOL?'\n':' ');if(typeof y==='number')previousY=y;
 }return text.replace(/[ \t]+\n/g,'\n').trim();
}
export function pdfPageNumber(value:string,total:number):number{if(!/^\d+$/.test(value))throw Error('Enter a page number.');const page=Number(value);if(page<1||page>total)throw Error(`Choose a page from 1 to ${total}.`);return page;}
export function pdfSource(name:string,page:number):string{return name.replace(/[\r\n\x00-\x1f]/g,' ')+', p. '+page;}

export function markdownSource(value:string):string{return value.replace(/([\\`*_[\]<>])/g,'\\$1');}
