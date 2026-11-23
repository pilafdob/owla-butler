/**
 * Obsidian Excalidraw drawings in every form the plugin opens: `.excalidraw.md`
 * and `.excalidraw` files, and plain `.md` notes with the `excalidraw-plugin`
 * frontmatter key. Parses the file, summarises the scene for a model, applies
 * reviewed operations and writes the file back in the format the plugin reads
 * (Markdown wrapper or plain JSON). New elements are built by an injected
 * factory (the plugin's ExcalidrawAutomate in main.ts), so they carry every
 * field Excalidraw expects. Pure functions otherwise.
 */
import {record} from './validation';

export type ExcalidrawElement={id:string;type:string;x:number;y:number;width:number;height:number;isDeleted?:boolean;text?:string;originalText?:string;rawText?:string;containerId?:string|null;boundElements?:{id:string;type:string}[]|null;startBinding?:{elementId:string}|null;endBinding?:{elementId:string}|null;frameId?:string|null;groupIds?:string[];link?:string|null;fileId?:string;name?:string;strokeColor?:string;backgroundColor?:string;version?:number;versionNonce?:number;updated?:number;[key:string]:unknown};
export type ExcalidrawScene={type?:string;version?:number;source?:string;elements:ExcalidrawElement[];appState?:Record<string,unknown>;files?:Record<string,unknown>;[key:string]:unknown};

export const EXCALIDRAW_SUFFIX='.excalidraw.md';
const EXCALIDRAW_JSON_SUFFIX='.excalidraw';
/** A path the Excalidraw plugin opens as a drawing: `.excalidraw.md` and `.excalidraw` files. */
export const isExcalidrawPath=(path:string)=>path.toLowerCase().endsWith(EXCALIDRAW_SUFFIX)||path.toLowerCase().endsWith(EXCALIDRAW_JSON_SUFFIX);
/** A `.excalidraw` file: the scene as plain JSON, without the Markdown wrapper. */
export const isExcalidrawJsonPath=(path:string)=>path.toLowerCase().endsWith(EXCALIDRAW_JSON_SUFFIX);

