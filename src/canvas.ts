/**
 * Obsidian Canvas (JSON Canvas 1.0) files: parse, validate, summarise for a
 * model and apply reviewed structural operations. Pure functions; the vault
 * and Obsidian's renderer are handled by the caller.
 * Spec: https://jsoncanvas.org/spec/1.0/
 */
import {record} from './validation';

export type CanvasSide='top'|'right'|'bottom'|'left';
export type CanvasNode={id:string;type:'text'|'file'|'link'|'group';x:number;y:number;width:number;height:number;color?:string;text?:string;file?:string;subpath?:string;url?:string;label?:string;background?:string;backgroundStyle?:string;[key:string]:unknown};
export type CanvasEdge={id:string;fromNode:string;toNode:string;fromSide?:CanvasSide;toSide?:CanvasSide;fromEnd?:'none'|'arrow';toEnd?:'none'|'arrow';color?:string;label?:string;[key:string]:unknown};
export type CanvasData={nodes:CanvasNode[];edges:CanvasEdge[];[key:string]:unknown};

const NODE_TYPES=new Set(['text','file','link','group']);
const SIDES=new Set(['top','right','bottom','left']);
const ENDS=new Set(['none','arrow']);
const COLOR=/^(?:[1-6]|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})$/;

/** Parses canvas text. An empty file is an empty canvas, as Obsidian treats it. */
export function parseCanvas(text:string):CanvasData{
 if(!text.trim())return {nodes:[],edges:[]};
 let value:unknown;
 try{value=JSON.parse(text);}catch(error){throw Error('This canvas is not valid JSON: '+(error instanceof Error?error.message:String(error)));}
 const data=record(value);
 if(value===null||typeof value!=='object'||Array.isArray(value))throw Error('A canvas must be a JSON object.');
 const nodes=data.nodes===undefined?[]:data.nodes,edges=data.edges===undefined?[]:data.edges;
 if(!Array.isArray(nodes)||!Array.isArray(edges))throw Error('Canvas nodes and edges must be arrays.');
 return {...data,nodes:nodes as CanvasNode[],edges:edges as CanvasEdge[]};
}

