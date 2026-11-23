// A small block-style YAML reader/writer for tests, close enough to Obsidian's
// parseYaml/stringifyYaml for frontmatter: scalars, quoted text, flow and block
// lists, comments, and dates parsed as Date like js-yaml's default schema.
import type {Yaml} from '../../src/note-tools';

function scalar(raw:string):unknown{
 const text=raw.trim();
 if(text===''||text==='null'||text==='~')return null;
 if(text==='true'||text==='false')return text==='true';
 if(/^-?\d+(\.\d+)?$/.test(text))return Number(text);
 if(/^\d{4}-\d{2}-\d{2}$/.test(text))return new Date(text+'T00:00:00Z');
 if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text))return new Date(text+'Z');
 if(text.startsWith('"'))return JSON.parse(text);
 if(text.startsWith("'"))return text.slice(1,-1).replace(/''/g,"'");
 if(text.startsWith('['))return text.slice(1,-1).split(',').map(item=>item.trim()).filter(Boolean).map(scalar);
 if(text.startsWith('{'))throw Error('flow mappings are not supported by the test YAML');
 return text;
}

export function parse(text:string):unknown{
 const out:Record<string,unknown>={};
 let list:unknown[]|null=null;
 for(const line of text.split(/\r?\n/)){
  if(!line.trim()||/^\s*#/.test(line))continue;
  const item=line.match(/^\s*- ?(.*)$/);
  if(item&&list){list.push(scalar(item[1]));continue;}
  const entry=line.match(/^("[^"]*"|'[^']*'|[^\s#][^:]*?):(?:\s+(.*))?$/);
  if(!entry)throw Error('bad YAML line: '+line);
  const key=entry[1].replace(/^["']|["']$/g,'');
  if(entry[2]===undefined||entry[2].trim()===''){list=[];out[key]=list;continue;}
  list=null;out[key]=scalar(entry[2].replace(/\s+#.*$/,''));
 }
 // An empty block list is a null value, as in YAML.
 for(const [key,value] of Object.entries(out))if(Array.isArray(value)&&!value.length&&!/\[\]/.test(text))out[key]=null;
 return out;
}

function write(value:unknown):string{
 if(value===null)return '';
 if(typeof value==='string')return /^[\w][\w .,/-]*$/.test(value)&&!/^(true|false|null|-?\d+(\.\d+)?|\d{4}-\d{2}-\d{2}.*)$/.test(value)?value:JSON.stringify(value);
 if(value instanceof Date)return value.toISOString();
 return String(value);
}

export function stringify(value:unknown):string{
 const lines:string[]=[];
 for(const [key,item] of Object.entries(value as Record<string,unknown>)){
  const name=/^[\w][\w -]*$/.test(key)?key:JSON.stringify(key);
  if(Array.isArray(item)){
   if(!item.length){lines.push(name+': []');continue;}
   lines.push(name+':',...item.map(entry=>'  - '+write(entry)));
  }else lines.push((name+': '+write(item)).replace(/ $/,''));
 }
 return lines.join('\n')+'\n';
}

export const miniYaml:Yaml={parse,stringify};
