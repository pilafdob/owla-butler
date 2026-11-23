import {pdfSource,pdfPageReference,type PdfDocumentKey} from './pdf';

/** The most page images one PDF selection may attach as background context. */
export const PDF_SELECTION_MAX_PAGES=2;
/** Rendered page images kept between sends; each is a data URL, so the count stays small. */
export const PDF_SELECTION_IMAGE_CACHE_MAX=8;

/** A text selection carried by a draft. `pdf` marks text highlighted inside a
 *  PDF viewer page: `page` is the cited first page, `pages` every page the
 *  selection spans (uncapped; the image cap is applied at send time). */
export interface SelectionItem{path:string;text:string;pdf?:{page:number;pages?:number[]};}

/** One page of one PDF that should be rendered as hidden background context. */
export interface PdfSelectionPage{path:string;page:number;}

function excerpt(text:string,max=60):string{
 const one=text.replace(/\s+/g,' ').trim();
 return one.length<=max?one:one.slice(0,max).trimEnd()+'…';
}

/** The draft chip and sent-card label: `Name.pdf · p. 4 · "first words…"`. */
export function pdfSelectionChipLabel(path:string,page:number,text:string):string{
 const name=path.split('/').pop()||path;
 const quote=excerpt(text);
 return name+' · p. '+page+(quote?' · "'+quote+'"':'');
}

/** Says when a selection crosses pages and how many page images may come with it. */
export function pdfSelectionSpanNote(pages:readonly number[]):string{
 const last=pages[pages.length-1]??pages[0];
 return 'The selection spans PDF pages '+(pages[0]??last)+' to '+last+'. Page images for at most the first '+PDF_SELECTION_MAX_PAGES+' of them are attached as background context for models that read images.';
}

/** The turn-context block for one selection. PDF selections cite the page via
 *  pdfSource and a clickable pdfPageReference and say so when they span pages;
 *  plain selections keep the exact legacy shape, which the context-window trim
 *  depends on. Must stay a pure function of the item: trimSelectionsForWindow
 *  rebuilds the identical section from the trimmed items. */
export function selectionContextBlock(item:SelectionItem):string{
 if(!item.pdf)return '\nSELECTED TEXT from '+item.path+'\n'+item.text;
 const pages=item.pdf.pages?.length?item.pdf.pages:[item.pdf.page];
 const citation=pdfSource(item.path,item.pdf.page)+' · '+pdfPageReference(item.path,item.pdf.page);
 return '\nSELECTED TEXT from '+citation+'\n'+item.text+(pages.length>1?'\n'+pdfSelectionSpanNote(pages):'');
}

/** The instruction line sent with the page image(s) of a PDF selection. */
export const PDF_SELECTION_IMAGE_NOTE='The selected PDF text comes from the PDF text layer and may be misread. Page images of the selection are attached to this message: compare them with the quoted text and prefer the image when they disagree.';
/** The same warning for a route that cannot read images. */
export const PDF_SELECTION_TEXT_ONLY_NOTE='The selected PDF text comes from the PDF text layer and may be misread; it is quoted verbatim. No page image is attached for this reply.';

/** Swaps the page-image instruction for the text-only wording on a route that cannot read images. */
export function pdfSelectionTextOnlyContext(context:string):string{
 return context.split(PDF_SELECTION_IMAGE_NOTE).join(PDF_SELECTION_TEXT_ONLY_NOTE);
}

/** Every page a PDF selection should render, deduplicated across selections and
 *  capped per selection. Falls back to the cited page when the span was not
 *  recorded (the context menu knows only the page under the cursor). */
export function pdfSelectionRenderPages(selections:readonly SelectionItem[]):PdfSelectionPage[]{
 const targets:PdfSelectionPage[]=[],seen=new Set<string>();
 for(const item of selections){
  if(!item.pdf)continue;
  const pages=(item.pdf.pages?.length?item.pdf.pages:[item.pdf.page]).slice(0,PDF_SELECTION_MAX_PAGES);
  for(const page of pages){
   const id=item.path+'\u0000'+page;
   if(seen.has(id))continue;
   seen.add(id);targets.push({path:item.path,page});
  }
 }
 return targets;
}

/** Cache key for a rendered selection page: a changed size or mtime misses, so
 *  an edited or replaced PDF re-renders while repeated sends do not. */
export function pdfSelectionCacheKey(key:PdfDocumentKey,page:number):string{
 return key.path+'\u0000'+key.size+'\u0000'+key.mtime+'\u0000'+page;
}

/**
 * One attempt's images and context: a model that reads images gets the PDF
 * selection's page images with the image wording; a text-only model (or an
 * unknown modality list that excludes images) gets the text-only context and
 * none of the page images. The user's own images are passed through unchanged.
 */
export function pdfSelectionAttempt(model:{inputModalities?:readonly string[]}|undefined,inputImages:readonly string[],pageImages:readonly string[],context:string,textOnlyContext:string):{images:string[];context:string}{
 if(!pageImages.length)return {images:[...inputImages],context};
 const readsImages=!model?.inputModalities||model.inputModalities.includes('image');
 return readsImages?{images:[...inputImages,...pageImages],context}:{images:[...inputImages],context:textOnlyContext};
}
