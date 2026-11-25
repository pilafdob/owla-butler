/**
 * Read-only access to Obsidian's own metadata: links, backlinks, tags and
 * properties, as the metadata cache already holds them. Nothing is indexed by
 * OWLA, and excluded or hidden paths never appear in a result.
 */
import {foldPath} from './core';

/** The subset of Obsidian's metadata cache this module reads. */
export type GraphSource={
 resolvedLinks:Record<string,Record<string,number>>;
 unresolvedLinks:Record<string,Record<string,number>>;
 notes:()=>string[];
 tags:(path:string)=>string[];
 properties:(path:string)=>Record<string,unknown>|null;
 allowed:(path:string)=>boolean;
};

export type GraphQuery={
 path?:string;
 tag?:string;
 property?:string;
 value?:string;
 report?:'unresolved'|'orphans'|'tags';
 offset?:number;
};

const PAGE=100;
const VALUE_LIMIT=500;
/** Hard bound on one serialized graph result: very long paths (Windows allows
 * far more than 260 characters) or huge values must not leak an unbounded tool
 * result into the next turn. */
const RESULT_LIMIT=60_000;
/** Shared character budget for displayed frontmatter. YAML anchors can expand a
 * small note into a huge object tree; without a budget, building the result alone
 * could exhaust memory. Every emitted node charges the budget. */
const PROPERTY_BUDGET=4_000;
type Budget={left:number};
const OMITTED='[value omitted]';
const shortText=(text:string)=>text.length>VALUE_LIMIT?text.slice(0,VALUE_LIMIT)+'… [truncated]':text;
/** Truncates long frontmatter values so one huge property cannot balloon the tool result into the next turn. */
function shortValue(value:unknown,budget:Budget,depth=0):unknown{
 if(depth>8||budget.left<=0){budget.left-=OMITTED.length;return OMITTED;}
 budget.left-=1;
 if(typeof value==='string'){const text=shortText(value);budget.left-=text.length;return text;}
 if(Array.isArray(value))return value.slice(0,20).map(item=>shortValue(item,budget,depth+1));
 if(value&&typeof value==='object'){const out:Record<string,unknown>={};for(const [key,item] of Object.entries(value).slice(0,40)){if(budget.left<=0)break;budget.left-=key.length;out[key]=shortValue(item,budget,depth+1);}return out;}
 budget.left-=String(value).length;return value;
}

function page<T>(items:T[],offset:number){
 const slice=items.slice(offset,offset+PAGE);
 return {items:slice,total:items.length,...(offset+PAGE<items.length?{nextOffset:offset+PAGE}:{})};
}

/** Shrinks a pathological result (very long paths, huge values) until it fits the
 * result budget; the counts keep describing the full graph. Normal results pass
 * through untouched. When a paginated page is trimmed, nextOffset is recomputed
 * from the items actually returned so the trimmed tail is not skipped forever,
 * and `truncated` marks that data was omitted. */
function boundGraph<T extends Record<string,unknown>>(result:T,pageOffset?:number):T{
 const out=result as Record<string,unknown>;
 let size=JSON.stringify(out).length;
 if(size<=RESULT_LIMIT)return result;
 const originalItems=Array.isArray(out.items)?[...(out.items as unknown[])]:null;
 const lists=['items','backlinks','unresolved','outgoing','tags'];
 while(size>RESULT_LIMIT){
  const field=lists.find(name=>Array.isArray(out[name])&&(out[name] as unknown[]).length>0);
  if(field){const list=out[field] as unknown[];out[field]=list.slice(0,Math.floor(list.length/2));}
  else if(out.properties&&typeof out.properties==='object'&&Object.keys(out.properties).length)out.properties={};
  else break;
  size=JSON.stringify(out).length;
 }
 out.truncated=true;
 if(pageOffset!==undefined&&originalItems&&typeof out.total==='number'){
  let items=out.items as unknown[];
  // Never return an empty page: that would loop the caller on the same offset.
  if(items.length===0&&pageOffset<out.total){items=[originalItems[0]];out.items=items;}
  const next=pageOffset+items.length;
  if(next<out.total)out.nextOffset=next;else delete out.nextOffset;
 }
 return result;
}

