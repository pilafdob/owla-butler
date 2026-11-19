/**
 * Obsidian-specific helpers for note proposals: frontmatter property edits and
 * link checks. Pure functions; Obsidian's YAML and link resolution are passed in.
 */

const FRONTMATTER=/^---\r?\n([\s\S]*?)\r?\n?---(?:\r?\n|$)/;

export type Yaml={parse:(text:string)=>unknown;stringify:(value:unknown)=>string};

/** The frontmatter block at the start of a note, including its fences, or ''. */
export function frontmatterBlock(text:string){return text.match(FRONTMATTER)?.[0]??'';}

const isRecord=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);

/**
 * Sets and removes properties, keeping every other property and the body as
 * they were. Property names match case-insensitively, as Obsidian treats them.
 */
export function updateProperties(text:string,set:Record<string,unknown>,remove:string[],yaml:Yaml){
 const block=frontmatterBlock(text);
 let props:Record<string,unknown>={};
 if(block){
  const raw=text.match(FRONTMATTER)![1];
  const parsed=raw.trim()?yaml.parse(raw):{};
  if(parsed!==null&&!isRecord(parsed))throw Error('The note’s properties are not valid YAML key–value pairs. Edit them as text instead.');
  props={...(parsed??{})};
 }
 const keyOf=(name:string)=>Object.keys(props).find(key=>key.toLowerCase()===name.toLowerCase());
 for(const name of remove){const key=keyOf(name);if(key!==undefined)delete props[key];}
 for(const [name,value] of Object.entries(set)){
  if(!name.trim())throw Error('Property names cannot be empty.');
  const key=keyOf(name)??name;
  props[key]=value;
 }
 const body=text.slice(block.length);
 const yamlText=Object.keys(props).length?yaml.stringify(props).replace(/\n*$/,'\n'):'';
 const next=yamlText?'---\n'+yamlText+'---\n'+body:body.replace(/^\r?\n/,'');
 return {before:block,after:next.slice(0,next.length-body.length),text:next};
}

