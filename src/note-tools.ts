/**
 * Obsidian-specific helpers for note proposals: frontmatter property edits and
 * link checks. Pure functions; Obsidian's YAML and link resolution are passed in.
 */

const FRONTMATTER=/^---\r?\n([\s\S]*?)\r?\n?---(?:\r?\n|$)/;

export type Yaml={parse:(text:string)=>unknown;stringify:(value:unknown)=>string};

/** The frontmatter block at the start of a note, including its fences, or ''. */
export function frontmatterBlock(text:string){return text.match(FRONTMATTER)?.[0]??'';}

const isRecord=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);

/** Longest text accepted for one property value. */
const PROPERTY_VALUE_LIMIT=10_000;
const DATE=/^\d{4}-\d{2}-\d{2}$/,DATETIME=/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

/** Refuses property values Obsidian cannot show as a property: functions, NaN, huge text, deep nesting. */
function checkPropertyValue(name:string,value:unknown,depth=0):void{
 if(depth>4)throw Error('The value of "'+name+'" is nested too deeply for a property.');
 if(value===null||typeof value==='boolean')return;
 if(typeof value==='number'){if(!Number.isFinite(value))throw Error('The value of "'+name+'" must be a finite number.');return;}
 if(typeof value==='string'){if(value.length>PROPERTY_VALUE_LIMIT)throw Error('The value of "'+name+'" is longer than '+PROPERTY_VALUE_LIMIT+' characters.');return;}
 if(Array.isArray(value)){for(const item of value)checkPropertyValue(name,item,depth+1);return;}
 if(isRecord(value)){for(const item of Object.values(value))checkPropertyValue(name,item,depth+1);return;}
 throw Error('The value of "'+name+'" must be text, a number, a checkbox (true/false), a date text, a list or null.');
}

/**
 * Keeps the property type the note already uses: a checkbox stays boolean, a
 * number stays a number and a list stays a list when the model sends the value
 * as text. Returns the value to write and a note when it was converted.
 */
function keepType(name:string,current:unknown,value:unknown):{value:unknown;note?:string}{
 if(typeof value!=='string')return {value};
 const text=value.trim();
 if(typeof current==='boolean'&&/^(true|false)$/i.test(text))return {value:text.toLowerCase()==='true',note:name+' kept as a checkbox'};
 if(typeof current==='number'&&text!==''&&Number.isFinite(Number(text)))return {value:Number(text),note:name+' kept as a number'};
 if(Array.isArray(current))return {value:text?[value]:[],note:name+' kept as a list'};
 return {value};
}

/** Compares parsed YAML values; dates compare by their written form, so `2026-11-20` and a parsed Date match. */
function sameValue(a:unknown,b:unknown):boolean{
 const norm=(value:unknown):unknown=>{
  if(value instanceof Date)return Number.isNaN(value.getTime())?String(value):value.toISOString().replace(/T00:00:00\.000Z$/,'');
  if(typeof value==='string'&&(DATE.test(value)||DATETIME.test(value))){
   const date=new Date(DATETIME.test(value)&&!/(?:Z|[+-]\d{2}:?\d{2})$/.test(value)?value.replace(' ','T')+'Z':value);
   return Number.isNaN(date.getTime())?value:date.toISOString().replace(/T00:00:00\.000Z$/,'');
  }
  if(Array.isArray(value))return value.map(norm);
  if(isRecord(value))return Object.entries(value).map(([key,item])=>[key,norm(item)]);
  return value;
 };
 return JSON.stringify(norm(a))===JSON.stringify(norm(b));
}

/** One top-level entry of a block-style frontmatter: its key (null for comments and blank lines) and raw lines. */
type Segment={key:string|null;keyText:string;lines:string[]};
const KEY_LINE=/^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#"'\-[\]{}?:,&*!|>%@`][^:]*?|-[^\s:][^:]*?)[ \t]*:(?=[ \t]|$)/;
const unquoteKey=(text:string)=>text.startsWith('"')?(()=>{try{return JSON.parse(text) as string;}catch{return text.slice(1,-1);}})():text.startsWith("'")?text.slice(1,-1).replace(/''/g,"'"):text;

