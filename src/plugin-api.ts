import type {Workspace} from 'obsidian';
import type {ToolSpec} from './codex';
import {record} from './validation';

type Value=string|boolean|null;
type Feature={key:string;label:string;kind:'icon'|'pin'|'toggle'|'color'};
type PluginDefinition={id:string;name:string;targeted:boolean;features:Feature[]};
const PLUGINS:PluginDefinition[]=[
 {id:'nicons',name:'Nicons',targeted:true,features:[{key:'icon',label:'Icon override',kind:'icon'}]},
 {id:'pinup',name:'Pinup',targeted:true,features:[{key:'pin',label:'Pin',kind:'pin'}]},
 {id:'folderandgraphs-plus',name:'Folder and Graphs Plus',targeted:false,features:[
  {key:'showFolderNodes',label:'Show folder nodes',kind:'toggle'},
  {key:'showHeadingNodes',label:'Show heading nodes',kind:'toggle'},
  {key:'weightNodesBySubtree',label:'Weight nodes by descendants',kind:'toggle'},
  {key:'nodeColor',label:'Default folder node colour',kind:'color'},
  {key:'headingNodeColor',label:'Default heading node colour',kind:'color'},
 ]},
];

const INSPECT='inspect_pilafdob_plugin';
const PROPOSE='propose_pilafdob_plugin_change';

type Provider={
 version:1;
 read:(key:string,path?:string)=>unknown;
 search?:(query:string)=>unknown;
 prepare:(key:string,path:string|undefined,value:Value)=>unknown;
};

export type PluginChange={
 plugin:string;
 target:string;
 path?:string;
 label:string;
 before:string;
 after:string;
 reason:string;
 apply:()=>Promise<void>;
};

function discover(workspace:Workspace,id:string):Provider|undefined {
 const replies:unknown[]=[];
 let receiving=true;
 workspace.trigger('pilafdob:'+id+':api:v1',(reply:unknown)=>{if(receiving)replies.push(reply);});
 receiving=false;
 if(replies.length!==1)return;
 const api=record(replies[0]);
 if(api.version===1&&typeof api.read==='function'&&typeof api.prepare==='function')return api as unknown as Provider;
}

function display(feature:Feature,value:Value):string {
 if(typeof value==='boolean')return value?'On':'Off';
 if(feature.kind==='pin')return value==='normal'?'Pinned':value==='pin-up'?'Pinned up':'Unpinned';
 return value??'Default icon';
}

function validValue(feature:Feature,value:unknown):value is Value {
 switch(feature.kind){
  case 'icon':return value===null||typeof value==='string'&&value.length>0&&value.length<=128;
  case 'pin':return value===null||value==='normal'||value==='pin-up';
  case 'toggle':return typeof value==='boolean';
  case 'color':return typeof value==='string'&&value.length<=32&&/^#[0-9a-f]{6}$/i.test(value.trim());
 }
}

export class PluginTurn {
 private readonly providers=new Map<string,Provider>();
 private readonly drafts=new Map<string,PluginChange>();
 readonly specs:ToolSpec[]=[];

 constructor(private readonly workspace:Workspace,private readonly allowedPath:(path:string)=>boolean,readonly enabled:()=>boolean) {
  if(!enabled())return;
  const available=PLUGINS.filter(plugin=>{
   const api=discover(workspace,plugin.id);
   if(!api)return false;
   this.providers.set(plugin.id,api);
   return true;
  });
  if(!available.length)return;
  const plugin={type:'string',enum:available.map(item=>item.id)};
  const fields={plugin,key:{type:'string',enum:available.flatMap(item=>item.features.map(feature=>feature.key))},path:{type:'string',maxLength:1024}};
  const options=available.map(item=>`${item.id}: ${item.features.map(feature=>feature.key).join(', ')}`).join('. ');
  this.specs=[
   {type:'function',name:INSPECT,description:`Read a plugin option. Options by plugin: ${options}. Use an exact vault path for Nicons and Pinup. For Nicons icon search, pass query in place of key and path.`,inputSchema:{type:'object',properties:{...fields,query:{type:'string',maxLength:100}},required:['plugin'],additionalProperties:false}},
   {type:'function',name:PROPOSE,description:`Stage a plugin change for user approval. Options by plugin: ${options}. Use an exact vault path for icons and pins. For icon use a searched ID or null to reset. For pin use normal, pin-up, or null to unpin. Graph visibility and weighting take booleans, and colours take #RRGGBB.`,inputSchema:{type:'object',properties:{...fields,value:{type:['string','boolean','null']},reason:{type:'string',maxLength:300}},required:['plugin','key','value','reason'],additionalProperties:false}},
  ];
 }

