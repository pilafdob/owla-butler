/**
 * Read-only access to Obsidian's own metadata: links, backlinks, tags and
 * properties, as the metadata cache already holds them. Nothing is indexed by
 * OWLA, and excluded or hidden paths never appear in a result.
 */

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

function page<T>(items:T[],offset:number){
 const slice=items.slice(offset,offset+PAGE);
 return {items:slice,total:items.length,...(offset+PAGE<items.length?{nextOffset:offset+PAGE}:{})};
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
 const outgoing=Object.keys(source.resolvedLinks[path]??{}).filter(source.allowed).sort();
 const unresolved=Object.keys(source.unresolvedLinks[path]??{}).sort();
 const backlinks=Object.entries(source.resolvedLinks)
  .filter(([from,targets])=>from!==path&&targets[path]&&source.allowed(from))
  .map(([from,targets])=>({path:from,count:targets[path]}))
  .sort((a,b)=>b.count-a.count||a.path.localeCompare(b.path));
 return {path,tags:source.tags(path),properties:source.properties(path)??{},outgoing,unresolved,backlinks:backlinks.slice(0,PAGE),backlinkCount:backlinks.length};
}

export function queryGraph(source:GraphSource,query:GraphQuery){
 const offset=Math.max(0,Math.floor(query.offset??0));
 if(query.path)return noteGraph(source,query.path);
 const notes=source.notes().filter(source.allowed).sort();
 if(query.tag){
  return {tag:normalTag(query.tag),...page(notes.filter(note=>source.tags(note).some(tag=>tagMatches(tag,query.tag!))),offset)};
 }
 if(query.property){
  const key=query.property.trim().toLowerCase();
  const matches=notes.flatMap(note=>{
   const props=source.properties(note)??{};
   const entry=Object.entries(props).find(([name])=>name.toLowerCase()===key);
   return entry&&valueMatches(entry[1],query.value)?[{path:note,value:entry[1]}]:[];
  });
  return {property:query.property,...(query.value!==undefined?{value:query.value}:{}),...page(matches,offset)};
 }
 if(query.report==='unresolved'){
  const rows=notes.flatMap(note=>Object.keys(source.unresolvedLinks[note]??{}).map(link=>({from:note,link})));
  return {report:'unresolved',...page(rows,offset)};
 }
 if(query.report==='orphans'){
  const linked=new Set<string>();
  for(const [from,targets] of Object.entries(source.resolvedLinks))if(source.allowed(from))for(const to of Object.keys(targets))if(to!==from)linked.add(to);
  return {report:'orphans',...page(notes.filter(note=>!linked.has(note)),offset)};
 }
 if(query.report==='tags'){
  const counts=new Map<string,number>();
  for(const note of notes)for(const tag of new Set(source.tags(note).map(normalTag)))counts.set(tag,(counts.get(tag)??0)+1);
  return {report:'tags',...page([...counts].map(([tag,count])=>({tag,count})).sort((a,b)=>b.count-a.count||a.tag.localeCompare(b.tag)),offset)};
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
 if(value.offset!==undefined){if(typeof value.offset!=='number')throw Error('offset must be a number.');query.offset=value.offset;}
 return query;
}