/** Splits block-style YAML into top-level entries, or null when it uses a form this line editor does not handle. */
function segments(raw:string):Segment[]|null{
 const out:Segment[]=[];
 for(const line of raw.split(/\r?\n/)){
  const key=line.match(KEY_LINE);
  if(key){out.push({key:unquoteKey(key[1]),keyText:key[1],lines:[line]});continue;}
  if(!line.trim()||/^\s*#/.test(line)){
   // Comments and blank lines after an entry stay with it only when indented;
   // a column-0 comment is its own entry so removing a key never drops it.
   if(out.length&&out[out.length-1].key!==null&&/^\s+\S/.test(line))out[out.length-1].lines.push(line);
   else out.push({key:null,keyText:'',lines:[line]});
   continue;
  }
  if(/^[ \t]/.test(line)||/^- /.test(line)||line==='-'){
   const last=out.length?out[out.length-1]:null;
   if(!last)return null;
   if(last.key===null){
    // A continuation after blank lines belongs to the entry before them.
    const owner=[...out].reverse().find(item=>item.key!==null);
    if(!owner||out.slice(out.indexOf(owner)+1).some(item=>item.lines.some(l=>l.trim())))return null;
    const between=out.splice(out.indexOf(owner)+1);
    owner.lines.push(...between.flatMap(item=>item.lines),line);
    continue;
   }
   last.lines.push(line);continue;
  }
  return null;
 }
 return out;
}

const SIMPLE_KEY=/^[A-Za-z_][\w .\-/]*[\w.\-/]$|^[A-Za-z_]$/;
/** One `key: value` entry as YAML lines. Dates are written unquoted so Obsidian keeps them as date properties. */
function entryLines(key:string,value:unknown,yaml:Yaml):string[]{
 if(typeof value==='string'&&(DATE.test(value)||DATETIME.test(value))&&SIMPLE_KEY.test(key))return [key+': '+value];
 return yaml.stringify({[key]:value}).replace(/\r\n/g,'\n').replace(/\n+$/,'').split('\n');
}

export type PropertyChange={before:string;after:string;text:string;notes:string[];preserved:boolean};

/**
 * Sets, renames and removes properties, keeping every other property and the
 * body as they were. Property names match case-insensitively, as Obsidian
 * treats them. Block-style frontmatter is edited line by line, so untouched
 * entries, comments and key order are kept byte for byte; other YAML is
 * re-serialized. Invalid YAML is refused before and after the change.
 */