 get changes():readonly PluginChange[]{return this.enabled()?[...this.drafts.values()]:[];}

 handles(name:string){return name===INSPECT||name===PROPOSE;}

 invoke(name:string,input:unknown):string {
  const args=record(input);
  const plugin=PLUGINS.find(item=>item.id===args.plugin);
  if(!plugin)throw Error('Choose an available Pilafdob plugin.');
  const api=this.providers.get(plugin.id);
  const ensureAvailable=()=>{
   if(!this.enabled())throw Error('Plugin Interconnectivity was turned off. Start a new request to use it again.');
   if(!api||discover(this.workspace,plugin.id)!==api)throw Error(plugin.name+' was disabled or reloaded. Try again.');
   return api;
  };
  const provider=ensureAvailable();
  if(name===INSPECT&&args.query!==undefined){
   if(plugin.id!=='nicons'||args.key!==undefined||args.path!==undefined||!provider.search||typeof args.query!=='string'||!args.query.trim()||args.query.length>100)throw Error('Provide a Nicons search term of 1 to 100 characters.');
   const result=provider.search(args.query.trim());
   if(!Array.isArray(result))throw Error('Nicons returned invalid search results.');
   return JSON.stringify(result.slice(0,12).flatMap((item:unknown)=>{
    const {id,name}=record(item);
    return typeof id==='string'&&id.length<=128&&typeof name==='string'?[{id,name:name.slice(0,100)}]:[];
   }));
  }
  const feature=plugin.features.find(item=>item.key===args.key);
  if(!feature)throw Error('Choose a supported option for '+plugin.name+'.');
  const path=typeof args.path==='string'?args.path:undefined;
  const checkTarget=()=>{
   if(plugin.targeted){
    if(!path||path.length>1024||!this.allowedPath(path))throw Error('Choose an existing, allowed vault path.');
   }else if(args.path!==undefined)throw Error('Graph options apply to the vault and take no path.');
  };
  checkTarget();
  if(name===INSPECT){
   const value=provider.read(feature.key,path);
   if(!validValue(feature,value))throw Error(plugin.name+' returned an invalid option value.');
   return JSON.stringify({key:feature.key,path,value});
  }
  const {value,reason}=args;
  if(name!==PROPOSE||!validValue(feature,value)||typeof reason!=='string'||!reason.trim()||reason.length>300)throw Error('Provide a supported value and a short reason.');
  const key=JSON.stringify([plugin.id,feature.key,path]);
  if(this.drafts.size>=8&&!this.drafts.has(key))throw Error('Review up to eight plugin changes per reply.');
  const {before,after,apply}=record(provider.prepare(feature.key,path,value));
  if(!validValue(feature,before)||after!==value||typeof apply!=='function')throw Error(plugin.name+' returned an invalid preview.');
  if(before===after){this.drafts.delete(key);return 'The option already has this value.';}
  const commit=apply as ()=>Promise<void>;
  this.drafts.set(key,{
   plugin:plugin.name,target:path??plugin.name,path,label:feature.label,before:display(feature,before),after:display(feature,value),reason:reason.trim(),
   apply:async()=>{ensureAvailable();checkTarget();await commit();},
  });
  return 'Proposed for review. The user must accept this change before it is applied.';
 }
}
