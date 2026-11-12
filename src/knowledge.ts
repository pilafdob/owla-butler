import references from '../assets/reference-pack.json';
export const REFERENCE_NAMES=Object.keys(references);
export function readReference(name:string,offset=0):string{
 const value=(references as Record<string,string>)[name];if(typeof value!=='string')throw Error('Choose a bundled reference: '+REFERENCE_NAMES.join(', '));
 if(!Number.isSafeInteger(offset)||offset<0||offset>=value.length)throw Error('Reference offset is outside the document.');
 const end=Math.min(value.length,offset+1400);
 return `REFERENCE ${name} (${offset}–${end} of ${value.length} characters)\n${value.slice(offset,end)}`+(end<value.length?`\nRead the next passage at offset ${end}.`:'');
}

export interface SkillDefinition {id:string;name:string;description:string;content:string;}

// The bundled Obsidian skills and the OWLA guides. Codex reads them through
// read_reference; OpenCode registers them as native skills with the same IDs.
const SKILL_IDS=['obsidian-markdown','obsidian-bases','json-canvas','owla-formatting','owla-math','owla-mermaid','owla-ocr','owla-pdf'];
const SKILL_FALLBACK:Record<string,{name:string;description:string}>={
 'owla-formatting':{name:'OWLA formatting',description:'Native Obsidian Markdown formatting, including coloured highlights and list conventions.'},
 'owla-math':{name:'OWLA math',description:'MathJax-compatible LaTeX for Obsidian notes, with transcription and solving rules.'},
 'owla-mermaid':{name:'OWLA Mermaid',description:'Mermaid diagrams inside Obsidian Markdown fences.'},
 'owla-ocr':{name:'OWLA OCR',description:'Faithful transcription of screenshots and images into Obsidian Markdown and LaTeX.'},
 'owla-pdf':{name:'OWLA PDF',description:'Reading, transcribing and citing PDF pages, text layers and scanned pages.'}
};
function frontmatter(body:string){
 const match=body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
 if(!match)return {name:'',description:''};
 const read=(key:string)=>{
  const line=match[1].split(/\r?\n/).find(item=>item.startsWith(key+':'));
  return line?line.slice(key.length+1).trim().replace(/^["']|["']$/g,''):'';
 };
 return {name:read('name'),description:read('description')};
}
export function skillDefinitions():SkillDefinition[]{
 return SKILL_IDS.map(id=>{
  const body=(references as Record<string,string>)[id]??'';
  const meta=frontmatter(body);
  const fallback=SKILL_FALLBACK[id]??{name:id,description:''};
  const extras=Object.keys(references).filter(key=>key.startsWith(id+'/')).sort();
  const content=[body,...extras.map(key=>'# '+key.slice(key.lastIndexOf('/')+1).replace(/_/g,' ')+'\n\n'+(references as Record<string,string>)[key])].join('\n\n');
  return {id,name:meta.name||fallback.name,description:meta.description||fallback.description,content};
 });
}

export function taskReference(request:string):{name:string;text:string}|null{
 if(/\b(mermaid|diagrams?|flowcharts?|graphs?|sequence diagram|timelines?|diagramm|flussdiagramm)\b/i.test(request))return {name:'owla-mermaid',text:readReference('owla-mermaid')};
 if(/highlight|formatting|formatier|markier/i.test(request))return {name:'owla-formatting',text:readReference('owla-formatting')};
 if(/latex|math|equation|solve|algebra|gleichung|\\frac|\$/.test(request.toLowerCase())){const doc=(references as Record<string,string>)['obsidian-markdown'];const section=doc.split('## Math (LaTeX)')[1]?.split('\n## ')[0]??'';return {name:'obsidian-markdown / Math',text:section.trim().slice(0,500)};}
 if(/frontmatter|yaml|properties|wikilink|callout/.test(request.toLowerCase()))return {name:'obsidian-markdown',text:readReference('obsidian-markdown',0).slice(0,650)};
 return null;
}