/** Wikilink and Markdown link targets in text, without embeds of external URLs. */
export function linkTargets(text:string):{link:string;path:string;subpath:string}[]{
 const found:{link:string;path:string;subpath:string}[]=[];
 const seen=new Set<string>();
 const add=(link:string)=>{
  const target=link.split('|')[0].trim();
  if(!target||/^[a-z]+:/i.test(target))return;
  const hash=target.indexOf('#');
  const path=hash<0?target:target.slice(0,hash),subpath=hash<0?'':target.slice(hash);
  if(seen.has(target))return;
  seen.add(target);
  found.push({link:target,path,subpath});
 };
 const code=text.replace(/```[\s\S]*?```|`[^`\n]*`/g,'');
 for(const match of code.matchAll(/!?\[\[([^\]\n]+)\]\]/g))add(match[1]);
 for(const match of code.matchAll(/\[[^\]\n]*\]\(([^)\s]+\.md(?:#[^)\s]*)?)\)/gi))add(decodeURIComponent(match[1]));
 return found;
}

/**
 * Links in the proposed text that would not resolve. `resolve` returns the
 * target note path or null; `subpathExists` checks a heading or block in it.
 * Links already broken in the original text are not reported again.
 */
export function brokenLinks(before:string,after:string,resolve:(path:string)=>string|null,subpathExists:(note:string,subpath:string)=>boolean){
 const existing=new Set(linkTargets(before).map(item=>item.link));
 return linkTargets(after).filter(item=>{
  if(existing.has(item.link))return false;
  const note=item.path?resolve(item.path):'';
  if(note===null)return true;
  return !!item.subpath&&!subpathExists(note,item.subpath);
 }).map(item=>item.link);
}

export function linkWarning(links:string[]){
 return links.length?' Warning: these links will not resolve in Obsidian: '+links.slice(0,20).map(link=>'[['+link+']]').join(', ')+'. Fix them with another propose_edit unless the user wants new, unresolved links.':'';
}

/** Whether Markdown text contains a heading or block ID; nested heading links use their last part. */
export function textHasSubpath(text:string,subpath:string){
 const block=subpath.match(/^#\^([\w-]+)$/);
 if(block)return new RegExp('(?:^|\\s)\\^'+block[1]+'\\s*$','m').test(text);
 const wanted=subpath.replace(/^#/,'').split('#').pop()!.trim().toLowerCase();
 return [...text.matchAll(/^#{1,6}[ \t]+(.+?)[ \t#]*$/gm)].some(match=>match[1].trim().toLowerCase()===wanted);
}

/** A Markdown heading found in note text, with the character range of its section. */
export type NoteHeading={level:number;title:string;start:number;end:number};

/**
 * ATX headings of a note and the range of each section (up to the next heading
 * of the same or a higher level). Fenced code and frontmatter are skipped.
 * Works on any text — the saved note, unsaved editor text or a staged preview —
 * so a section can be read even when Obsidian's cache describes another version.
 */
export function noteHeadings(text:string):NoteHeading[]{
 const headings:{level:number;title:string;start:number}[]=[];
 let offset=frontmatterBlock(text).length,fence:string|null=null;
 for(const line of text.slice(offset).split('\n')){
  const marker=line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1];
  if(fence){if(marker&&marker[0]===fence[0]&&marker.length>=fence.length)fence=null;}
  else if(marker)fence=marker;
  else{
   const heading=line.match(/^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*(?:[ \t]#+[ \t]*)?\r?$/);
   if(heading)headings.push({level:heading[1].length,title:heading[2].trim(),start:offset});
  }
  offset+=line.length+1;
 }
 // One stack pass assigns each heading's end (the next heading of the same or
 // a higher level): the old slice+find per heading was O(H²) on heading-dense
 // notes (performance audit 10). Same ranges, linear time.
 const ends:number[]=new Array<number>(headings.length);
 const stack:number[]=[];
 for(let i=0;i<headings.length;i++){
  while(stack.length&&headings[stack[stack.length-1]].level>=headings[i].level)ends[stack.pop()!]=headings[i].start;
  stack.push(i);
 }
 while(stack.length)ends[stack.pop()!]=text.length;
 return headings.map((item,index)=>({...item,end:ends[index]}));
}

const normalizeHeading=(value:string)=>value.replace(/^#+\s*/,'').trim().replace(/\s+/g,' ').normalize('NFC').toLowerCase();

/**
 * The section for a heading reference: an exact title, or a nested path such as
 * `Vokabel#Vokabeln (Units 1–17)` as Obsidian links write it. Matching ignores
 * case and repeated spaces. Returns null when no heading matches.
 */
export function findSection(text:string,reference:string):NoteHeading|null{
 const parts=reference.split('#').map(normalizeHeading).filter(Boolean);
 if(!parts.length)return null;
 const headings=noteHeadings(text);
 let range:{start:number;end:number}={start:0,end:text.length},found:NoteHeading|null=null;
 for(const part of parts){
  found=headings.find(item=>item.start>=range.start&&item.start<range.end&&normalizeHeading(item.title)===part)??null;
  if(!found)return null;
  range=found;
 }
 return found;
}

/** The paragraph that carries a block ID (`^id`), or null. */
export function findBlock(text:string,id:string):{start:number;end:number}|null{
 const name=id.trim().replace(/^\^/,'');
 const match=new RegExp('(?:^|[ \\t])\\^'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'[ \\t]*$','m').exec(text);
 if(!match)return null;
 const before=text.lastIndexOf('\n\n',match.index),after=text.indexOf('\n\n',match.index);
 return {start:before<0?0:before+2,end:after<0?text.length:after};
}

/** Characters returned by one note read; longer text continues with an offset. */
export const NOTE_CHUNK=12_000;

/**
 * One window of a note or section, with a continuation the model can follow.
 * `continueWith` names the exact arguments for the next read.
 */
export function noteChunk(text:string,offset:number,continueWith:(next:number)=>Record<string,unknown>,size=NOTE_CHUNK):string{
 if(!Number.isSafeInteger(offset)||offset<0)throw Error('Provide a nonnegative integer offset.');
 if(offset>0&&offset>=text.length)throw Error('The offset is past the end ('+text.length+' characters).');
 const end=Math.min(text.length,offset+size);
 const range=offset>0||end<text.length?'[Characters '+offset+'–'+end+' of '+text.length+'.]\n':'';
 return range+text.slice(offset,end)+(end<text.length?'\n[Continue with read_note '+JSON.stringify(continueWith(end))+']':'');
}

/** Every heading as an indented outline, capped so a huge note still fits. */
export function headingOutline(text:string,max=200):string{
 const headings=noteHeadings(text);
 if(!headings.length)return '';
 const lines=headings.slice(0,max).map(item=>'  '.repeat(item.level-1)+'#'.repeat(item.level)+' '+item.title+' ('+(item.end-item.start)+' chars)');
 return '[Headings — read one with read_note heading, or continue with offset:\n'+lines.join('\n')+(headings.length>max?'\n… '+(headings.length-max)+' more':'')+']';
}

const FENCE=/^ {0,3}(`{3,}|~{3,})/;
/** A Markdown table row: a line that starts with a pipe after optional indentation. */
const TABLE_ROW=/^\s*\|/;
/** A Markdown table delimiter row such as `| --- | --- |`, `|:-:|-:|` or a one-column `| - |`. */
const TABLE_DELIMITER_CELL=/^\s*:?-+:?\s*$/;
function isTableDelimiter(row:string):boolean{
 const trimmed=row.trim();
 if(!trimmed.includes('|')||!trimmed.includes('-'))return false;
 const cells=trimmed.replace(/^\|/,'').replace(/\|$/,'').split('|');
 return cells.length>0&&cells.every(cell=>TABLE_DELIMITER_CELL.test(cell));
}

/**
 * The Markdown table that contains the given line, as its raw source text.
 * A table is a run of contiguous pipe-leading rows that includes a delimiter
 * row; fenced code blocks are skipped so `|`-looking lines inside them are not
 * mistaken for a table. Returns null when the line is not inside a table.
 */
export function tableAt(text:string,line:number):{start:number;end:number;text:string}|null{
 if(!Number.isInteger(line)||line<0)return null;
 const lines=text.split('\n');
 if(line>=lines.length)return null;
 const inFence=new Array<boolean>(lines.length).fill(false);
 let fence:string|null=null;
 for(let i=0;i<lines.length;i++){
  const marker=lines[i].match(FENCE)?.[1];
  if(fence){inFence[i]=true;if(marker&&marker[0]===fence[0]&&marker.length>=fence.length)fence=null;}
  else if(marker){fence=marker;inFence[i]=true;}
 }
 if(inFence[line]||!TABLE_ROW.test(lines[line]))return null;
 let start=line;
 while(start>0&&!inFence[start-1]&&TABLE_ROW.test(lines[start-1]))start--;
 let end=line;
 while(end<lines.length-1&&!inFence[end+1]&&TABLE_ROW.test(lines[end+1]))end++;
 const block=lines.slice(start,end+1);
 if(!block.some(isTableDelimiter))return null;
 return {start,end,text:block.join('\n')};
}