export function updateProperties(text:string,set:Record<string,unknown>,remove:string[],yaml:Yaml,rename:Record<string,string>={}):PropertyChange{
 const block=frontmatterBlock(text);
 const raw=block?text.match(FRONTMATTER)![1]:'';
 let props:Record<string,unknown>={};
 if(block&&raw.trim()){
  let parsed:unknown;
  try{parsed=yaml.parse(raw);}catch(error){throw Error('The note’s properties are not valid YAML ('+(error instanceof Error?error.message.split('\n')[0]:String(error))+'). Fix them as text with propose_edit first.');}
  if(parsed!==null&&!isRecord(parsed))throw Error('The note’s properties are not valid YAML key–value pairs. Edit them as text instead.');
  props={...(parsed??{})};
 }
 const notes:string[]=[];
 const keyOf=(name:string,obj=props)=>Object.keys(obj).find(key=>key.toLowerCase()===name.trim().toLowerCase());
 // Renames keep the entry's position and value.
 const renamed=new Map<string,string>();
 for(const [from,to] of Object.entries(rename)){
  if(typeof to!=='string'||!to.trim())throw Error('Give a new, non-empty name for property "'+from+'".');
  const key=keyOf(from);
  if(key===undefined)throw Error('There is no property "'+from+'" to rename.');
  const clash=keyOf(to);
  if(clash!==undefined&&clash!==key)throw Error('A property "'+clash+'" already exists; remove it or choose another name.');
  const next:Record<string,unknown>={};
  for(const [name,value] of Object.entries(props))next[name===key?to.trim():name]=value;
  props=next;renamed.set(key,to.trim());
 }
 for(const name of remove){const key=keyOf(name);if(key!==undefined)delete props[key];}
 const changed=new Set<string>();
 for(const [name,input] of Object.entries(set)){
  if(!name.trim())throw Error('Property names cannot be empty.');
  checkPropertyValue(name,input);
  const key=keyOf(name)??name.trim();
  const kept=keepType(key,props[key],input);
  if(kept.note)notes.push(kept.note);
  props[key]=kept.value;changed.add(key);
 }
 const body=text.slice(block.length);
 // Keep the note's line endings: rewriting a CRLF frontmatter with LF would
 // show every property line as changed and mix endings inside one file.
 const eol=(block||text).includes('\r\n')?'\r\n':'\n';
 const finish=(yamlText:string,preserved:boolean):PropertyChange=>{
  const next=yamlText?'---'+eol+yamlText+'---'+eol+body:body.replace(/^\r?\n/,'');
  return {before:block,after:next.slice(0,next.length-body.length),text:next,notes,preserved};
 };
 if(!Object.keys(props).length)return finish('',true);
 const restringify=()=>finish(yaml.stringify(props).replace(/\r\n/g,'\n').replace(/\n*$/,'\n').replace(/\n/g,eol),false);
 const parts=raw.trim()?segments(raw.replace(/\r\n/g,'\n')):[];
 if(!parts)return restringify();
 // Line edit: the original lines of every entry that did not change.
 const lines:string[]=[];
 const written=new Set<string>();
 for(const part of parts){
  if(part.key===null){lines.push(...part.lines);continue;}
  const current=renamed.get(part.key)??part.key;
  if(!(current in props))continue;
  written.add(current);
  if(changed.has(current))lines.push(...entryLines(current,props[current],yaml));
  else if(current!==part.key){
   const key=SIMPLE_KEY.test(current)?current:JSON.stringify(current);
   lines.push(key+part.lines[0].slice(part.keyText.length),...part.lines.slice(1));
  }else lines.push(...part.lines);
 }
 // Trailing blank lines stay at the end of the block, after new entries.
 const trailing:string[]=[];
 while(lines.length&&!lines[lines.length-1].trim())trailing.unshift(lines.pop()!);
 for(const key of Object.keys(props))if(!written.has(key))lines.push(...entryLines(key,props[key],yaml));
 lines.push(...trailing);
 const yamlText=lines.join('\n').replace(/\n*$/,'\n');
 // Verify: the edited block must parse to exactly the intended properties, in
 // order. Anything unexpected falls back to a full, valid re-serialization.
 let check:unknown;
 try{check=yaml.parse(yamlText);}catch{return restringify();}
 if(!isRecord(check)||JSON.stringify(Object.keys(check))!==JSON.stringify(Object.keys(props))||!Object.keys(props).every(key=>sameValue(check[key],props[key])))return restringify();
 return finish(yamlText.replace(/\n/g,eol),true);
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
 // Paragraphs are separated by blank lines; a CRLF note writes them with CR
 // halves that a plain LF-only search never finds (the whole note came back
 // as one block). The scan OVERLAPS (lastIndex advances by one) so odd
 // blank-line runs keep the old lastIndexOf ranges byte-for-byte: a
 // three-newline run starts the block after the LAST two, not the first two.
 let start=0,end=text.length;
 const blank=/\r?\n\r?\n/g;
 let gap:RegExpExecArray|null;
 while((gap=blank.exec(text))){
  if(gap.index+gap[0].length<=match.index)start=gap.index+gap[0].length;
  else{end=gap.index;break;}
  blank.lastIndex=gap.index+1;
 }
 return {start,end};
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
 // Editor lines drop the \r of a CRLF pair; strip the dangling half-terminator
 // so the captured text matches the editor selection. Inner CRLFs stay raw.
 return {start,end,text:block.join('\n').replace(/\r$/,'')};
}

// ---------------------------------------------------------------- outline edits