const normalTag=(tag:string)=>tag.replace(/^#/,'').toLowerCase();

/** A tag query matches the tag itself and its nested tags (#project matches #project/alpha). */
export function tagMatches(tag:string,query:string){
 const a=normalTag(tag),b=normalTag(query);
 return a===b||a.startsWith(b+'/');
}

function valueMatches(actual:unknown,expected:string|undefined):boolean{
 if(expected===undefined)return actual!==undefined&&actual!==null&&actual!=='';
 const want=expected.trim().toLowerCase();
 if(Array.isArray(actual))return actual.some(item=>valueMatches(item,expected));
 return String(actual).trim().toLowerCase().replace(/^\[\[|\]\]$/g,'')===want.replace(/^\[\[|\]\]$/g,'');
}

/** Links of one note: outgoing, unresolved, backlinks, and its tags and properties. */
export function noteGraph(source:GraphSource,path:string){
 if(!source.allowed(path))throw Error('Choose an existing, allowed Markdown note.');
 // NTFS and APFS resolve case aliases to one file, but Obsidian's cache keys use
 // the exact spelling; without this, an alias silently returned an empty graph.
 // The fallback fires ONLY when the exact spelling is not an indexed note: a
 // linkless indexed note keeps its own (empty) graph, and on case-sensitive
 // hosts a case-twin's links can never be returned for it.
 let exact=path;
 if(source.resolvedLinks[path]===undefined&&source.unresolvedLinks[path]===undefined){
  const notes=source.notes();
  if(!notes.includes(path)){
   const folded=foldPath(path);
   exact=notes.find(note=>foldPath(note)===folded)??path;
  }
 }
 const outgoing=Object.keys(source.resolvedLinks[exact]??{}).filter(source.allowed).sort();
 const unresolved=Object.keys(source.unresolvedLinks[exact]??{}).sort();
 const backlinks=Object.entries(source.resolvedLinks)
  .filter(([from,targets])=>from!==exact&&targets[exact]&&source.allowed(from))
  .map(([from,targets])=>({path:from,count:targets[exact]}))
  .sort((a,b)=>b.count-a.count||a.path.localeCompare(b.path));
 return boundGraph({path:exact,tags:source.tags(exact).slice(0,PAGE).map(shortText),properties:shortValue(source.properties(exact)??{},{left:PROPERTY_BUDGET}) as Record<string,unknown>,outgoing:outgoing.slice(0,PAGE),outgoingCount:outgoing.length,unresolved:unresolved.slice(0,PAGE),unresolvedCount:unresolved.length,backlinks:backlinks.slice(0,PAGE),backlinkCount:backlinks.length});
}

export function queryGraph(source:GraphSource,query:GraphQuery){
 const offset=Math.max(0,Math.floor(query.offset??0));
 if(query.path)return noteGraph(source,query.path);
 const notes=source.notes().filter(source.allowed).sort();
 if(query.tag){
  return boundGraph({tag:shortText(normalTag(query.tag)),...page(notes.filter(note=>source.tags(note).some(tag=>tagMatches(tag,query.tag!))),offset)},offset);
 }
 if(query.property){
  const key=query.property.trim().toLowerCase();
  const matches=notes.flatMap(note=>{
   const props=source.properties(note)??{};
   const entry=Object.entries(props).find(([name])=>name.toLowerCase()===key);
   return entry&&valueMatches(entry[1],query.value)?[{path:note,value:entry[1]}]:[];
  });
  // Display values are truncated after paging, with one shared budget, so a
  // hundred huge properties cannot multiply into a huge result. Matching still
  // runs on the raw value.
  const paged=page(matches,offset);
  const budget:Budget={left:PROPERTY_BUDGET};
  return boundGraph({property:shortText(query.property),...(query.value!==undefined?{value:shortText(query.value)}:{}),...paged,items:paged.items.map(item=>({path:item.path,value:shortValue(item.value,budget)}))},offset);
 }
 if(query.report==='unresolved'){
  const rows=notes.flatMap(note=>Object.keys(source.unresolvedLinks[note]??{}).map(link=>({from:note,link:shortText(link)})));
  return boundGraph({report:'unresolved',...page(rows,offset)},offset);
 }
 if(query.report==='orphans'){
  const linked=new Set<string>();
  for(const [from,targets] of Object.entries(source.resolvedLinks))if(source.allowed(from))for(const to of Object.keys(targets))if(to!==from)linked.add(to);
  return boundGraph({report:'orphans',...page(notes.filter(note=>!linked.has(note)),offset)},offset);
 }
 if(query.report==='tags'){
  const counts=new Map<string,number>();
  for(const note of notes)for(const tag of new Set(source.tags(note).map(normalTag)))counts.set(tag,(counts.get(tag)??0)+1);
  return boundGraph({report:'tags',...page([...counts].map(([tag,count])=>({tag:shortText(tag),count})).sort((a,b)=>b.count-a.count||a.tag.localeCompare(b.tag)),offset)},offset);
 }
 throw Error('Provide path, tag, property or report.');
}

export const VAULT_GRAPH_TOOL={
 type:'function' as const,name:'query_vault_graph',
 description:'Read Obsidian metadata without opening notes. path: a note\'s outgoing links, unresolved links, backlinks, tags and properties. tag: notes with that tag or its nested tags. property (optionally value): notes whose frontmatter property is set or equals value. report: unresolved (broken links), orphans (notes nothing links to) or tags (tag counts). Follow nextOffset for more.',
 inputSchema:{type:'object',properties:{path:{type:'string'},tag:{type:'string'},property:{type:'string'},value:{type:'string'},report:{type:'string',enum:['unresolved','orphans','tags']},offset:{type:'integer'}},additionalProperties:false},
};

export function decodeGraphQuery(value:Record<string,unknown>):GraphQuery{
 const query:GraphQuery={};
 for(const key of ['path','tag','property','value'] as const){const v=value[key];if(v!==undefined){if(typeof v!=='string')throw Error(key+' must be text.');query[key]=v;}}
 if(value.report!==undefined){if(value.report!=='unresolved'&&value.report!=='orphans'&&value.report!=='tags')throw Error('report must be unresolved, orphans or tags.');query.report=value.report;}
 if(value.offset!==undefined){if(typeof value.offset!=='number'||!Number.isSafeInteger(value.offset)||value.offset<0)throw Error('offset must be a nonnegative integer.');query.offset=value.offset;}
 return query;
}