const DRAWING=/(## Drawing\r?\n```(compressed-json|json)\r?\n)([\s\S]*?)(\r?\n```)/;
const TEXT_SECTION=/(## Text Elements\r?\n)([\s\S]*?)(?=\r?\n## |\r?\n%%|$)/;

export type ExcalidrawFile={text:string;compressed:boolean;scene:ExcalidrawScene};

/** True when the text is a `.excalidraw` file: a JSON scene object. */
export function isExcalidrawJson(text:string){const head=text.trimStart().slice(0,400);return head.startsWith('{')&&/"type"\s*:\s*"excalidraw"/.test(head);}
/** True when a plain Markdown note is a drawing: the `excalidraw-plugin` frontmatter key, the plugin's own test. */
export function isExcalidrawNote(text:string){
 if(!text.startsWith('---'))return false;
 const head=text.slice(0,2000),close=head.indexOf('\n---');
 return close>0&&/^excalidraw-plugin:/m.test(head.slice(0,close));
}

/** True when the text is an Excalidraw plugin drawing (JSON scene, frontmatter key or drawing block). */
/**
 * A drawing's text: a JSON scene, a note whose own frontmatter carries the
 * excalidraw-plugin key, or a `## Drawing` data fence. A plain note that only
 * mentions `excalidraw-plugin:` after a horizontal rule or in a code example is
 * not a drawing (it must stay readable with read_note).
 */
export function isExcalidrawText(text:string){return isExcalidrawJson(text)||isExcalidrawNote(text.replace(/^\uFEFF/,''))||DRAWING.test(text);}

/** Reads the scene. Compressed drawings need the plugin's LZ-string decoder. */
const sceneOf=(value:unknown):ExcalidrawScene=>{
 const scene=record(value);
 if(!Array.isArray(scene.elements))throw Error('The drawing data has no elements list.');
 if(scene.elements.some(element=>!element||typeof element!=='object'))throw Error('The drawing data contains an element that is not an object; the file may be damaged.');
 return scene as ExcalidrawScene;
};
export function parseExcalidraw(text:string,decompress?:(data:string)=>string):ExcalidrawFile{
 if(text.trimStart().startsWith('{')){
  let value:unknown;
  try{value=JSON.parse(text);}catch(error){throw Error('The drawing data is not valid JSON: '+(error instanceof Error?error.message:String(error)));}
  return {text,compressed:false,scene:sceneOf(value)};
 }
 const match=text.match(DRAWING);
 if(!match)throw Error('This file has no Excalidraw drawing block. Open it once in Excalidraw so the plugin writes one.');
 const compressed=match[2]==='compressed-json';
 let json=match[3];
 if(compressed){
  if(!decompress)throw Error('The drawing is compressed; the Excalidraw plugin is needed to read it.');
  json=decompress(json.replace(/\s+/g,''));
  if(!json)throw Error('The compressed drawing could not be decoded.');
 }
 let value:unknown;
 try{value=JSON.parse(json);}catch(error){throw Error('The drawing data is not valid JSON: '+(error instanceof Error?error.message:String(error)));}
 return {text,compressed,scene:sceneOf(value)};
}

const live=(scene:ExcalidrawScene)=>scene.elements.filter(element=>!element.isDeleted);
const label=(element:ExcalidrawElement)=>element.originalText??element.text??'';
/** boundElements as an array, tolerating a damaged drawing that stores something else. */
const boundList=(element:ExcalidrawElement)=>Array.isArray(element.boundElements)?element.boundElements:[];

/** Bound text of a container, or the element itself when it is text. */
export function textOf(scene:ExcalidrawScene,element:ExcalidrawElement):ExcalidrawElement|undefined{
 if(element.type==='text')return element;
 const bound=boundList(element).find(item=>item&&item.type==='text');
 return bound?scene.elements.find(item=>item.id===bound.id&&!item.isDeleted):undefined;
}

/** How many cluster member ids a summary lists before folding the rest into a count. */
const CLUSTER_IDS_SHOWN=2;
/** Grid cell size (scene pixels) that joins nearby strokes into one ink cluster. */
const INK_CELL=160;
/**
 * Largest cluster region (scene pixels). Dense handwriting chains into one
 * group, so a larger group is split into tiles of this size by stroke centre:
 * each cluster then marks where its ink is, and the model can replace it in place.
 */
const INK_TILE_W=240,INK_TILE_H=120;
/** delete_cluster name for every ink cluster at once. */
export const ALL_INK='all';
export type InkCluster={cluster:string;count:number;x:number;y:number;width:number;height:number;ids:string[]};

/**
 * Groups live freedraw strokes by proximity so a summary lists handwriting as
 * clusters instead of one unreadable line per stroke. Clusters come from
 * positions only, so they are deterministic for one scene: the same scene
 * always yields the same names (c1, c2, …). `delete_cluster` resolves names
 * against the scene the proposal starts from (the one read_excalidraw listed),
 * so deleting c1 does not renumber c2 within the same proposal. Strokes touching the
 * same grid cell (through their bounding box) belong to one cluster.
 */
export function inkClusters(scene:ExcalidrawScene):InkCluster[]{
 const strokes=live(scene).filter(element=>element.type==='freedraw');
 const parent=strokes.map((_element,index)=>index);
 const find=(n:number):number=>{while(parent[n]!==n){parent[n]=parent[parent[n]];n=parent[n];}return n;};
 const union=(a:number,b:number)=>{const rootA=find(a),rootB=find(b);if(rootA!==rootB)parent[rootA]=rootB;};
 const cells=new Map<number,number[]>();
 for(const [index,element] of strokes.entries()){
  const x0=Math.floor(element.x/INK_CELL),y0=Math.floor(element.y/INK_CELL);
  const x1=Math.floor((element.x+Math.max(0,element.width))/INK_CELL),y1=Math.floor((element.y+Math.max(0,element.height))/INK_CELL);
  for(let cy=y0;cy<=y1;cy++)for(let cx=x0;cx<=x1;cx++){const key=(cy+1)*1_048_576+cx;const cell=cells.get(key);if(cell)cell.push(index);else cells.set(key,[index]);}
 }
 for(const members of cells.values())for(let i=1;i<members.length;i++)union(members[0],members[i]);
 const groups=new Map<number,number[]>();
 for(let index=0;index<strokes.length;index++){const root=find(index);const group=groups.get(root);if(group)group.push(index);else groups.set(root,[index]);}
 const box=(members:number[])=>{
  let x=Infinity,y=Infinity,x2=-Infinity,y2=-Infinity;
  for(const index of members){const element=strokes[index];x=Math.min(x,element.x);y=Math.min(y,element.y);x2=Math.max(x2,element.x+element.width);y2=Math.max(y2,element.y+element.height);}
  return {x,y,width:x2-x,height:y2-y};
 };
 const parts:number[][]=[];
 for(const members of groups.values()){
  const area=box(members);
  if(area.width<=INK_TILE_W&&area.height<=INK_TILE_H){parts.push(members);continue;}
  // Tiles row by row, top to bottom, so names read like the drawing.
  const tiles=new Map<number,number[]>();
  for(const index of members){
   const element=strokes[index],cx=element.x+element.width/2,cy=element.y+element.height/2;
   const key=Math.floor((cy-area.y)/INK_TILE_H)*100_000+Math.floor((cx-area.x)/INK_TILE_W);
   const tile=tiles.get(key);if(tile)tile.push(index);else tiles.set(key,[index]);
  }
  for(const key of [...tiles.keys()].sort((a,b)=>a-b))parts.push(tiles.get(key)!);
 }
 const clusters:InkCluster[]=[];let n=0;
 for(const members of parts){
  members.sort((a,b)=>a-b); // scene order
  clusters.push({cluster:'c'+(++n),count:members.length,...box(members),ids:members.map(index=>strokes[index].id)});
 }
 return clusters;
}

/** One line per element: what it is, where, what it says and what it connects. Freedraw ink collapses into proximity clusters. */
export function describeElements(scene:ExcalidrawScene,files:Record<string,string>={},budget=EXCALIDRAW_SUMMARY_LIMIT):string[]{
 const byId=new Map(scene.elements.map(element=>[element.id,element]));
 const named=(id?:string|null)=>{const element=id?byId.get(id):undefined;if(!element)return id??'?';const text=textOf(scene,element);return '['+element.id+']'+(text?' '+JSON.stringify(label(text).slice(0,40)):'');};
 const lines:string[]=[];let spent=0;let skipped=0;
 const push=(line:string)=>{if(spent<=budget){spent+=line.length;lines.push(line);}else skipped++;};
 const clusters=inkClusters(scene);
 const clusterOf=new Map<string,InkCluster>();for(const cluster of clusters)for(const id of cluster.ids)clusterOf.set(id,cluster);
 const emitted=new Set<InkCluster>();
 for(const entry of live(scene).filter(element=>!(element.type==='text'&&element.containerId))){
  if(entry.type==='freedraw'){
   const cluster=clusterOf.get(entry.id);
   if(!cluster){push('- freedraw ['+entry.id+'] at ('+Math.round(entry.x)+','+Math.round(entry.y)+') '+Math.round(entry.width)+'×'+Math.round(entry.height));continue;}
   // All ink is listed together at the first stroke, in cluster-name order (top to bottom).
   if(emitted.size)continue;
   for(const item of clusters){
    emitted.add(item);
    if(item.count===1){const stroke=byId.get(item.ids[0])!;push('- freedraw ['+stroke.id+'] at ('+Math.round(stroke.x)+','+Math.round(stroke.y)+') '+Math.round(stroke.width)+'×'+Math.round(stroke.height));continue;}
    const ids=item.ids.slice(0,CLUSTER_IDS_SHOWN);
    const tail=ids.length<item.ids.length?' +'+(item.ids.length-ids.length)+' more':'';
    push('- ink cluster '+item.cluster+': '+item.count+' strokes at ('+Math.round(item.x)+','+Math.round(item.y)+') '+Math.round(item.width)+'×'+Math.round(item.height)+' ids=['+ids.join(', ')+tail+']');
   }
   continue;
  }
  const element=byId.get(entry.id)!;
  const where=' at ('+Math.round(element.x)+','+Math.round(element.y)+') '+Math.round(element.width)+'×'+Math.round(element.height);
  const text=textOf(scene,element);
  const parts=[element.type+' ['+element.id+']'+where];
  if(text)parts.push('text '+JSON.stringify(label(text)));
  if(element.type==='arrow'||element.type==='line'){if(element.startBinding||element.endBinding)parts.push('from '+named(element.startBinding?.elementId)+' to '+named(element.endBinding?.elementId));}
  if(element.type==='frame')parts.push('frame '+JSON.stringify(element.name??''));
  if(element.frameId)parts.push('in frame ['+element.frameId+']');
  if(Array.isArray(element.groupIds)&&element.groupIds.length)parts.push('group '+element.groupIds.join('+'));
  if(element.type==='image')parts.push('image '+(element.fileId&&files[element.fileId]?files[element.fileId]:element.fileId??''));
  if(element.link)parts.push('link '+element.link);
  if(element.strokeColor&&element.strokeColor!=='#1e1e1e')parts.push('stroke '+element.strokeColor);
  if(element.backgroundColor&&element.backgroundColor!=='transparent')parts.push('fill '+element.backgroundColor);
  push('- '+parts.join(' · '));
 }
 if(skipped)lines.push('… '+skipped+' more elements not listed (the summary stops at '+budget+' characters; remove ink with delete_cluster/delete_many or read a section again).');
 return lines;
}

/** `fileId: [[link]]` lines of the Embedded Files section. */
export function embeddedFiles(text:string):Record<string,string>{
 const section=text.match(/## Embedded Files\r?\n([\s\S]*?)(?=\r?\n## |\r?\n%%|$)/)?.[1]??'';
 return Object.fromEntries([...section.matchAll(/^([\w-]+):\s*(.+)$/gm)].map(match=>[match[1],match[2].trim()]));
}

export function summarizeExcalidraw(file:ExcalidrawFile):string{
 const elements=live(file.scene);
 const counts=new Map<string,number>();
 for(const element of elements)counts.set(element.type,(counts.get(element.type)??0)+1);
 return ['Excalidraw drawing: '+elements.length+' elements ('+[...counts].map(([type,count])=>count+' '+type).join(', ')+'). Coordinates are scene pixels; x grows right, y grows down. Freehand ink (freedraw) is listed as clusters (c1, c2, …) that mark where the ink is; delete_cluster removes a whole cluster, delete_cluster {cluster:"all"} removes all ink. Text inside a shape is listed with the shape.',...describeElements(file.scene,embeddedFiles(file.text))].join('\n');
}

/** The message shown when a scene is too large to render visually; '' when it renders. */
export function excalidrawRenderLimitNotice(scene:ExcalidrawScene,limit=EXCALIDRAW_RENDER_LIMIT):string{
 const count=live(scene).length;
 if(count<=limit)return '';
 return '[The drawing is too large to render visually ('+count+' live elements; the limit is '+limit+'). Work from the element list above. '+EXCALIDRAW_BULK_HINT+']';
}

/** Builds new elements with the plugin's own defaults. Implemented with ExcalidrawAutomate in main.ts. */
export interface ElementFactory{
 /** Loads the existing elements so new arrows and frames can refer to them. */
 load(elements:ExcalidrawElement[]):void;
 shape(kind:'rectangle'|'ellipse'|'diamond',x:number,y:number,width:number,height:number,style:Record<string,unknown>,text?:string):string;
 text(x:number,y:number,text:string,style:Record<string,unknown>):string;
 connect(from:string,to:string,style:Record<string,unknown>,label?:string):string;
 frame(x:number,y:number,width:number,height:number,name:string,contains:string[]):string;
 measure(text:string,style:Record<string,unknown>):{width:number;height:number};
 /** Every element, existing ones first in their original order. */
 elements():ExcalidrawElement[];
}

const STYLE_KEYS=new Set(['strokeColor','backgroundColor','fillStyle','strokeWidth','strokeStyle','roughness','opacity','fontSize','fontFamily','textAlign','roundness','startArrowHead','endArrowHead']);
function style(value:unknown){const result:Record<string,unknown>={};for(const [key,item] of Object.entries(record(value)))if(STYLE_KEYS.has(key))result[key]=item;return result;}
const num=(value:unknown,name:string,at:string)=>{if(typeof value!=='number'||!Number.isFinite(value))throw Error(at+': '+name+' must be a number.');return value;};
/**
 * Bounds model-supplied text and operations so a huge argument cannot leak
 * into memory or the next turn.
 */
export const EXCALIDRAW_TEXT_LIMIT=10_000;
export const EXCALIDRAW_OPERATIONS_LIMIT=100_000;
/** Most operations one proposal may carry; bulk operations keep big cleanups within it. */
export const EXCALIDRAW_MAX_OPS_PER_PROPOSAL=200;
/** Live elements allowed in one visual render; larger drawings stay text-only. */
export const EXCALIDRAW_RENDER_LIMIT=1_500;
/** Characters of element lines in one summary; the rest collapse into a count line. */
export const EXCALIDRAW_SUMMARY_LIMIT=6_000;
/** The alternative every limit message names, so oversized work stays possible. */
export const EXCALIDRAW_BULK_HINT='Use delete_many {ids:[…]}, delete_cluster {cluster:"c1"} or delete_cluster {cluster:"all"} to remove whole ink groups in one operation.';
const requiredText=(value:unknown,at:string)=>{if(typeof value!=='string'||!value)throw Error(at+': text is required.');if(value.length>EXCALIDRAW_TEXT_LIMIT)throw Error(at+': text is too long (max '+EXCALIDRAW_TEXT_LIMIT+' characters).');return value;};

/**
 * Marks an element as changed. An open Excalidraw editor merges a file changed on disk
 * by keeping the copy of each element with the higher version, and it raises versions
 * itself when it loads a drawing (re-measuring text). A large step makes the reviewed
 * change win that merge instead of being silently replaced by the editor's copy.
 */
export const VERSION_STEP=100;
function touch(element:ExcalidrawElement,random:()=>number){element.version=(element.version??1)+VERSION_STEP;element.versionNonce=Math.floor(random()*2**31);element.updated=Date.now();}

/**
 * Applies operations in order. Existing elements are edited in place; new ones
 * come from the factory. Deleting marks elements deleted (as Excalidraw does)
 * together with their bound text, and clears arrow bindings that pointed at them.
 */
export function applyExcalidrawOperations(scene:ExcalidrawScene,operations:unknown,factory:ElementFactory,random:()=>number=Math.random):ExcalidrawScene{
 if(!Array.isArray(operations)||!operations.length||operations.length>EXCALIDRAW_MAX_OPS_PER_PROPOSAL)throw Error('Provide between 1 and '+EXCALIDRAW_MAX_OPS_PER_PROPOSAL+' drawing operations per proposal. '+EXCALIDRAW_BULK_HINT+' Split unrelated changes across proposals.');
 if(JSON.stringify(operations).length>EXCALIDRAW_OPERATIONS_LIMIT)throw Error('The drawing operations are too large (over '+EXCALIDRAW_OPERATIONS_LIMIT+' characters). '+EXCALIDRAW_BULK_HINT+' Split them into smaller proposals.');
 factory.load(structuredClone(scene.elements));
 // Cluster names as read_excalidraw listed them; fixed for the whole proposal.
 let readClusters:InkCluster[]|undefined;
 const find=(id:unknown,at:string)=>{const element=factory.elements().find(item=>item.id===id&&!item.isDeleted);if(!element)throw Error(at+': no element '+JSON.stringify(id)+'.');return element;};
 /**
  * Marks ids deleted (as Excalidraw does), removes them from bindings and
  * clears frame membership that pointed at them. Shared by `delete`,
  * `delete_many` and `delete_cluster`.
  */
 const eraseGone=(gone:Set<string>)=>{
  for(const item of factory.elements()){
   if(gone.has(item.id)){item.isDeleted=true;touch(item,random);continue;}
   let changed=false;
   if(Array.isArray(item.boundElements)){const kept=item.boundElements.filter(bound=>!gone.has(bound.id));if(kept.length!==item.boundElements.length){item.boundElements=kept;changed=true;}}
   if(item.startBinding&&gone.has(item.startBinding.elementId)){item.startBinding=null;changed=true;}
   if(item.endBinding&&gone.has(item.endBinding.elementId)){item.endBinding=null;changed=true;}
   if(item.frameId&&gone.has(item.frameId)){item.frameId=null;changed=true;}
   if(changed)touch(item,random);
  }
 };
 for(const [index,raw] of (operations as unknown[]).entries()){
  const operation=record(raw),at='operation '+(index+1);
  switch(operation.op){
   case 'add_shape':{
    const kind=operation.shape;
    if(kind!=='rectangle'&&kind!=='ellipse'&&kind!=='diamond')throw Error(at+': shape must be rectangle, ellipse or diamond.');
    const width=num(operation.width,'width',at),height=num(operation.height,'height',at);
    if(width<=0||height<=0)throw Error(at+': the size must be positive.');
    const text=typeof operation.text==='string'&&operation.text?requiredText(operation.text,at):undefined;
    factory.shape(kind,num(operation.x,'x',at),num(operation.y,'y',at),width,height,style(operation.style),text);
    break;
   }
   case 'add_text':{
    const text=requiredText(operation.text,at);
    factory.text(num(operation.x,'x',at),num(operation.y,'y',at),text,style(operation.style));
    break;
   }
   case 'add_arrow':{
    const from=find(operation.from,at),to=find(operation.to,at);
    const label=typeof operation.label==='string'&&operation.label?requiredText(operation.label,at):undefined;
    factory.connect(from.id,to.id,style(operation.style),label);
    break;
   }
   case 'add_frame':{
    const contains=Array.isArray(operation.contains)?operation.contains.map(id=>find(id,at).id):[];
    const width=num(operation.width,'width',at),height=num(operation.height,'height',at);
    if(width<=0||height<=0)throw Error(at+': the size must be positive.');
    factory.frame(num(operation.x,'x',at),num(operation.y,'y',at),width,height,typeof operation.name==='string'?operation.name:'Frame',contains);
    break;
   }
   case 'update_text':{
    const newText=requiredText(operation.text,at);
    const element=find(operation.id,at),all={elements:factory.elements()} as ExcalidrawScene,text=textOf(all,element);
    if(!text)throw Error(at+': element '+element.id+' has no text. Use add_shape with text or add_text.');
    text.text=text.originalText=text.rawText=newText;
    if(!text.containerId){const size=factory.measure(newText,text);text.width=size.width;text.height=size.height;}
    touch(text,random);
    break;
   }
   case 'move':{
    const element=find(operation.id,at);
    const dx=operation.x!==undefined?num(operation.x,'x',at)-element.x:operation.dx!==undefined?num(operation.dx,'dx',at):0;
    const dy=operation.y!==undefined?num(operation.y,'y',at)-element.y:operation.dy!==undefined?num(operation.dy,'dy',at):0;
    const moved=[element,...boundList(element).filter(item=>item.type==='text').map(item=>factory.elements().find(other=>other.id===item.id)).filter((item):item is ExcalidrawElement=>!!item)];
    for(const item of moved){item.x+=dx;item.y+=dy;touch(item,random);}
    break;
   }
   case 'resize':{
    const element=find(operation.id,at);
    element.width=num(operation.width,'width',at);element.height=num(operation.height,'height',at);
    if(element.width<=0||element.height<=0)throw Error(at+': the size must be positive.');
    touch(element,random);
    break;
   }
   case 'set_style':{
    const element=find(operation.id,at),changes=style(operation.style);
    if(!Object.keys(changes).length)throw Error(at+': give at least one style property ('+[...STYLE_KEYS].join(', ')+').');
    Object.assign(element,changes);touch(element,random);
    break;
   }
   case 'delete':{
    const element=find(operation.id,at);
    eraseGone(new Set([element.id,...boundList(element).filter(item=>item.type==='text').map(item=>item.id)]));
    break;
   }
   case 'delete_many':{
    const ids=operation.ids;
    if(!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string'||!id))throw Error(at+': give ids as a nonempty list of element ids.');
    const gone=new Set<string>(),unknown:string[]=[];
    for(const id of ids){
     const element=factory.elements().find(item=>item.id===id&&!item.isDeleted);
     if(!element){unknown.push(JSON.stringify(id));continue;}
     gone.add(element.id);
     for(const bound of boundList(element))if(bound.type==='text')gone.add(bound.id);
    }
    if(unknown.length)throw Error(at+': unknown ids '+unknown.join(', ')+'. Nothing was deleted; check read_excalidraw for the current ids.');
    eraseGone(gone);
    break;
   }
   case 'delete_cluster':{
    const name=operation.cluster;
    if(typeof name!=='string'||!name)throw Error(at+': give the cluster name from read_excalidraw, e.g. delete_cluster {cluster:"c1"}.');
    const clusters=readClusters??=inkClusters(scene);
    const target=name===ALL_INK?{ids:clusters.flatMap(cluster=>cluster.ids)}:clusters.find(cluster=>cluster.cluster===name);
    if(!target)throw Error(at+': no cluster '+JSON.stringify(name)+'. The scene has clusters '+(clusters.map(cluster=>cluster.cluster).join(', ')||'none')+'. Use one of these, "all" for every ink cluster, or delete_many with explicit ids.');
    const liveIds=new Set(factory.elements().filter(item=>!item.isDeleted).map(item=>item.id));
    eraseGone(new Set(target.ids.filter(id=>liveIds.has(id))));
    break;
   }
   default:throw Error(at+': unknown op '+JSON.stringify(operation.op)+'. Use add_shape, add_text, add_arrow, add_frame, update_text, move, resize, set_style, delete, delete_many or delete_cluster.');
  }
 }
 return {...scene,elements:factory.elements()};
}

/**
 * The file with a new scene. A Markdown drawing keeps its wrapper: the drawing
 * is written as plain JSON (the plugin compresses it again on its next save),
 * the Text Elements section is rebuilt from the scene, and every other section
 * is kept as it was. A `.excalidraw` file is the scene as plain JSON.
 */
export function serializeExcalidraw(original:string,scene:ExcalidrawScene):string{
 if(original.trimStart().startsWith('{'))return JSON.stringify(scene,null,'\t');
 const text=original||newExcalidrawFile();
 const texts=live(scene).filter(element=>element.type==='text').map(element=>(element.rawText??element.originalText??element.text??'')+' ^'+element.id+'\n').join('\n');
 let next=TEXT_SECTION.test(text)?text.replace(TEXT_SECTION,(_all,head:string)=>head+texts):text.replace(/(# Excalidraw Data\r?\n)/,'$1\n## Text Elements\n'+texts+'\n');
 const json=JSON.stringify(scene,null,'\t');
 if(!DRAWING.test(next))throw Error('The drawing block is missing.');
 next=next.replace(DRAWING,(_all,_head:string,_kind:string,_body:string,tail:string)=>'## Drawing\n```json\n'+json+tail);
 return next;
}

/** The text of a new, empty drawing: the plugin's Markdown file format, or its JSON format for `.excalidraw`. */
export function newExcalidrawFile(json=false):string{
 const scene={type:'excalidraw',version:2,source:'https://github.com/zsviczian/obsidian-excalidraw-plugin',elements:[],appState:{gridSize:null,viewBackgroundColor:'#ffffff'},files:{}};
 if(json)return JSON.stringify(scene,null,'\t');
 return '---\n\nexcalidraw-plugin: parsed\ntags: [excalidraw]\n\n---\n==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠==\n\n\n# Excalidraw Data\n\n## Text Elements\n%%\n## Drawing\n```json\n'+JSON.stringify(scene,null,'\t')+'\n```\n%%';
}

/**
 * A reviewable version of the file: the drawing data becomes one line per
 * element, so a diff shows which shapes, texts and arrows change instead of a
 * compressed blob. Used for display only; the file itself is never written this way.
 */
export function readableExcalidraw(text:string,decompress?:(data:string)=>string):string{
 if(!isExcalidrawText(text))return text;
 try{
  const file=parseExcalidraw(text,decompress);
  const elements=describeElements(file.scene,embeddedFiles(file.text)).join('\n');
  if(isExcalidrawJson(text))return 'Excalidraw drawing (.excalidraw JSON):\n'+elements;
  return text.replace(DRAWING,'## Drawing (elements)\n'+elements+'\n');
 }catch{return text;}
}

/**
 * The file that undoes a proposal. Writing the original text back is not
 * enough while the drawing is open: the editor merges by element version and
 * would keep the proposal's newer elements. The original elements are written
 * with versions above the proposal's, and elements the proposal added are
 * written as deleted, so the editor's merge arrives at the original drawing.
 */
export function revertExcalidraw(before:string,after:string,decompress?:(data:string)=>string,random:()=>number=Math.random):string{
 const original=parseExcalidraw(before,decompress).scene,proposed=parseExcalidraw(after,decompress).scene;
 const proposedById=new Map(proposed.elements.map(element=>[element.id,element]));
 const originalIds=new Set(original.elements.map(element=>element.id));
 const stamp=(element:ExcalidrawElement,over:ExcalidrawElement|undefined)=>({...element,version:Math.max(element.version??1,over?.version??1)+VERSION_STEP,versionNonce:Math.floor(random()*2**31),updated:Date.now()});
 const elements=[
  ...original.elements.map(element=>stamp(element,proposedById.get(element.id))),
  ...proposed.elements.filter(element=>!originalIds.has(element.id)).map(element=>({...stamp(element,element),isDeleted:true})),
 ];
 return serializeExcalidraw(before,{...original,elements});
}
