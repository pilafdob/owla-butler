import {PDFDocument,PDFName,PDFHexString} from 'pdf-lib';
export interface PdfComment {page:number;text:string;}
export function pdfLink(value:string):{path:string;page?:number} {
 const link=value.trim().replace(/^\[\[|\]\]$/g,'').split('|')[0];
 const [path,fragment]=link.split('#');
 if(!path.toLowerCase().endsWith('.pdf'))throw Error('Choose a PDF file.');
 const match=fragment?.match(/^page=(\d+)$/);
 if(fragment&&!match)throw Error('Use #page= followed by a page number.');
 const page=match?Number(match[1]):undefined;
 if(page!==undefined&&(!Number.isSafeInteger(page)||page<1))throw Error('Choose a positive page number.');
 return {path,page};
}
export async function validatePdfComments(data:Uint8Array,comments:PdfComment[]):Promise<void> {
 const doc=await PDFDocument.load(data);
 checkComments(doc.getPageCount(),comments);
}
function checkComments(pages:number,comments:PdfComment[]) {
 if(!comments.length||comments.length>100)throw Error('Choose from 1 to 100 comments.');
 for(const comment of comments)if(!Number.isInteger(comment.page)||comment.page<1||comment.page>pages||!comment.text.trim()||comment.text.length>4000)throw Error('Invalid PDF comment or page.');
}
export async function annotatePdf(data:Uint8Array,comments:PdfComment[]):Promise<Uint8Array> {
 const doc=await PDFDocument.load(data);
 checkComments(doc.getPageCount(),comments);
 const counts=new Map<number,number>();
 for(const comment of comments){
  const count=counts.get(comment.page)??0;counts.set(comment.page,count+1);
  const page=doc.getPage(comment.page-1);
  const {height,width}=page.getSize();
  const x=Math.min(Math.max(0,width-24),20+(count%10)*26),y=Math.max(24,height-20-Math.floor(count/10)*26);
  const annotation=doc.context.obj({
   Type:PDFName.of('Annot'),Subtype:PDFName.of('Text'),Rect:[x,y-24,x+24,y],
   Contents:PDFHexString.fromText(comment.text),T:PDFHexString.fromText('OWLA'),
   Name:PDFName.of('Comment'),C:[1,0.85,0.2],Open:false,F:4,P:page.ref
  });
  page.node.addAnnot(doc.context.register(annotation));
 }
 return doc.save();
}
