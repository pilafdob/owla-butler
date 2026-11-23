// Pure helpers for export_pdf (handoff 3.8.0 #5). No Obsidian or Electron imports:
// the main-process side (which runs Obsidian's own exporter) lives in main.ts.
//
// Layout heuristic, stated honestly: real pagination is known only after
// Chromium renders the print view. estimateLayout() approximates pages from the
// Markdown block structure (line counts × a per-block height); it is a cheap
// first pass. The authoritative check is pdfLayoutIssues(), which reads the
// exported PDF's text per page and finds headings that really ended up stranded.
import {frontmatterBlock} from './note-tools';

export const PDF_PAGE_SIZES=['A3','A4','A5','Legal','Letter','Tabloid'] as const;
export type PdfPageSize=typeof PDF_PAGE_SIZES[number];
export type PdfMargin='default'|'minimal'|'none';
/** Fix rounds after the first export (handoff: max 2). */
export const PDF_FIX_ROUNDS=2;

export type PdfExportInput={pageSize?:unknown;landscape?:unknown;margin?:unknown;downscalePercent?:unknown;includeName?:unknown;open?:unknown};
export type PdfExportOptions={pageSize:PdfPageSize;landscape:boolean;margin:PdfMargin;downscalePercent:number;includeName:boolean;open:boolean};
/** Shape of the options object Obsidian's exporter passes to Electron printToPDF (Obsidian 1.14–1.15 desktop). */
export type ObsidianPrintOptions={includeName:boolean;pageSize:PdfPageSize;landscape:boolean;marginsType:number;margins?:{top:number;left:number;bottom:number;right:number};scaleFactor:number;scale:number;open:boolean;filepath:string};

/** Obsidian's saved dialog settings (vault config pdfExportSettings) use margin "0"/"1"/"2". */
const MARGIN_TYPE:Record<PdfMargin,number>={default:0,none:1,minimal:2};

/** Validate model-supplied options; unknown keys are ignored, bad values throw a message the model can act on. */
export function pdfExportOptions(input:PdfExportInput={},saved?:{pageSize?:unknown;landscape?:unknown;margin?:unknown;downscalePercent?:unknown;includeName?:unknown}):PdfExportOptions{
 const pick=<T>(value:unknown,fallback:T)=>value===undefined||value===null?fallback:value;
 const savedMargin=saved?.margin==='1'?'none':saved?.margin==='2'?'minimal':'default';
 const pageSize=pick(input.pageSize,PDF_PAGE_SIZES.includes(saved?.pageSize as PdfPageSize)?saved?.pageSize:'Letter');
 const size=PDF_PAGE_SIZES.find(name=>typeof pageSize==='string'&&name.toLowerCase()===pageSize.toLowerCase());
 if(!size)throw Error('pageSize must be one of '+PDF_PAGE_SIZES.join(', ')+'.');
 const margin=pick(input.margin,savedMargin);
 if(margin!=='default'&&margin!=='minimal'&&margin!=='none')throw Error('margin must be default, minimal or none.');
 const downscale=pick(input.downscalePercent,typeof saved?.downscalePercent==='number'?saved.downscalePercent:100);
 if(typeof downscale!=='number'||!Number.isInteger(downscale)||downscale<10||downscale>100)throw Error('downscalePercent must be an integer from 10 to 100.');
 const bool=(name:string,value:unknown,fallback:boolean)=>{const v=pick(value,fallback);if(typeof v!=='boolean')throw Error(name+' must be true or false.');return v;};
 return {pageSize:size,margin,downscalePercent:downscale,
  landscape:bool('landscape',input.landscape,saved?.landscape===true),
  includeName:bool('includeName',input.includeName,saved?.includeName===true),
  open:bool('open',input.open,false)};
}

