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
 const add=(link:string)=>{
  const target=link.split('|')[0].trim();
  if(!target||/^[a-z]+:/i.test(target))return;
  const hash=target.indexOf('#');
  const path=hash<0?target:target.slice(0,hash),subpath=hash<0?'':target.slice(hash);
  if(!found.some(item=>item.link===target))found.push({link:target,path,subpath});
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