export type OutlinePosition='up'|'down'|'before'|'after'|'under'|'end';
/** One structural outline change. Headings are named like read_note's heading (nested: Parent#Child). */
export type OutlineOp=
 {op:'rename';heading:string;title:string;occurrence?:number}
|{op:'level';heading:string;level?:number;shift?:number;occurrence?:number}
|{op:'move';heading:string;position:OutlinePosition;target?:string;occurrence?:number;targetOccurrence?:number}
|{op:'insert';title:string;level?:number;position?:OutlinePosition;target?:string;content?:string;targetOccurrence?:number};

/** Every heading that matches a reference: an exact title (which may contain #) or a nested Parent#Child path. */
export function matchHeadings(text:string,reference:string):NoteHeading[]{
 const headings=noteHeadings(text);
 const whole=normalizeHeading(reference);
 if(!whole)return [];
 const exact=headings.filter(item=>normalizeHeading(item.title)===whole);
 if(exact.length)return exact;
 const parts=reference.split('#').map(normalizeHeading).filter(Boolean);
 if(parts.length<2)return [];
 let matches:NoteHeading[]=headings.filter(item=>normalizeHeading(item.title)===parts[0]);
 for(const part of parts.slice(1))matches=headings.filter(item=>normalizeHeading(item.title)===part&&matches.some(parent=>item.start>parent.start&&item.start<parent.end));
 return matches;
}

/** The one heading a reference names; duplicates need a nested path or a 1-based occurrence. */
export function resolveHeading(text:string,reference:string,occurrence?:number):NoteHeading{
 if(typeof reference!=='string'||!reference.trim())throw Error('Name the heading to change.');
 const matches=matchHeadings(text,reference);
 if(!matches.length)throw Error('No heading "'+reference+'" in this note. '+headingOutline(text,80));
 if(occurrence!==undefined){
  if(!Number.isSafeInteger(occurrence)||occurrence<1||occurrence>matches.length)throw Error('occurrence must be between 1 and '+matches.length+' for "'+reference+'".');
  return matches[occurrence-1];
 }
 if(matches.length>1)throw Error(matches.length+' headings match "'+reference+'". Use a nested path such as Parent#Child, or occurrence (1–'+matches.length+').');
 return matches[0];
}