/** Mirror of the option object Obsidian's own export dialog builds before printing. */
export function obsidianPrintOptions(options:PdfExportOptions,filepath:string):ObsidianPrintOptions{
 const marginsType=MARGIN_TYPE[options.margin];
 return {includeName:options.includeName,pageSize:options.pageSize,landscape:options.landscape,marginsType,
  ...(marginsType===1||marginsType===2?{margins:{top:0,left:0,bottom:0,right:0}}:{}),
  scaleFactor:options.downscalePercent,scale:Math.min(2,Math.max(.1,options.downscalePercent/100)),open:options.open,filepath};
}

/** Default output next to the note: "Folder/Note.pdf", then "Note 1.pdf", "Note 2.pdf" … Never returns an existing path. */
export function pdfOutputPath(notePath:string,exists:(path:string)=>boolean,requested?:string):string{
 const clean=(requested??notePath.replace(/\.md$/i,'')).replace(/\\/g,'/').replace(/^\/+/,'');
 if(!clean||clean.split('/').some(part=>part==='..'||part==='.'))throw Error('Use a vault-relative output path.');
 const base=clean.replace(/\.pdf$/i,'');
 if(!base||base.endsWith('/'))throw Error('Use a vault-relative output path.');
 for(let n=0;n<1000;n++){const candidate=base+(n?' '+n:'')+'.pdf';if(!exists(candidate))return candidate;}
 throw Error('Too many PDFs with this name already exist.');
}

// ── Markdown block structure ────────────────────────────────────────────────

export type BlockKind='frontmatter'|'heading'|'paragraph'|'list'|'quote'|'table'|'code'|'math'|'image'|'rule'|'break'|'html';
export type Block={kind:BlockKind;line:number;endLine:number;level?:number;title?:string;text:string};

