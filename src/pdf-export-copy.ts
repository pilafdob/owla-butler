// The temporary export copy for export_pdf (3.8.0-dev.4).
//
// OWLA no longer asks for page breaks in the user's note to make a PDF look
// right. It prints a temporary copy instead, written next to the note so links
// and embeds resolve exactly as in the original, and deletes it afterwards.
// The copy may differ from the note only in print layout:
//  - images are sized to fit inside the page border (width and height);
//  - the file-name title becomes the copy's own first heading (the copy's file
//    name is not the note's), and is not repeated when the note already starts
//    with that title;
//  - page breaks go before stranded headings and split tables or code blocks,
//    and before any heading the assistant names.
// Pure functions only: main.ts reads the images and writes the copy.
import {LINE_PX,applyLayoutFixes,detectLayoutIssues,estimateLayout,headingPlainText,insertPageBreaks,markdownBlocks,opaqueLines,pageBreakLines,pageContentBox,pageGeometry,type LayoutIssue,type PdfExportOptions} from './pdf-export';

export type ImageSize={width:number;height:number};

const IMAGE_FILE=/\.(?:png|jpe?g|gif|webp|bmp|avif|svg)$/i;

/** Pixel size from an image file's header: PNG, JPEG (with EXIF rotation), GIF, WebP and BMP. Anything else is null. */
export function imageDimensions(bytes:Uint8Array):ImageSize|null{
 const b=bytes,n=b.length;
 const be16=(i:number)=>(b[i]<<8)|b[i+1],le16=(i:number)=>b[i]|(b[i+1]<<8);
 const be32=(i:number)=>((b[i]<<24)>>>0)+(b[i+1]<<16)+(b[i+2]<<8)+b[i+3];
 const le24=(i:number)=>b[i]|(b[i+1]<<8)|(b[i+2]<<16);
 const ok=(size:ImageSize|null)=>size&&size.width>0&&size.height>0&&size.width<100_000&&size.height<100_000?size:null;
 if(n>=24&&b[0]===0x89&&b[1]===0x50&&b[2]===0x4e&&b[3]===0x47)return ok({width:be32(16),height:be32(20)});
 if(n>=10&&b[0]===0x47&&b[1]===0x49&&b[2]===0x46)return ok({width:le16(6),height:le16(8)});
 if(n>=26&&b[0]===0x42&&b[1]===0x4d){const h=b[22]|(b[23]<<8)|(b[24]<<16)|(b[25]<<24);return ok({width:b[18]|(b[19]<<8)|(b[20]<<16)|(b[21]<<24),height:Math.abs(h)});}
 if(n>=30&&String.fromCharCode(...b.subarray(0,4))==='RIFF'&&String.fromCharCode(...b.subarray(8,12))==='WEBP'){
  const chunk=String.fromCharCode(...b.subarray(12,16));
  if(chunk==='VP8 ')return ok({width:le16(26)&0x3fff,height:le16(28)&0x3fff});
  if(chunk==='VP8L')return ok({width:1+(((b[22]&0x3f)<<8)|b[21]),height:1+(((b[24]&0x0f)<<10)|(b[23]<<2)|((b[22]&0xc0)>>6))});
  if(chunk==='VP8X')return ok({width:1+le24(24),height:1+le24(27)});
  return null;
 }
 if(n>=4&&b[0]===0xff&&b[1]===0xd8){
  let i=2,rotated=false;
  while(i+9<n){
   if(b[i]!==0xff){i++;continue;}
   const marker=b[i+1];
   if(marker===0xff){i++;continue;}
   if(marker===0xd8||marker===0x01||(marker>=0xd0&&marker<=0xd7)){i+=2;continue;}
   const length=be16(i+2);
   if(length<2)return null;
   // APP1 Exif: orientations 5–8 turn the picture by 90°, and Chromium honours them.
   if(marker===0xe1&&String.fromCharCode(...b.subarray(i+4,i+8))==='Exif')rotated=exifRotated(b.subarray(i+10,Math.min(n,i+2+length)));
   if(marker>=0xc0&&marker<=0xcf&&marker!==0xc4&&marker!==0xc8&&marker!==0xcc){
    const size={width:be16(i+7),height:be16(i+5)};
    return ok(rotated?{width:size.height,height:size.width}:size);
   }
   i+=2+length;
  }
 }
 return null;
}
function exifRotated(tiff:Uint8Array):boolean{
 if(tiff.length<8)return false;
 const little=tiff[0]===0x49;
 const u16=(i:number)=>little?tiff[i]|(tiff[i+1]<<8):(tiff[i]<<8)|tiff[i+1];
 const u32=(i:number)=>little?(tiff[i]|(tiff[i+1]<<8)|(tiff[i+2]<<16))+tiff[i+3]*0x1000000:tiff[i]*0x1000000+((tiff[i+1]<<16)|(tiff[i+2]<<8)|tiff[i+3]);
 const ifd=u32(4);
 if(ifd+2>tiff.length)return false;
 const count=u16(ifd);
 for(let k=0;k<count;k++){
  const entry=ifd+2+k*12;
  if(entry+12>tiff.length)return false;
  if(u16(entry)===0x0112){const value=u16(entry+8);return value>=5&&value<=8;}
 }
 return false;
}

