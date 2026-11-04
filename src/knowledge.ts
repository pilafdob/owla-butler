import references from '../assets/reference-pack.json';
export const REFERENCE_NAMES=Object.keys(references);
export function readReference(name:string,offset=0):string{
 const value=(references as Record<string,string>)[name];if(typeof value!=='string')throw Error('Choose a bundled reference: '+REFERENCE_NAMES.join(', '));
 if(!Number.isSafeInteger(offset)||offset<0||offset>=value.length)throw Error('Reference offset is outside the document.');
 const end=Math.min(value.length,offset+1400);
 return `REFERENCE ${name} (${offset}–${end} of ${value.length} characters)\n${value.slice(offset,end)}`+(end<value.length?`\nRead the next passage at offset ${end}.`:'');
}

export function taskReference(request:string):{name:string;text:string}|null{
 if(/latex|math|equation|solve|algebra|gleichung|\\frac|\$/.test(request.toLowerCase())){const doc=(references as Record<string,string>)['obsidian-markdown'];const section=doc.split('## Math (LaTeX)')[1]?.split('\n## ')[0]??'';return {name:'obsidian-markdown / Math',text:section.trim().slice(0,500)};}
 if(/frontmatter|yaml|properties|wikilink|callout/.test(request.toLowerCase()))return {name:'obsidian-markdown',text:readReference('obsidian-markdown',0).slice(0,650)};
 return null;
}