/** Marker OWLA inserts; the class lets OWLA find and remove only its own breaks. */
export const OWLA_PAGE_BREAK='<div class="owla-page-break" style="page-break-before: always"></div>';
const OWLA_BREAK_LINE=/^<div class="owla-page-break" style="page-break-before: always"><\/div>\r?$/;
/** Any common page-break marker, ours or hand-written, so detection does not stack breaks. */
const ANY_BREAK=/^\s*<div\b[^>]*\b(?:page-break-(?:before|after)|break-(?:before|after))\s*:\s*(?:always|page)\b[^>]*>\s*<\/div>\s*$/i;
const FENCE=/^ {0,3}(`{3,}|~{3,})/;
const HEADING=/^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*(?:[ \t]#+[ \t]*)?$/;
const IMAGE=/^\s*!(?:\[\[[^\]]+\]\]|\[[^\]]*\]\([^)]*\))\s*$/;

const eol=(text:string)=>text.includes('\r\n')?'\r\n':'\n';
const linesOf=(text:string)=>text.split(/\r?\n/);

/** Split a note into top-level blocks by line. Fenced code and $$ math are opaque. */
export function markdownBlocks(text:string):Block[]{
 const lines=linesOf(text),blocks:Block[]=[];
 const fm=frontmatterBlock(text);let i=0;
 if(fm){const n=linesOf(fm.replace(/\r?\n$/,'')).length;blocks.push({kind:'frontmatter',line:0,endLine:n-1,text:lines.slice(0,n).join('\n')});i=n;}
 const push=(kind:BlockKind,start:number,end:number,extra:Partial<Block>={})=>blocks.push({kind,line:start,endLine:end,text:lines.slice(start,end+1).join('\n'),...extra});
 while(i<lines.length){
  const line=lines[i];
  if(!line.trim()){i++;continue;}
  const fence=line.match(FENCE)?.[1];
  if(fence){let j=i+1;while(j<lines.length){const m=lines[j].match(FENCE)?.[1];if(m&&m[0]===fence[0]&&m.length>=fence.length)break;j++;}push('code',i,Math.min(j,lines.length-1));i=j+1;continue;}
  if(/^\s*\$\$/.test(line)){let j=i;if(!/\$\$.*\$\$\s*$/.test(line.trim().slice(2))||line.trim()==='$$'){j=i+1;while(j<lines.length&&!/\$\$\s*$/.test(lines[j]))j++;}push('math',i,Math.min(j,lines.length-1));i=j+1;continue;}
  const heading=line.match(HEADING);
  if(heading){push('heading',i,i,{level:heading[1].length,title:heading[2].trim()});i++;continue;}
  if(ANY_BREAK.test(line)){push('break',i,i);i++;continue;}
  if(/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)){push('rule',i,i);i++;continue;}
  if(IMAGE.test(line)){push('image',i,i);i++;continue;}
  const group=(kind:BlockKind,test:(l:string)=>boolean)=>{let j=i;while(j+1<lines.length&&lines[j+1].trim()&&test(lines[j+1]))j++;push(kind,i,j);i=j+1;};
  if(/^\s*\|/.test(line)&&i+1<lines.length&&/^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(lines[i+1])){group('table',l=>/\|/.test(l));continue;}
  if(/^\s*>/.test(line)){group('quote',l=>/^\s*>/.test(l));continue;}
  if(/^\s*(?:[-*+]|\d+[.)])\s/.test(line)){group('list',l=>/^\s*(?:[-*+]|\d+[.)])\s/.test(l)||/^\s{2,}\S/.test(l));continue;}
  if(/^\s*<[a-z]/i.test(line)){group('html',()=>true);continue;}
  group('paragraph',l=>!HEADING.test(l)&&!FENCE.test(l)&&!/^\s*(?:>|\||(?:[-*+]|\d+[.)])\s)/.test(l)&&!IMAGE.test(l)&&!ANY_BREAK.test(l));
 }
 return blocks;
}

// ── Page estimate ───────────────────────────────────────────────────────────

/** Paper size in CSS px (96 dpi), portrait. */
const PAPER:Record<PdfPageSize,[number,number]>={A3:[1123,1587],A4:[794,1123],A5:[559,794],Legal:[816,1344],Letter:[816,1056],Tabloid:[1056,1632]};
/** Chromium printToPDF margins in px: default ≈ 0.4 in on every side; minimal/none are 0 in Obsidian's call. */
const MARGIN_PX:Record<PdfMargin,number>={default:38,minimal:0,none:0};
/** Assumed body line (16 px font × 1.5) and average glyph width. Images without a size are assumed ~300 px tall. */
const LINE_PX=24,CHAR_PX=8,IMAGE_PX=300;
const HEADING_LINES=[0,2.6,2.2,1.9,1.6,1.4,1.3];

export type PageGeometry={linesPerPage:number;charsPerLine:number};
export function pageGeometry(options:Pick<PdfExportOptions,'pageSize'|'landscape'|'margin'|'downscalePercent'>):PageGeometry{
 const [w,h]=PAPER[options.pageSize],[width,height]=options.landscape?[h,w]:[w,h];
 const scale=options.downscalePercent/100,m=MARGIN_PX[options.margin]*2;
 // Obsidian's print view also pads content; ~5 % of the width is lost to it.
 return {linesPerPage:Math.max(5,Math.floor((height-m)/(LINE_PX*scale))),charsPerLine:Math.max(20,Math.floor((width-m)*.95/(CHAR_PX*scale)))};
}

/** Height of a block in body lines (estimate). Blocks are separated by ~0.6 line of margin. */
export function blockLines(block:Block,geometry:PageGeometry):number{
 const wrap=(s:string)=>Math.max(1,Math.ceil(s.length/geometry.charsPerLine));
 const rows=block.text.split('\n');
 switch(block.kind){
  case 'frontmatter':return 0; // shown as properties only when enabled; counted by the caller
  case 'heading':return HEADING_LINES[block.level??1];
  case 'image':{const size=block.text.match(/\|(\d+)(?:x(\d+))?\s*(?:\]\]|\])/);const px=size?.[2]?Number(size[2]):size?.[1]?Number(size[1])*.66:IMAGE_PX;return Math.max(2,px/LINE_PX)+.6;}
  case 'table':return Math.max(1,rows.length-1)*1.6+.6;
  case 'code':return rows.length*1.15+1.2;
  case 'math':return Math.max(2,rows.length*1.4)+.6;
  case 'rule':return 1.5;
  case 'break':return 0;
  default:return rows.reduce((sum,row)=>sum+wrap(row),0)+.6;
 }
}
/** Chromium never splits a heading line or an image; display math is treated the same. */
const unbreakable=(kind:BlockKind)=>kind==='image'||kind==='math'||kind==='heading';

export type PlacedBlock=Block&{page:number;top:number;bottom:number};
export type LayoutOptions=PdfExportOptions&{title?:string;propertiesLines?:number};

/** Assign estimated pages. Text, lists, tables and code may split; headings, images and display math move whole to the next page.
 *  top is the block's start offset (lines) on its first page; bottom its end offset on its last page. */
export function estimateLayout(text:string,options:LayoutOptions):PlacedBlock[]{
 const geometry=pageGeometry(options),per=geometry.linesPerPage,out:PlacedBlock[]=[];
 let page=1,used=options.includeName?HEADING_LINES[1]:0;
 for(const block of markdownBlocks(text)){
  if(block.kind==='frontmatter'){used+=options.propertiesLines??0;continue;}
  if(block.kind==='break'){if(used>0){page++;used=0;}out.push({...block,page,top:0,bottom:0});continue;}
  const h=blockLines(block,geometry);
  if(used>=per){page++;used=0;}
  if(unbreakable(block.kind)&&used>0&&used+h>per&&h<=per){page++;used=0;}
  const top=used,first=page;used+=h;
  while(used>per){used-=per;page++;}
  out.push({...block,page:first,top,bottom:used});
 }
 return out;
}

// ── Problems and fixes ──────────────────────────────────────────────────────

export type LayoutIssueKind='orphan-heading'|'title-alone'|'split-table'|'split-code';
export type LayoutIssue={kind:LayoutIssueKind;line:number;page:number;heading?:string;detail:string;fixLine?:number};

/** Heading needs this many lines of following content on the same page. */
const KEEP_WITH_NEXT=2;

/** Estimated problems. fixLine is where a page break would fix it (undefined when no Markdown fix exists:
 *  the run is already at the top of a page or starts the note, so a break would only add an empty page). */
export function detectLayoutIssues(text:string,options:LayoutOptions):LayoutIssue[]{
 const geometry=pageGeometry(options),per=geometry.linesPerPage,issues:LayoutIssue[]=[];
 const content=estimateLayout(text,options).filter(b=>b.kind!=='break');
 // Start of the run of headings directly above block k (a break goes before the whole run).
 const runStart=(k:number)=>{let first=k;while(first>0&&content[first-1].kind==='heading')first--;return first;};
 const fixAt=(first:number)=>first===0||content[first].top===0?undefined:content[first].line;
 if(options.includeName&&content[0]&&unbreakable(content[0].kind)&&content[0].page>1)
  issues.push({kind:'title-alone',line:content[0].line,page:1,heading:options.title,detail:'The file-name title stays alone on page 1 because the first image or formula does not fit below it. Turn off includeName or make the first image smaller.'});
 for(let k=0;k<content.length;k++){
  const block=content[k],next=content[k+1];
  if(block.kind==='heading'&&next){
   // A stacked heading on the same page is checked when the run's last heading is reached.
   const remaining=per-(block.top+blockLines(block,geometry));
   const nextFits=next.page===block.page&&(unbreakable(next.kind)||remaining>=KEEP_WITH_NEXT);
   if(!nextFits){
    const first=runStart(k),isTitle=first===0;
    issues.push({kind:isTitle?'title-alone':'orphan-heading',line:block.line,page:block.page,heading:block.title,
     detail:isTitle?'The title "'+block.title+'" stays alone on page '+block.page+'; its content starts on page '+(block.page+1)+'.':'Heading "'+block.title+'" is at the bottom of page '+block.page+'; its content starts on page '+(block.page+1)+'.',
     fixLine:fixAt(first)});
   }
  }
  if(block.kind==='table'||block.kind==='code'){
   const h=blockLines(block,geometry);
   if(block.top+h>per&&h<=per){
    issues.push({kind:block.kind==='table'?'split-table':'split-code',line:block.line,page:block.page,
     detail:'A '+(block.kind==='table'?'table':'code block')+' that fits on one page splits across pages '+block.page+'–'+(block.page+1)+'.',
     fixLine:fixAt(runStart(k))});
   }
  }
 }
 return dedupe(issues);
}
function dedupe(issues:LayoutIssue[]){const seen=new Set<string>();return issues.filter(i=>{const key=i.kind+':'+i.line;if(seen.has(key))return false;seen.add(key);return true;});}

/** Lines (0-based) inside fenced code or $$ math; never edited. */
function opaqueLines(text:string):Set<number>{
 const out=new Set<number>();for(const b of markdownBlocks(text))if(b.kind==='code'||b.kind==='math'||b.kind==='frontmatter')for(let l=b.line;l<=b.endLine;l++)out.add(l);return out;
}

/** Insert OWLA page breaks before the given 0-based lines. Idempotent; skips line 0, frontmatter, code/math and lines already preceded by a break. Keeps the note's line ending. */
export function insertPageBreaks(text:string,beforeLines:number[]):{text:string;inserted:number[]}{
 const nl=eol(text),lines=linesOf(text),opaque=opaqueLines(text),firstContent=markdownBlocks(text).find(b=>b.kind!=='frontmatter')?.line??0;
 const targets=[...new Set(beforeLines)].filter(l=>Number.isInteger(l)&&l>firstContent&&l<lines.length&&!opaque.has(l)&&lines[l].trim()).sort((a,b)=>b-a);
 const inserted:number[]=[];
 for(const l of targets){
  let p=l-1;while(p>=0&&!lines[p].trim())p--;
  if(p>=0&&ANY_BREAK.test(lines[p]))continue;
  lines.splice(l,0,OWLA_PAGE_BREAK,'');inserted.push(l);
 }
 return {text:lines.join(nl),inserted:inserted.reverse()};
}

/** Remove only OWLA's own break markers (and the blank line inserted after each). Hand-written breaks stay. */
export function removePageBreaks(text:string):{text:string;removed:number}{
 const nl=eol(text),lines=linesOf(text),opaque=opaqueLines(text),out:string[]=[];let removed=0;
 for(let i=0;i<lines.length;i++){
  if(!opaque.has(i)&&OWLA_BREAK_LINE.test(lines[i])){removed++;if(i+1<lines.length&&lines[i+1]==='')i++;continue;}
  out.push(lines[i]);
 }
 return {text:out.join(nl),removed};
}

/** One fix pass: break before every fixable issue. Returns the note unchanged when nothing is fixable. */
export function applyLayoutFixes(text:string,issues:LayoutIssue[]):{text:string;inserted:number[];unfixed:LayoutIssue[]}{
 const fixable=issues.filter(i=>i.fixLine!==undefined);
 const result=insertPageBreaks(text,fixable.map(i=>i.fixLine as number));
 return {...result,unfixed:issues.filter(i=>i.fixLine===undefined)};
}

// ── Verification from the exported PDF ──────────────────────────────────────

const norm=(s:string)=>s.normalize('NFKC').replace(/[*_`~=[\]#>]/g,'').replace(/\s+/g,' ').trim().toLowerCase();

/** Plain heading text as it appears in the PDF: strip wikilink/markdown syntax. */
export function headingPlainText(title:string):string{
 return title.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g,'$2').replace(/\[\[([^\]]+)\]\]/g,(_m,t:string)=>t.split('#').pop()??t).replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/<[^>]+>/g,'').replace(/[*_`~=]/g,'').trim();
}

export type PdfLayoutIssue={kind:'orphan-heading'|'title-alone';page:number;heading:string};

/** Real check on exported page texts (pdfPageText per page, in order). A heading is stranded when it is
 *  among the last non-empty lines of a page that is not the last and nothing follows it on that page. */
export function pdfLayoutIssues(pages:string[],headings:string[],title?:string):PdfLayoutIssue[]{
 const issues:PdfLayoutIssue[]=[],wanted=headings.map(h=>({raw:h,key:norm(headingPlainText(h))})).filter(h=>h.key);
 const titleKey=title?norm(title):'';
 pages.forEach((page,index)=>{
  if(index===pages.length-1)return;
  const lines=page.split('\n').map(norm).filter(Boolean);
  // Footer/header lines are not added by Obsidian's exporter, so the last line is real content.
  const last=lines[lines.length-1];if(!last)return;
  const match=wanted.find(h=>last===h.key||last.endsWith(h.key)&&last.length-h.key.length<=3);
  const onlyTitle=index===0&&titleKey&&lines.every(l=>l===titleKey||wanted.some(h=>h.key===l));
  if(onlyTitle)issues.push({kind:'title-alone',page:1,heading:title??lines[0]});
  else if(match)issues.push({kind:'orphan-heading',page:index+1,heading:match.raw});
 });
 return issues;
}

/** Map PDF findings back to note lines for the next fix round. */
export function issuesFromPdf(text:string,found:PdfLayoutIssue[]):LayoutIssue[]{
 const blocks=markdownBlocks(text),headingBlocks=blocks.filter(b=>b.kind==='heading'),firstContent=blocks.find(b=>b.kind!=='frontmatter');
 const out:LayoutIssue[]=[];
 for(const f of found){
  const key=norm(headingPlainText(f.heading));
  const block=headingBlocks.find(b=>norm(headingPlainText(b.title??''))===key);
  if(!block){out.push({kind:f.kind,line:-1,page:f.page,heading:f.heading,detail:'"'+f.heading+'" is stranded on page '+f.page+' (title line from the export, not in the note).'});continue;}
  let first=blocks.indexOf(block);while(first>0&&blocks[first-1].kind==='heading')first--;
  const fixable=blocks[first]!==firstContent;
  out.push({kind:f.kind,line:block.line,page:f.page,heading:f.heading,detail:'"'+f.heading+'" ends page '+f.page+' while its content is on page '+(f.page+1)+'.',fixLine:fixable?blocks[first].line:undefined});
 }
 return dedupe(out);
}

/**
 * The 0-based lines where page breaks go for the given heading titles: before
 * the run of headings that ends with each title, as detectLayoutIssues fixes
 * it. Titles match like the PDF read-back (link and emphasis syntax ignored);
 * unknown titles are returned so the caller can name them.
 */
export function pageBreakLines(text:string,headings:string[]):{lines:number[];unknown:string[]}{
 const blocks=markdownBlocks(text),lines:number[]=[],unknown:string[]=[];
 for(const title of headings){
  const key=norm(headingPlainText(title.replace(/^#+\s*/,'')));
  const index=blocks.findIndex(b=>b.kind==='heading'&&norm(headingPlainText(b.title??''))===key);
  if(!key||index<0){unknown.push(title);continue;}
  let first=index;while(first>0&&blocks[first-1].kind==='heading')first--;
  lines.push(blocks[first].line);
 }
 return {lines,unknown};
}

/** The model-facing estimate: each problem, and the fix call when one exists. */
export function layoutAdvice(issues:LayoutIssue[]):string{
 if(!issues.length)return layoutReport(issues);
 return issues.map(i=>'- '+i.detail+(i.fixLine===undefined?' No page break fixes this.':i.heading?' Fix: page break before heading "'+i.heading+'".':' Fix: page break before line '+(i.fixLine+1)+'.')).join('\n');
}

export function layoutReport(issues:{detail:string}[]):string{
 return issues.length?issues.map(i=>'- '+i.detail).join('\n'):'No stranded headings, lone titles or split tables found.';
}