/** Every rule a canvas must meet; returns problems, empty when valid. */
export function canvasProblems(data:CanvasData):string[]{
 const problems:string[]=[],ids=new Set<string>();
 for(const [index,node] of data.nodes.entries()){
  const at='node '+(typeof node?.id==='string'?node.id:'#'+index);
  if(!node||typeof node!=='object'){problems.push(at+' is not an object');continue;}
  if(typeof node.id!=='string'||!node.id)problems.push(at+' needs a string id');
  else if(ids.has(node.id))problems.push(at+' repeats an id');
  else ids.add(node.id);
  if(!NODE_TYPES.has(node.type))problems.push(at+' has unknown type '+JSON.stringify(node.type));
  for(const key of ['x','y','width','height'] as const)if(typeof node[key]!=='number'||!Number.isFinite(node[key]))problems.push(at+' needs a number '+key);
  if(typeof node.width==='number'&&node.width<=0||typeof node.height==='number'&&node.height<=0)problems.push(at+' needs a positive size');
  if(node.color!==undefined&&(typeof node.color!=='string'||!COLOR.test(node.color)))problems.push(at+' color must be "1"–"6" or a hex colour');
  if(node.type==='text'&&typeof node.text!=='string')problems.push(at+' (text) needs text');
  if(node.type==='file'&&(typeof node.file!=='string'||!node.file))problems.push(at+' (file) needs a file path');
  if(node.type==='link'&&(typeof node.url!=='string'||!/^https?:\/\//i.test(node.url)))problems.push(at+' (link) needs an http(s) url');
  if(node.type==='group'&&node.label!==undefined&&typeof node.label!=='string')problems.push(at+' (group) label must be text');
 }
 const edgeIds=new Set<string>();
 for(const [index,edge] of data.edges.entries()){
  const at='edge '+(typeof edge?.id==='string'?edge.id:'#'+index);
  if(!edge||typeof edge!=='object'){problems.push(at+' is not an object');continue;}
  if(typeof edge.id!=='string'||!edge.id)problems.push(at+' needs a string id');
  else if(edgeIds.has(edge.id)||ids.has(edge.id))problems.push(at+' repeats an id');
  else edgeIds.add(edge.id);
  if(!ids.has(edge.fromNode))problems.push(at+' starts at missing node '+JSON.stringify(edge.fromNode));
  if(!ids.has(edge.toNode))problems.push(at+' ends at missing node '+JSON.stringify(edge.toNode));
  for(const key of ['fromSide','toSide'] as const)if(edge[key]!==undefined&&!SIDES.has(edge[key]))problems.push(at+' '+key+' must be top, right, bottom or left');
  for(const key of ['fromEnd','toEnd'] as const)if(edge[key]!==undefined&&!ENDS.has(edge[key]))problems.push(at+' '+key+' must be none or arrow');
  if(edge.color!==undefined&&(typeof edge.color!=='string'||!COLOR.test(edge.color)))problems.push(at+' color must be "1"–"6" or a hex colour');
  if(edge.label!==undefined&&typeof edge.label!=='string')problems.push(at+' label must be text');
 }
 return problems;
}

const inside=(node:CanvasNode,group:CanvasNode)=>node!==group&&node.x>=group.x&&node.y>=group.y&&node.x+node.width<=group.x+group.width&&node.y+node.height<=group.y+group.height;

/** A model-readable description: every node with its group, every edge with its ends. */
export function summarizeCanvas(data:CanvasData):string{
 const groups=data.nodes.filter(node=>node.type==='group');
 const byId=new Map(data.nodes.map(node=>[node.id,node]));
 const name=(node:CanvasNode|undefined)=>!node?'?':node.type==='text'?JSON.stringify((node.text??'').split('\n')[0].slice(0,60)):node.type==='file'?node.file+(node.subpath??''):node.type==='link'?node.url:'group '+JSON.stringify(node.label??'');
 const lines=['Canvas: '+data.nodes.length+' nodes ('+groups.length+' groups), '+data.edges.length+' edges. Coordinates are canvas pixels; x grows right, y grows down.'];
 for(const node of data.nodes){
  const parents=groups.filter(group=>inside(node,group)).sort((a,b)=>a.width*a.height-b.width*b.height);
  const head='- ['+node.id+'] '+node.type+' at ('+node.x+','+node.y+') '+node.width+'×'+node.height+(node.color?' color '+node.color:'')+(parents.length?' in group '+parents[0].id:'');
  const body=node.type==='text'?'\n  text: '+JSON.stringify(node.text??''):node.type==='file'?'\n  file: '+node.file+(node.subpath??''):node.type==='link'?'\n  url: '+node.url:'\n  label: '+JSON.stringify(node.label??'');
  lines.push(head+body);
 }
 for(const edge of data.edges){
  lines.push('- edge ['+edge.id+'] '+edge.fromNode+(edge.fromSide?'.'+edge.fromSide:'')+' → '+edge.toNode+(edge.toSide?'.'+edge.toSide:'')+' ('+name(byId.get(edge.fromNode))+' → '+name(byId.get(edge.toNode))+')'+(edge.label?' label '+JSON.stringify(edge.label):'')+(edge.toEnd==='none'?' no arrow':'')+(edge.color?' color '+edge.color:''));
 }
 return lines.join('\n');
}

export type CanvasOperation=
 |{op:'add_node';node:Partial<CanvasNode>}
 |{op:'update_node';id:string;changes:Partial<CanvasNode>}
 |{op:'remove_node';id:string}
 |{op:'add_edge';edge:Partial<CanvasEdge>}
 |{op:'update_edge';id:string;changes:Partial<CanvasEdge>}
 |{op:'remove_edge';id:string};

/** A 16-hex-digit id like the ones Obsidian writes, unique within the canvas. */
export function canvasId(taken:Set<string>,random:()=>number=Math.random):string{
 for(let attempt=0;attempt<32;attempt++){const id=Array.from({length:16},()=>Math.floor(random()*16).toString(16)).join('');if(!taken.has(id)){taken.add(id);return id;}}
 // A poor random source cannot loop forever: count up from a fixed prefix instead.
 for(let n=taken.size;;n++){const id=('owla'+n.toString(16)).padEnd(16,'0').slice(0,16);if(!taken.has(id)){taken.add(id);return id;}}
}

/**
 * Applies operations in order and validates the result. Removing a node also
 * removes its edges. Nothing is written; the caller stages the new text.
 */
export function applyCanvasOperations(data:CanvasData,operations:unknown,random:()=>number=Math.random):CanvasData{
 if(!Array.isArray(operations)||!operations.length||operations.length>200)throw Error('Provide between 1 and 200 canvas operations.');
 const next:CanvasData=structuredClone(data);
 const taken=new Set([...next.nodes.map(node=>node.id),...next.edges.map(edge=>edge.id)]);
 const protectedKeys=new Set(['id']);
 for(const [index,raw] of (operations as unknown[]).entries()){
  const operation=record(raw),at='operation '+(index+1);
  const changes=(value:unknown)=>{const object=record(value);for(const key of Object.keys(object))if(protectedKeys.has(key))throw Error(at+': the id cannot be changed.');return object;};
  if(operation.op==='add_node'){
   const node={...record(operation.node)} as CanvasNode;
   // The id may be given on the operation or on the node, so later operations can refer to it.
   if((typeof node.id!=='string'||!node.id)&&typeof operation.id==='string'&&operation.id)node.id=operation.id;
   if(typeof node.id!=='string'||!node.id)node.id=canvasId(taken,random);
   else if(taken.has(node.id))throw Error(at+': id '+node.id+' already exists.');
   else taken.add(node.id);
   if(node.type==='group'){next.nodes.unshift(node);}else next.nodes.push(node);
  }else if(operation.op==='update_node'){
   const node=next.nodes.find(item=>item.id===operation.id);
   if(!node)throw Error(at+': no node '+JSON.stringify(operation.id)+'.');
   Object.assign(node,changes(operation.changes));
   for(const [key,value] of Object.entries(node))if(value===null)delete node[key];
  }else if(operation.op==='remove_node'){
   if(!next.nodes.some(item=>item.id===operation.id))throw Error(at+': no node '+JSON.stringify(operation.id)+'.');
   next.nodes=next.nodes.filter(item=>item.id!==operation.id);
   next.edges=next.edges.filter(edge=>edge.fromNode!==operation.id&&edge.toNode!==operation.id);
  }else if(operation.op==='add_edge'){
   const edge={...record(operation.edge)} as CanvasEdge;
   if((typeof edge.id!=='string'||!edge.id)&&typeof operation.id==='string'&&operation.id)edge.id=operation.id;
   if(typeof edge.id!=='string'||!edge.id)edge.id=canvasId(taken,random);
   else if(taken.has(edge.id))throw Error(at+': id '+edge.id+' already exists.');
   else taken.add(edge.id);
   next.edges.push(edge);
  }else if(operation.op==='update_edge'){
   const edge=next.edges.find(item=>item.id===operation.id);
   if(!edge)throw Error(at+': no edge '+JSON.stringify(operation.id)+'.');
   Object.assign(edge,changes(operation.changes));
   for(const [key,value] of Object.entries(edge))if(value===null)delete edge[key];
  }else if(operation.op==='remove_edge'){
   if(!next.edges.some(item=>item.id===operation.id))throw Error(at+': no edge '+JSON.stringify(operation.id)+'.');
   next.edges=next.edges.filter(item=>item.id!==operation.id);
  }else throw Error(at+': unknown op '+JSON.stringify(operation.op)+'. Use add_node, update_node, remove_node, add_edge, update_edge or remove_edge.');
 }
 const problems=canvasProblems(next);
 if(problems.length)throw Error('The canvas would be invalid: '+problems.slice(0,8).join('; ')+(problems.length>8?'; …':'')+'.');
 return next;
}

/** Serialises like Obsidian (tab-indented JSON), keeping the file's own indentation when it differs. */
export function serializeCanvas(data:CanvasData,original=''):string{
 const indent=original.match(/^\{\r?\n([ \t]+)"/)?.[1]??'\t';
 return JSON.stringify(data,null,indent);
}