/** An image embed on one line, as written: the whole match, its target, and its size suffix if any. */
type Embed={start:number;end:number;target:string;width?:number;height?:number;rewrite:(width:number)=>string};

const WIKI_EMBED=/!\[\[([^\]]+?)\]\]/g;
const MD_IMAGE=/!\[([^\]]*)\]\(([^)\s]+|<[^>]+>)((?:\s+"[^"]*")?)\)/g;
const SIZE=/^\s*(\d+)(?:\s*x\s*(\d+))?\s*$/;

/** The image embeds on a line. In a table row the size pipe is escaped (\|), as Obsidian requires there. */
export function imageEmbeds(line:string,inTable=false):Embed[]{
 const out:Embed[]=[],pipe=inTable?'\\|':'|';
 for(const m of line.matchAll(WIKI_EMBED)){
  const inner=m[1],split=/\\?\|/.exec(inner);
  const target=(split?inner.slice(0,split.index):inner).trim(),alias=split?inner.slice(split.index+split[0].length):'';
  if(!IMAGE_FILE.test(target.replace(/#.*$/,'')))continue;
  const size=SIZE.exec(alias);
  // A caption alias (![[a.png|Figure 1]]) is left alone: adding a size would replace it.
  if(alias&&!size)continue;
  out.push({start:m.index,end:m.index+m[0].length,target:target.replace(/#.*$/,''),width:size?Number(size[1]):undefined,height:size?.[2]?Number(size[2]):undefined,
   rewrite:width=>'![['+target+pipe+width+']]'});
 }
 for(const m of line.matchAll(MD_IMAGE)){
  const rawTarget=m[2].replace(/^<|>$/g,'');
  let target=rawTarget;try{target=decodeURI(rawTarget);}catch{/* Keep the written form. */}
  if(/^[a-z][a-z0-9+.-]*:/i.test(target)||!IMAGE_FILE.test(target.replace(/[?#].*$/,'')))continue;
  const split=/\\?\|/.exec(m[1]),altText=split?m[1].slice(0,split.index):m[1],alias=split?m[1].slice(split.index+split[0].length):'';
  const size=SIZE.exec(alias);
  if(alias&&!size)continue;
  out.push({start:m.index,end:m.index+m[0].length,target:target.replace(/[?#].*$/,''),width:size?Number(size[1]):undefined,height:size?.[2]?Number(size[2]):undefined,
   rewrite:width=>'!['+altText+pipe+width+']('+m[2]+m[3]+')'});
 }
 return out.sort((a,b)=>a.start-b.start);
}

export type FittedImage={line:number;target:string;from:number|undefined;to:number;height:number};

/**
 * Sizes every image embed (outside code, math and frontmatter) so it fits the
 * page's content box in width and height. Only images that would be larger are
 * rewritten, to an explicit width that keeps the aspect ratio; a small image is
 * never enlarged. An image whose pixel size is unknown (not in the vault, an
 * SVG, a web link) is shrunk only when its written width is too wide.
 * maxHeight lets the caller cap one line's image further (the first image under
 * a title). heights reports the rendered height (CSS px) of each sized image
 * by line, for the layout estimate.
 */
export function fitImages(text:string,box:ImageSize,sizeOf:(target:string)=>ImageSize|null,maxHeight?:(line:number)=>number|undefined):{text:string;fitted:FittedImage[];heights:Map<number,number>}{
 const lines=text.split('\n'),opaque=opaqueLines(text),fitted:FittedImage[]=[],heights=new Map<number,number>();
 const tables=new Set<number>();
 for(const block of markdownBlocks(text))if(block.kind==='table')for(let l=block.line;l<=block.endLine;l++)tables.add(l);
 lines.forEach((line,index)=>{
  if(opaque.has(index)||!line.includes('!['))return;
  const embeds=imageEmbeds(line,tables.has(index));
  if(!embeds.length)return;
  let rebuilt='',cursor=0;
  for(const embed of embeds){
   const natural=sizeOf(embed.target);
   const shown=embed.width??natural?.width;
   const aspect=natural?natural.height/natural.width:embed.width&&embed.height?embed.height/embed.width:undefined;
   if(shown===undefined)continue;
   const cap=Math.min(box.height,maxHeight?.(index)??Infinity);
   const limit=Math.floor(Math.min(box.width,aspect?cap/aspect:Infinity));
   const height=aspect?Math.round(Math.min(shown,limit)*aspect):undefined;
   if(height!==undefined&&embeds.length===1&&line.trim()===line.slice(embed.start,embed.end).trim())heights.set(index,height);
   // An explicit "WxH" size is rewritten to width only even when it fits, so the
   // height cannot distort the picture once the width is capped.
   if(shown<=limit&&embed.height===undefined)continue;
   const to=Math.max(16,Math.min(shown,limit));
   if(to===embed.width&&embed.height===undefined)continue;
   rebuilt+=line.slice(cursor,embed.start)+embed.rewrite(to);cursor=embed.end;
   fitted.push({line:index,target:embed.target,from:embed.width,to,height:height??0});
  }
  if(cursor)lines[index]=rebuilt+line.slice(cursor);
 });
 return {text:lines.join('\n'),fitted,heights};
}

export type ExportCopyInput={
 /** The note's Markdown, with \n line ends (as read from the editor). */
 text:string;
 /** The note's file name without .md: the title Obsidian prints with includeName. */
 basename:string;
 options:PdfExportOptions;
 /** Extra headings the assistant wants on a new page. */
 breaksBefore?:string[];
 sizeOf:(target:string)=>ImageSize|null;
};
export type ExportCopy={
 text:string;
 /** Print options for the copy: includeName is always off (the copy's own file name is not the title). */
 options:PdfExportOptions;
 /** The title as printed, when the PDF has one, for the read-back. */
 title?:string;
 changes:string[];
 /** Estimated problems the copy could not fix. */
 remaining:LayoutIssue[];
 unknownHeadings:string[];
 imageHeights:Map<number,number>;
};

const plain=(s:string)=>headingPlainText(s).normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();

/** Builds the export copy's text and options. The note itself is never touched. */
export function prepareExportCopy(input:ExportCopyInput):ExportCopy{
 const changes:string[]=[];
 let text=input.text.replace(/\r\n?/g,'\n'),title:string|undefined;
 const options:PdfExportOptions={...input.options,includeName:false};
 // The title. Obsidian prints the file name above the note when includeName is
 // on; the copy has another file name, so the title is written into it.
 if(input.options.includeName){
  const blocks=markdownBlocks(text),first=blocks.find(block=>block.kind!=='frontmatter');
  title=input.basename;
  if(first?.kind==='heading'&&first.level===1&&plain(first.title??'')===plain(input.basename))changes.push('kept the note’s own first heading as the title instead of printing the file name above it a second time');
  else{
   const fm=blocks.find(block=>block.kind==='frontmatter');
   const lines=text.split('\n'),at=fm?fm.endLine+1:0;
   lines.splice(at,0,'# '+input.basename,'');
   text=lines.join('\n');
  }
 }else{
  const first=markdownBlocks(text).find(block=>block.kind!=='frontmatter');
  if(first?.kind==='heading'&&first.level===1)title=first.title;
 }
 // Images: inside the page border.
 const box=pageContentBox(options);
 let fit=fitImages(text,box,input.sizeOf);
 text=fit.text;
 const resized=new Set(fit.fitted.map(item=>item.line));
 // A title alone on page 1 because the first image is too tall for the room
 // under it: shrink that image to the room when that keeps at least ~40 % of a page.
 const layout=estimateLayout(text,{...options,imageHeights:fit.heights});
 const content=layout.filter(block=>block.kind!=='break'&&block.kind!=='frontmatter');
 let k=0;while(k<content.length&&content[k].kind==='heading')k++;
 const lead=content[k];
 if(k>0&&lead?.kind==='image'&&lead.page>1&&fit.heights.has(lead.line)){
  // Room left under the heading run on page 1, less the image block's own margin.
  const room=Math.floor((pageGeometry(options).linesPerPage-content[k-1].bottom-1)*LINE_PX);
  if(room>=box.height*.4){
   const capped=fitImages(text,box,input.sizeOf,line=>line===lead.line?room:undefined);
   if(capped.fitted.some(item=>item.line===lead.line)){fit={...capped,fitted:[...fit.fitted.filter(item=>item.line!==lead.line),...capped.fitted.filter(item=>item.line===lead.line)]};text=capped.text;resized.add(lead.line);changes.push('made the first image smaller so it fits on page 1 under the title');}
  }
 }
 if(resized.size)changes.push('sized '+resized.size+' image'+(resized.size===1?'':'s')+' to fit inside the page');
 // Page breaks: the assistant's headings, then every fixable estimated problem.
 const requested=pageBreakLines(text,input.breaksBefore??[]);
 let breaks=0;
 if(requested.lines.length){const result=insertPageBreaks(text,requested.lines);text=result.text;breaks+=result.inserted.length;fit=shiftHeights(fit,result.inserted);}
 const issues=detectLayoutIssues(text,{...options,title,imageHeights:fit.heights});
 const fixed=applyLayoutFixes(text,issues);
 if(fixed.inserted.length){text=fixed.text;breaks+=fixed.inserted.length;fit=shiftHeights(fit,fixed.inserted);}
 if(breaks)changes.push('added '+breaks+' page break'+(breaks===1?'':'s')+' (before stranded headings, split tables or code blocks'+(requested.lines.length?', and the headings asked for':'')+')');
 const remaining=detectLayoutIssues(text,{...options,title,imageHeights:fit.heights});
 return {text,options,title,changes,remaining,unknownHeadings:requested.unknown,imageHeights:fit.heights};
}

/** Each inserted break adds two lines before its line; move the known image heights with their lines. */
function shiftHeights<T extends {heights:Map<number,number>}>(fit:T,inserted:number[]):T{
 const sorted=[...inserted].sort((a,b)=>a-b),heights=new Map<number,number>();
 for(const [line,height] of fit.heights)heights.set(line+2*sorted.filter(at=>at<=line).length,height);
 return {...fit,heights};
}