const HEADING_PREFIX=/^( {0,3})(#{1,6})([ \t]+)/;
const lineEnd=(text:string,start:number)=>{const end=text.indexOf('\n',start);return end<0?text.length:end;};
const eolOf=(text:string)=>text.includes('\r\n')?'\r\n':'\n';
const checkTitle=(title:unknown)=>{
 if(typeof title!=='string'||!title.trim())throw Error('Give the heading a non-empty title.');
 if(/[\r\n]/.test(title))throw Error('A heading title must be one line.');
 const clean=title.trim().replace(/^#+[ \t]*/,'');
 if(!clean)throw Error('Give the heading a non-empty title.');
 return clean;
};
const checkLevel=(level:number)=>{if(!Number.isSafeInteger(level)||level<1||level>6)throw Error('Heading levels run from 1 to 6.');};

/** Shifts every heading in a range (a section and its children) by delta levels. */
function shiftHeadings(text:string,range:{start:number;end:number},delta:number):string{
 if(!delta)return text;
 const inside=noteHeadings(text).filter(item=>item.start>=range.start&&item.start<range.end);
 for(const item of inside)if(item.level+delta<1||item.level+delta>6)throw Error('This would put "'+item.title+'" at level '+(item.level+delta)+'; heading levels run from 1 to 6.');
 let out=text;
 for(const item of [...inside].reverse()){
  const line=out.slice(item.start,lineEnd(out,item.start));
  const next=line.replace(HEADING_PREFIX,(_all,indent:string,_marks:string,space:string)=>indent+'#'.repeat(item.level+delta)+space);
  out=out.slice(0,item.start)+next+out.slice(item.start+line.length);
 }
 return out;
}

/** Removes a section and inserts it, shifted by delta levels, at a position of the original text. */
function relocate(text:string,section:NoteHeading,at:number,delta:number):string{
 const eol=eolOf(text);
 let block=text.slice(section.start,section.end);
 if(!block.endsWith('\n'))block+=eol;
 // Shift inside the block alone; offsets are relative to it.
 block=shiftHeadings(block,{start:0,end:block.length},delta);
 let rest=text.slice(0,section.start)+text.slice(section.end);
 let pos=at>=section.end?at-(section.end-section.start):at;
 // The last section leaves the blank lines that preceded it at the end of the note.
 if(section.end===text.length&&text.endsWith('\n')&&pos<rest.length){const trimmed=rest.replace(/(?:\r?\n)+$/,'')+eol;pos=Math.min(pos,trimmed.length);rest=trimmed;}
 if(pos>0&&rest[pos-1]!=='\n'){rest=rest.slice(0,pos)+eol+rest.slice(pos);pos+=eol.length;}
 // A blank line follows the moved section when text follows it. Appended at the
 // end of the note, a blank line precedes it and it ends with one line break, as
 // the note did. In the middle, the spacing before the target is left as it was.
 if(pos<rest.length){if(!/\n\r?\n$/.test(block))block+=eol;}
 else{
  if(pos>0&&!/\n\r?\n$/.test(rest)){rest+=eol;pos+=eol.length;}
  if(text.endsWith('\n'))block=block.replace(/(?:\r?\n)+$/,'')+eol;
 }
 return rest.slice(0,pos)+block+rest.slice(pos);
}

export type OutlineResult={text:string;summary:string};

/**
 * Applies one structural outline change and returns the new note text.
 * rename keeps the heading's level and the section's content; level shifts
 * the section's children with it; move carries the whole section (children
 * included) and re-levels it to sit before/after a heading as its sibling or
 * under it as its last child; insert adds a heading with optional content.
 * Fenced code and frontmatter are never touched, and line endings follow the
 * note (CRLF stays CRLF).
 */
export function editOutline(text:string,op:OutlineOp):OutlineResult{
 const eol=eolOf(text);
 if(op.op==='rename'){
  const heading=resolveHeading(text,op.heading,op.occurrence);
  const title=checkTitle(op.title);
  const end=lineEnd(text,heading.start);
  const line=text.slice(heading.start,end);
  const prefix=line.match(HEADING_PREFIX)![0];
  const next=prefix+title+(line.endsWith('\r')?'\r':'');
  return {text:text.slice(0,heading.start)+next+text.slice(end),summary:'Renamed heading "'+heading.title+'" to "'+title+'".'};
 }
 if(op.op==='level'){
  const heading=resolveHeading(text,op.heading,op.occurrence);
  const level=op.level!==undefined?op.level:heading.level+(op.shift??0);
  if(op.level===undefined&&op.shift===undefined)throw Error('Give level (1–6) or shift (for example -1 to promote, 1 to demote).');
  checkLevel(level);
  if(level===heading.level)return {text,summary:'"'+heading.title+'" is already at level '+level+'.'};
  return {text:shiftHeadings(text,heading,level-heading.level),summary:(level<heading.level?'Promoted':'Demoted')+' "'+heading.title+'" and its subsections from level '+heading.level+' to '+level+'.'};
 }
 if(op.op==='move'){
  const heading=resolveHeading(text,op.heading,op.occurrence);
  const headings=noteHeadings(text);
  const index=headings.findIndex(item=>item.start===heading.start);
  if(op.position==='up'||op.position==='down'){
   let sibling:NoteHeading|undefined;
   if(op.position==='up'){
    for(let i=index-1;i>=0;i--){if(headings[i].level<heading.level)break;if(headings[i].level===heading.level){sibling=headings[i];break;}}
    if(!sibling)throw Error('"'+heading.title+'" is already the first section at its level.');
    return {text:relocate(text,heading,sibling.start,0),summary:'Moved "'+heading.title+'" above "'+sibling.title+'".'};
   }
   sibling=headings.find(item=>item.start===heading.end&&item.level===heading.level);
   if(!sibling)throw Error('"'+heading.title+'" is already the last section at its level.');
   return {text:relocate(text,heading,sibling.end,0),summary:'Moved "'+heading.title+'" below "'+sibling.title+'".'};
  }
  if(op.position!=='before'&&op.position!=='after'&&op.position!=='under')throw Error('position must be up, down, before, after or under.');
  if(typeof op.target!=='string')throw Error('Name the target heading to move "'+heading.title+'" '+op.position+'.');
  const target=resolveHeading(text,op.target,op.targetOccurrence);
  if(target.start>=heading.start&&target.start<heading.end)throw Error('A section cannot be moved '+op.position+' itself or one of its own subsections.');
  const level=op.position==='under'?target.level+1:target.level;
  checkLevel(level);
  const at=op.position==='before'?target.start:target.end;
  return {text:relocate(text,heading,at,level-heading.level),summary:'Moved "'+heading.title+'" '+(op.position==='under'?'under':op.position)+' "'+target.title+'"'+(level!==heading.level?' (now level '+level+')':'')+'.'};
 }
 if(op.op==='insert'){
  const title=checkTitle(op.title);
  const position=op.position??(op.target?'after':'end');
  let at=text.length,level=op.level??2,where='at the end of the note';
  if(position!=='end'){
   if(position!=='before'&&position!=='after'&&position!=='under')throw Error('position must be before, after, under or end.');
   if(typeof op.target!=='string')throw Error('Name the target heading to insert '+position+'.');
   const target=resolveHeading(text,op.target,op.targetOccurrence);
   level=op.level??(position==='under'?target.level+1:target.level);
   at=position==='before'?target.start:target.end;
   if(position==='under'&&level<=target.level)throw Error('A heading under "'+target.title+'" needs a level above '+target.level+'.');
   where=position+' "'+target.title+'"';
  }
  checkLevel(level);
  if(op.content!==undefined&&typeof op.content!=='string')throw Error('content must be text.');
  const content=(op.content??'').replace(/\r\n/g,'\n').replace(/\n+$/,'');
  let before=text.slice(0,at),after=text.slice(at);
  const lead=!before?'':before.endsWith('\n')?(/\n\r?\n$/.test(before)||before.trim()===''?'':eol):eol+eol;
  let block='#'.repeat(level)+' '+title+eol+(content?content.replace(/\n/g,eol)+eol:'');
  if(after)block+=eol;
  return {text:before+lead+block+after,summary:'Inserted level-'+level+' heading "'+title+'" '+where+'.'};
 }
 throw Error('op must be rename, level, move or insert.');
}

/** Headings (by normalized title) present before a change and gone after it. */
export function lostHeadings(before:string,after:string):string[]{
 const remaining=new Map<string,number>();
 for(const item of noteHeadings(after)){const key=normalizeHeading(item.title);remaining.set(key,(remaining.get(key)??0)+1);}
 const lost:string[]=[];
 for(const item of noteHeadings(before)){
  const key=normalizeHeading(item.title),left=remaining.get(key)??0;
  if(left>0)remaining.set(key,left-1);else lost.push(item.title);
 }
 return lost;
}

/**
 * Heading links (`[[note#Heading]]`, `[[#Heading]]`) that resolved before a
 * change and would not after it, for example because the heading was renamed.
 * Each link names the note that contains it.
 */
export function headingLinkBreaks(before:string,after:string,links:{source:string;link:string}[]):{source:string;link:string}[]{
 return links.filter(({link})=>{
  const hash=link.indexOf('#');
  if(hash<0||link[hash+1]==='^')return false;
  const subpath=link.slice(hash);
  return textHasSubpath(before,subpath)&&!textHasSubpath(after,subpath);
 });
}

export function headingLinkWarning(items:{source:string;link:string}[]){
 if(!items.length)return '';
 const shown=items.slice(0,20).map(item=>'[['+item.link+']] in '+item.source);
 return ' Warning: these links point to a heading this change renames or removes and will stop resolving: '+shown.join(', ')+(items.length>20?' … '+(items.length-20)+' more':'')+'. Update them with propose_edit (read each note first) unless the user wants them left.';
}

// ---------------------------------------------------------------- note context

/** Characters the properties/outline/links block may add to the active-note context. */
export const NOTE_CONTEXT_LIMIT=2_500;

export type NoteContextInput={
 properties:Record<string,unknown>|null|'invalid';
 text:string;
 outgoing:string[];
 unresolved:string[];
 backlinks:string[];
 /** Totals when the lists are only the first page of a larger graph. */
 totals?:{outgoing?:number;unresolved?:number;backlinks?:number};
};

const clip=(text:string,max:number)=>text.length>max?text.slice(0,max-1)+'…':text;
function propertyText(value:unknown,depth=0):string{
 if(value instanceof Date)return Number.isNaN(value.getTime())?'':value.toISOString().replace(/T00:00:00\.000Z$/,'');
 if(Array.isArray(value))return depth>1?'[…]':'['+value.slice(0,8).map(item=>propertyText(item,depth+1)).join(', ')+(value.length>8?', … '+(value.length-8)+' more':'')+']';
 if(isRecord(value))return depth>1?'{…}':'{'+Object.entries(value).slice(0,6).map(([key,item])=>key+': '+propertyText(item,depth+1)).join(', ')+'}';
 if(value===null||value===undefined)return '';
 return clip(String(value).replace(/\s+/g,' '),120);
}

/** A list joined into at most max characters and maxItems entries, naming how many were left out. */
function capList(items:string[],maxItems:number,maxChars:number,total=items.length){
 const out:string[]=[];let size=0;
 for(const item of items.slice(0,maxItems)){
  const piece=clip(item,160);
  if(size+piece.length+2>maxChars&&out.length)break;
  out.push(piece);size+=piece.length+2;
 }
 return out.join(', ')+(total>out.length?' … '+(total-out.length)+' more':'');
}

/**
 * A compact, bounded summary of the active note for the message context:
 * parsed properties, the full heading outline, outgoing links (resolved paths
 * and unresolved targets) and backlinks. Every part has its own budget and the
 * whole block never exceeds `limit` characters.
 */
export function noteContextBlock(input:NoteContextInput,limit=NOTE_CONTEXT_LIMIT):string{
 const parts:string[]=[];
 if(input.properties==='invalid')parts.push('Properties: (frontmatter is not valid YAML)');
 else if(input.properties&&Object.keys(input.properties).length){
  const entries=Object.entries(input.properties).filter(([key])=>key!=='position');
  let text='',shown=0;
  for(const [key,value] of entries){
   const piece=clip(key,60)+': '+propertyText(value);
   if(text.length+piece.length>700&&shown)break;
   text+=(shown?'; ':'')+piece;shown++;
  }
  if(entries.length)parts.push('Properties: '+text+(entries.length>shown?' … '+(entries.length-shown)+' more':''));
 }
 const headings=noteHeadings(input.text);
 if(headings.length){
  const lines:string[]=[];let size=0;
  for(const item of headings){
   const line='  '.repeat(item.level-1)+'#'.repeat(item.level)+' '+clip(item.title,80);
   if(size+line.length+1>900&&lines.length)break;
   lines.push(line);size+=line.length+1;
  }
  parts.push('Outline:\n'+lines.join('\n')+(headings.length>lines.length?'\n… '+(headings.length-lines.length)+' more headings (read_note lists them all)':''));
 }
 else parts.push('Outline: (no headings)');
 const total=(name:'outgoing'|'unresolved'|'backlinks')=>Math.max(input[name].length,input.totals?.[name]??0);
 if(input.outgoing.length)parts.push('Outgoing links ('+total('outgoing')+'): '+capList(input.outgoing,40,400,total('outgoing')));
 if(input.unresolved.length)parts.push('Unresolved links ('+total('unresolved')+', no such note): '+capList(input.unresolved,20,200,total('unresolved')));
 parts.push(input.backlinks.length?'Backlinks ('+total('backlinks')+'): '+capList(input.backlinks,30,600,total('backlinks')):'Backlinks: none');
 const head='[Note context — properties, outline and links of the active note. Change properties with propose_properties and headings with propose_outline.\n';
 let block=head+parts.join('\n')+']';
 if(block.length>limit)block=block.slice(0,limit-2)+'…]';
 return block;
}
