/**
 * Obsidian Bases (.base) files: YAML structure checks and a summary a model can
 * read. Formula and view validation is done by Obsidian's own Bases engine in
 * main.ts; this module catches structural mistakes before that and without it.
 */
const TOP_LEVEL=new Set(['filters','formulas','properties','summaries','views']);
const CORE_VIEWS=new Set(['table','cards','list','map']);

const isMap=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);

export type BaseView={type:string;name:string;[key:string]:unknown};
export type BaseData={filters?:unknown;formulas?:Record<string,string>;properties?:Record<string,unknown>;summaries?:Record<string,string>;views?:BaseView[];[key:string]:unknown};

export function parseBase(text:string,parseYaml:(text:string)=>unknown):BaseData{
 if(!text.trim())return {};
 let value:unknown;
 try{value=parseYaml(text);}catch(error){throw Error('This base is not valid YAML: '+(error instanceof Error?error.message:String(error)));}
 if(value===null||value===undefined)return {};
 if(!isMap(value))throw Error('A base must be a YAML mapping with filters, formulas, properties and views.');
 return value;
}

function filterProblems(value:unknown,at:string,problems:string[]){
 if(typeof value==='string'){if(!value.trim())problems.push(at+' is an empty filter');return;}
 if(!isMap(value)){problems.push(at+' must be a filter expression or an and/or/not list');return;}
 const keys=Object.keys(value);
 if(keys.length!==1||!['and','or','not'].includes(keys[0])){problems.push(at+' must have exactly one of and, or, not');return;}
 const list=value[keys[0]];
 if(!Array.isArray(list)||!list.length){problems.push(at+'.'+keys[0]+' must be a non-empty list');return;}
 list.forEach((item,index)=>filterProblems(item,at+'.'+keys[0]+'['+index+']',problems));
}

/** Structural problems; empty when the shape is valid. Unknown view types are left to the engine (plugins add views). */
export function baseProblems(data:BaseData):string[]{
 const problems:string[]=[];
 for(const key of Object.keys(data))if(!TOP_LEVEL.has(key))problems.push('unknown top-level key '+JSON.stringify(key)+' (use filters, formulas, properties, summaries, views)');
 if(data.filters!==undefined)filterProblems(data.filters,'filters',problems);
 for(const section of ['formulas','summaries'] as const){
  const value=data[section];
  if(value===undefined)continue;
  if(!isMap(value)){problems.push(section+' must be a mapping of name: expression');continue;}
  for(const [name,expression] of Object.entries(value))if(typeof expression!=='string'||!expression.trim())problems.push(section+'.'+name+' must be an expression string');
 }
 if(data.properties!==undefined&&!isMap(data.properties))problems.push('properties must be a mapping');
 if(data.views!==undefined){
  if(!Array.isArray(data.views))problems.push('views must be a list');
  else data.views.forEach((view,index)=>{
   const at='views['+index+']';
   if(!isMap(view)){problems.push(at+' must be a mapping');return;}
   if(typeof view.type!=='string'||!view.type)problems.push(at+' needs a type ('+[...CORE_VIEWS].join(', ')+')');
   if(typeof view.name!=='string'||!view.name)problems.push(at+' needs a name');
   if(view.filters!==undefined)filterProblems(view.filters,at+'.filters',problems);
   if(view.order!==undefined&&(!Array.isArray(view.order)||!view.order.every(item=>typeof item==='string')))problems.push(at+'.order must be a list of property names');
   if(view.limit!==undefined&&(!Number.isInteger(view.limit)||(view.limit as number)<1))problems.push(at+'.limit must be a positive integer');
  });
 }
 return problems;
}

/** Property references (note.x, formula.y, file.z or bare names) used anywhere in the base. */
export function baseReferences(data:BaseData):string[]{
 const found=new Set<string>();
 const scan=(value:unknown)=>{
  if(typeof value==='string')for(const match of value.matchAll(/\b(note|formula|file)\.([A-Za-z_][\w-]*)/g))found.add(match[1]+'.'+match[2]);
  else if(Array.isArray(value))value.forEach(scan);
  else if(isMap(value))Object.values(value).forEach(scan);
 };
 scan(data.filters);scan(data.formulas);scan(data.summaries);
 for(const view of Array.isArray(data.views)?data.views:[]){scan(view.filters);for(const name of Array.isArray(view.order)?view.order:[])if(typeof name==='string')found.add(name.includes('.')?name:'note.'+name);}
 return [...found].sort();
}

export function summarizeBase(data:BaseData):string{
 const lines=['Base: '+(Array.isArray(data.views)?data.views.length:0)+' views, '+Object.keys(isMap(data.formulas)?data.formulas:{}).length+' formulas.'];
 if(data.filters!==undefined)lines.push('Filters: '+JSON.stringify(data.filters));
 for(const [name,expression] of Object.entries(isMap(data.formulas)?data.formulas:{}))lines.push('Formula '+name+': '+String(expression));
 for(const view of Array.isArray(data.views)?data.views:[]){
  lines.push('View '+JSON.stringify(view.name)+' ('+view.type+')'+(view.filters!==undefined?' filters '+JSON.stringify(view.filters):'')+(Array.isArray(view.order)?' columns '+view.order.join(', '):'')+(typeof view.limit==='number'?' limit '+String(view.limit):''));
 }
 return lines.join('\n');
}
